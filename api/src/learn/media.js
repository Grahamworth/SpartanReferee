'use strict';
/* The media adapter (LRN-04, AT-11): given a lesson's content version and a language, it says what to play. Which provider does it is
   configuration (media_config, per programme or 'default'), changed on the Media settings page: never a code change, and never part
   of a completion. Completions record the content version, not how it was played.
     azure-speech   narration made by Azure AI Speech (LEARN_SPEECH_KEY, LEARN_SPEECH_REGION) for each slide, once per voice, kept in
                    blob storage (container learn-media) and played from a short-lived link
     browser-voice  the device reads the narration aloud itself (the Web Speech API): free, quality varies by device
     text-only      captions and transcript only
   An avatar presenter would be one more provider here, returning a video for each slide or the whole lesson. */
const crypto = require('node:crypto');

const VOICES = {
  en: ['en-GB-RyanNeural', 'en-GB-SoniaNeural', 'en-US-JennyNeural'], es: ['es-ES-ElviraNeural', 'es-ES-AlvaroNeural', 'es-MX-DaliaNeural'],
  fr: ['fr-FR-DeniseNeural', 'fr-FR-HenriNeural'], de: ['de-DE-KatjaNeural', 'de-DE-ConradNeural'], nl: ['nl-NL-FennaNeural', 'nl-NL-MaartenNeural'],
  it: ['it-IT-ElsaNeural', 'it-IT-DiegoNeural'], el: ['el-GR-AthinaNeural', 'el-GR-NestorasNeural'], hr: ['hr-HR-GabrijelaNeural', 'hr-HR-SreckoNeural'],
  cs: ['cs-CZ-VlastaNeural', 'cs-CZ-AntoninNeural'], pl: ['pl-PL-ZofiaNeural', 'pl-PL-MarekNeural'], fi: ['fi-FI-NooraNeural', 'fi-FI-HarriNeural'],
  sv: ['sv-SE-SofieNeural', 'sv-SE-MattiasNeural'], da: ['da-DK-ChristelNeural', 'da-DK-JeppeNeural'], ar: ['ar-AE-FatimaNeural', 'ar-AE-HamdanNeural'],
  th: ['th-TH-PremwadeeNeural', 'th-TH-NiwatNeural'],
};
const PROVIDERS = {
  'azure-speech': { label: 'Narrated by Azure AI Speech', kind: 'audio' },
  'browser-voice': { label: 'Read aloud by the device\'s own voice', kind: 'browser' },
  'text-only': { label: 'Captions only, no voice', kind: 'text' },
};
const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const DAILY_CHARS = 200000; // new narration a day, across the platform: about 1.5 hours of speech, a few dollars at most

function createMedia({ db, speech = null, signer = null, doFetch = fetch, dailyChars = DAILY_CHARS }) {
  const speechOn = !!(speech && speech.key && speech.region && signer);
  async function configFor(programmeId) {
    const rows = await db.query("SELECT * FROM {S}.media_config WHERE scope IN (@p, 'default')", { p: programmeId || '' });
    const row = rows.find((r) => r.scope === programmeId) || rows.find((r) => r.scope === 'default');
    return { scope: row?.scope || 'default', provider: row?.provider || (speechOn ? 'azure-speech' : 'browser-voice'), voices: JSON.parse(row?.voices || '{}') };
  }
  const voiceFor = (cfg, locale) => cfg.voices[locale] || (VOICES[locale] || VOICES.en)[0];
  /** what the player needs for this content: { provider, kind, label, voice, lang } */
  async function plan(content, programmeId) {
    const cfg = await configFor(programmeId);
    let provider = PROVIDERS[cfg.provider] ? cfg.provider : 'text-only';
    const note = provider === 'azure-speech' && !speechOn ? 'Azure narration isn\'t set up here, so the device reads it aloud instead' : '';
    if (note) provider = 'browser-voice';
    const voice = voiceFor(cfg, content.locale);
    return { provider, kind: PROVIDERS[provider].kind, label: PROVIDERS[provider].label, voice, lang: voice.slice(0, 5), note, configured: cfg.provider, scope: cfg.scope };
  }
  /** a link to one slide's narration, made (once) by Azure AI Speech and kept in blob storage */
  async function narration(content, slide, voice) {
    if (!speechOn) throw Object.assign(new Error('Narration isn\'t set up'), { status: 503 });
    const slides = JSON.parse(content.body).slides || [];
    const text = String(slides[slide]?.narration || '').trim();
    if (!text) throw Object.assign(new Error('That slide has no narration'), { status: 404 });
    const wanted = `narration/${String(content.content_id).toLowerCase()}/${voice}/${slide}-${crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)}.mp3`;
    const had = (await db.query('SELECT * FROM {S}.media_asset WHERE content_id = @c AND provider = @p AND voice = @v AND slide = @s', { c: content.content_id, p: 'azure-speech', v: voice, s: slide }))[0];
    let blob = had?.blob === wanted ? wanted : null;
    if (!blob) {
      const today = (await db.query("SELECT ISNULL(SUM(chars), 0) AS n FROM {S}.media_asset WHERE created_at > DATEADD(day, -1, SYSUTCDATETIME())"))[0].n;
      if (today + text.length > dailyChars) throw Object.assign(new Error('Today\'s narration limit is reached: the captions are below, and the device can read them aloud'), { status: 429 });
      const ssml = `<speak version="1.0" xml:lang="${xml(voice.slice(0, 5))}"><voice name="${xml(voice)}"><prosody rate="-4%">${xml(text)}</prosody></voice></speak>`;
      const r = await doFetch(`https://${speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST', body: ssml,
        headers: { 'Ocp-Apim-Subscription-Key': speech.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'spartanreferee-learn' },
      });
      if (!r.ok) throw Object.assign(new Error(`The narration service said ${r.status}`), { status: 502 });
      const audio = Buffer.from(await r.arrayBuffer());
      blob = wanted;
      const put = await doFetch(signer({ blob, perm: 'cw', minutes: 5 }), { method: 'PUT', body: audio, headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-blob-content-type': 'audio/mpeg' } });
      if (!put.ok) throw Object.assign(new Error(`Storage said ${put.status}`), { status: 502 });
      await db.query('DELETE FROM {S}.media_asset WHERE content_id = @c AND provider = @p AND voice = @v AND slide = @s', { c: content.content_id, p: 'azure-speech', v: voice, s: slide }); // the old words' audio
      await db.query('INSERT INTO {S}.media_asset (asset_id, content_id, provider, voice, slide, blob, chars) VALUES (@id, @c, @p, @v, @s, @b, @n)',
        { id: crypto.randomUUID(), c: content.content_id, p: 'azure-speech', v: voice, s: slide, b: blob, n: text.length });
    }
    return signer({ blob, perm: 'r', minutes: 120 });
  }
  return { configFor, plan, narration, speechOn, PROVIDERS, VOICES };
}

module.exports = { createMedia, PROVIDERS, VOICES, DAILY_CHARS };
