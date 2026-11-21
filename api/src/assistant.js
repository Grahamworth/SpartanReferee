'use strict';
/* The Assistant (21 November 2026): a referee asks about an obstacle, a rule, a lesson, an event or an athlete the cameras filmed, by
   typing or talking, and gets an answer in their language with the rule cited, the lesson quoted and links into the app.

   How it answers: everything it knows (the 2026 Rules of Competition and SOP section by section, the obstacles, every lesson slide) is
   embedded ahead of time (scripts/assistant-index.mjs, kept in the storage account's private "assistant" container). A question is
   embedded too, the closest passages are put in front of the model (Luna, on Azure AI Foundry: assistant-ai.js) and it can look up
   more, Spartan's events and the cameras' results for a bib number, through tools. Nothing is kept of what was asked or answered:
   only what each question cost (assistant_usage), so the monthly cap holds.

   GET    /api/assistant                     -> { allowed, voice, lang }            anyone signed in: may they use it?
   POST   /api/assistant/ask {messages, lang} -> { answer, sources }
   POST   /api/assistant/listen {audio, lang} -> { text }                           a recording (WAV, 16 kHz mono, up to 60 s) as text
   POST   /api/assistant/speak {text, lang}   -> { audio }                          an answer read aloud (MP3, base64)
   GET    /api/assistant/settings            -> { mode, capGbp, spentGbp, people }  admins
   PUT    /api/assistant/settings {mode, capGbp}                                      admins
   POST   /api/assistant/access {email}      DELETE /api/assistant/access/<email>   admins: the people it's on for when mode is chosen */
const { costOf, tokensOf } = require('./assistant-ai');
const { VOICES } = require('./learn/media');

const MODES = ['off', 'all', 'chosen'];
const LANGS = { en: ['English', 'en-GB'], fr: ['French', 'fr-FR'], de: ['German', 'de-DE'], nl: ['Dutch', 'nl-NL'], es: ['Spanish', 'es-ES'], it: ['Italian', 'it-IT'],
  el: ['Greek', 'el-GR'], hr: ['Croatian', 'hr-HR'], cs: ['Czech', 'cs-CZ'], pl: ['Polish', 'pl-PL'], fi: ['Finnish', 'fi-FI'], sv: ['Swedish', 'sv-SE'],
  da: ['Danish', 'da-DK'], ar: ['Arabic', 'ar-AE'], th: ['Thai', 'th-TH'] };
const MAX_TURNS = 12, MAX_CHARS = 2000, TOOL_ROUNDS = 4, TOP = 10, INDEX_MINUTES = 10;
const EMAIL = /^[^\s@/#?\\]+@[^\s@/#?\\]+\.[^\s@/#?\\]+$/;
const clip = (s, n) => String(s ?? '').slice(0, n);
const dayOf = (iso) => String(iso || '').slice(0, 10);

const SYSTEM = `You are the SpartanReferee Assistant, for referees at Spartan obstacle course races. You answer questions about Spartan's
2026 Rules of Competition, the Officiating SOP, the obstacles, the referee lessons, Spartan's events, and athletes the cameras filmed.

How to answer:
- Answer only from the reference passages you're given or look up with search_knowledge, and from what the tools return. If they don't
  cover the question, say you don't know and suggest asking the Head Referee. Never make up a rule, a number or an event.
- Rules: answer, then cite the rule by its document and section number, as a link to it, e.g. [Rules of Competition 3.17.4](#/rules/OCR-2026-3.17.4).
  Quote the rule's own words in quotation marks when the exact wording matters.
- Obstacles: say what the athlete has to do, what passes and what is a fail (and the penalty, by obstacle type), and give the link to
  the obstacle in the app, e.g. [Spear Throw](#/obstacles/spear).
- Lessons: answer, and always include at least one direct quote of the lesson's own words, word for word in quotation marks, with a link
  to the lesson.
- Where the 2026 sources disagree (an open review item), still answer: give what each source says, each with its citation, say it's
  under review for 2027, and that the Head Referee rules on the day.
- Events: use find_events. Give the name, dates and place, and the link to the event's page.
- Athletes the cameras filmed: use camera_results with the bib number (and the day or event if given). Give the link to each result
  so the referee can review the video. Results are kept for 7 days.
- Links: only the ones in the passages and tool results, written as Markdown links. Never write a web address of your own.
- Be brief and practical: a referee may be standing at an obstacle. Short paragraphs or a few bullet points; no headings.
- Reply in the referee's language (given below), whatever language the passages are in; keep rule numbers and obstacle names as they are.
- You are not a substitute for the Head Referee's decision on the day.`;

const TOOLS = [
  { type: 'function', name: 'search_knowledge', description: 'Searches the rulebook, the SOP, the obstacles and the lessons for passages about something not covered by the passages already given.',
    parameters: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string', description: 'What to look for, in English: an obstacle, a rule number or a topic' } } } },
  { type: 'function', name: 'find_events', description: 'Spartan events: upcoming ones, recent past ones, or the ones the referee asking is assigned to.',
    parameters: { type: 'object', additionalProperties: false, required: ['when'], properties: { when: { type: 'string', enum: ['upcoming', 'past', 'mine'] }, text: { type: 'string', description: 'Part of the event name, city or country, if one was named' } } } },
  { type: 'function', name: 'camera_results', description: 'Athletes the cameras filmed in the last 7 days, found by bib number, with a link to review each one\'s video.',
    parameters: { type: 'object', additionalProperties: false, properties: { bib: { type: 'string', description: 'The athlete\'s bib number' }, day: { type: 'string', description: 'A day, YYYY-MM-DD, if one was named' } } } },
];

function createAssistant({ db, ai, indexSigner, member, session, reply, events, myEvents, manageEvents, recordings, speech = null, now = Date.now, doFetch = fetch }) {
  const voiceOn = !!(speech && speech.key && speech.region);

  // ---------------------------------------------------------------- the knowledge, loaded once and refreshed every few minutes
  let index = null, loadedAt = 0, loading = null;
  async function knowledge() {
    if (index && now() - loadedAt < INDEX_MINUTES * 60e3) return index;
    loading = loading || (async () => {
      try {
        const r = await doFetch(indexSigner({ blob: `${db.schema}/index.json`, perm: 'r', minutes: 5 }));
        if (!r.ok) throw new Error(`index ${r.status}`);
        const j = await r.json();
        const chunks = j.chunks.map((c) => {
          const b = Buffer.from(c.v, 'base64'), v = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
          let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1;
          return { ...c, v: Float32Array.from(v, (x) => x / n) };
        });
        index = { chunks, builtAt: j.builtAt }; loadedAt = now();
      } catch (e) { if (!index) throw Object.assign(new Error('The Assistant\'s knowledge isn\'t ready yet'), { status: 503, cause: e }); } finally { loading = null; }
      return index;
    })();
    return loading;
  }
  // the closest passages to a question, with a passage named outright (a rule number, an obstacle) always among them
  async function find(query, k = TOP) {
    const kn = await knowledge();
    const { vectors, tokens } = await ai.embed([clip(query, 2000)]);
    const q = vectors[0]; let n = 0; for (const x of q) n += x * x; n = Math.sqrt(n) || 1;
    const lower = query.toLowerCase(), numbers = new Set(lower.match(/\b\d{1,2}(?:\.\d{1,2}){1,3}\b/g) || []);
    const scored = kn.chunks.map((c) => {
      let s = 0; for (let i = 0; i < q.length; i++) s += c.v[i] * q[i]; s /= n;
      if (c.kind === 'rule' && numbers.has(String(c.ref).replace(/^(OCR|SOP)-\d{4}-/, ''))) s += 0.3;
      if (c.kind === 'obstacle' && lower.includes(c.title.replace(/^Obstacle: /, '').replace(/\s*\(.*\)$/, '').toLowerCase())) s += 0.2;
      return { c, s };
    }).sort((a, b) => b.s - a.s);
    return { hits: scored.slice(0, k).map((x) => x.c), tokens };
  }
  const passage = (c) => `[${c.title}] (link: ${c.link})\n${clip(c.text, 2400)}`;

  // ---------------------------------------------------------------- who may use it, and what's been spent
  async function setting() { return (await db.query('SELECT * FROM {S}.assistant_setting WHERE id = 1'))[0] || { mode: 'chosen', monthly_cap_gbp: 50 }; }
  const monthStart = () => { const d = new Date(now()); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };
  async function spent() { return Number((await db.query('SELECT ISNULL(SUM(cost_gbp), 0) AS s FROM {S}.assistant_usage WHERE at >= @f', { f: monthStart() }))[0].s) || 0; }
  async function personOf(email) { return (await db.query("SELECT person_id FROM {S}.person WHERE LOWER(email) = @e AND status = 'active'", { e: String(email).toLowerCase() }))[0]?.person_id || null; }
  async function who(h) {
    const me = session(h); if (!me) return { error: reply(401, { error: 'Sign in first' }) };
    const m = await member(me); if (!m) return { error: reply(403, { error: 'Only referees and admins can use the Assistant' }) };
    return { me, m };
  }
  // admins always (so they can try it); everyone when it's on for all; the chosen people when it's on for them
  async function mayUse(m) {
    const s = await setting();
    if (m.admin) return { ok: true, s };
    if (s.mode === 'all') return { ok: true, s };
    if (s.mode === 'chosen') { const p = await personOf(m.email); if (p && (await db.query('SELECT 1 AS x FROM {S}.assistant_access WHERE person_id = @p', { p })).length) return { ok: true, s }; }
    return { ok: false, s };
  }
  async function note(m, kind, { usage = {}, units = 0, cost = 0 } = {}) {
    await db.query(`INSERT INTO {S}.assistant_usage (person_id, kind, input_tokens, cached_tokens, output_tokens, units, cost_gbp) VALUES (@p, @k, @i, @c, @o, @u, @g)`,
      { p: await personOf(m.email), k: kind, i: usage.input || 0, c: usage.cached || 0, o: usage.output || 0, u: units, g: cost });
  }
  async function gate(h) {
    const w = await who(h); if (w.error) return w;
    const g = await mayUse(w.m);
    if (!g.ok) return { error: reply(403, { error: 'The Assistant isn\'t switched on for you: ask an admin' }) };
    if (await spent() >= Number(g.s.monthly_cap_gbp)) return { error: reply(429, { error: 'The Assistant has reached this month\'s spending limit. It\'s back on the 1st, or an admin can raise the limit.' }) };
    return w;
  }

  // ---------------------------------------------------------------- the tools the model can use
  const eventLine = (e, extra = {}) => ({ name: e.name, dates: e.startDate === e.endDate ? e.startDate : `${e.startDate} to ${e.endDate}`, place: [e.city, e.country].filter(Boolean).join(', '), link: `/event.html?id=${e.id}`, ...extra });
  async function tool(name, args, h, m) {
    if (name === 'search_knowledge') { const { hits } = await find(String(args.query || '')); return { passages: hits.slice(0, 8).map((c) => ({ title: c.title, link: c.link, text: clip(c.text, 1800) })) }; }
    if (name === 'find_events') {
      // a place as people say it: "UK" is GB in Spartan's list, "Britain" and "England" too
      const ALIAS = { uk: 'gb', 'united kingdom': 'gb', britain: 'gb', 'great britain': 'gb', england: 'gb', scotland: 'gb', wales: 'gb', usa: 'us', america: 'us', uae: 'ae', emirates: 'ae', holland: 'nl' };
      const text = String(args.text || '').trim().toLowerCase(), code = ALIAS[text] || (text.length === 2 ? text : '');
      const match = (e) => !text || `${e.name} ${e.city} ${e.country}`.toLowerCase().includes(text) || (code && String(e.countryCode || '').toLowerCase() === code);
      if (args.when === 'mine') {
        const r = await myEvents(h); if (r.status !== 200) return { error: r.body?.error || 'Not available' };
        return { upcoming: r.body.upcoming.filter(match).slice(0, 15).map((e) => eventLine(e, { role: e.role })), past: r.body.past.filter(match).slice(0, 10).map((e) => eventLine(e, { role: e.role })) };
      }
      await events.fresh().catch(() => {}); // Spartan's race list, fetched again when it's a few hours old
      const today = new Date(now()).toISOString().slice(0, 10);
      if (args.when === 'past') {
        const past = (await events.all()).filter((e) => e.endDate < today && match(e)).sort((a, b) => b.endDate.localeCompare(a.endDate)).slice(0, 15);
        return { past: past.map((e) => eventLine(e)), note: 'Events are kept for a week after they end.' };
      }
      // upcoming: admins and coordinators see how staffed each is, as Manage Events shows it
      let staffed = new Map();
      if (m.admin && manageEvents) { const r = await manageEvents(h, {}); if (r.status === 200) staffed = new Map(r.body.events.map((e) => [e.id, e])); }
      const up = (await events.upcoming()).filter(match).slice(0, 15);
      return { upcoming: up.map((e) => { const s = staffed.get(e.id); return eventLine(e, s ? { referees: s.referees, headReferees: s.heads, camerasBooked: !!s.camerasBooked } : {}); }) };
    }
    if (name === 'camera_results') {
      const bib = String(args.bib || '').replace(/\D/g, '').slice(0, 8), day = /^\d{4}-\d\d-\d\d$/.test(args.day || '') ? args.day : '';
      const r = await recordings('GET', 'results', undefined, null, h); if (r.status !== 200) return { error: r.body?.error || 'The camera results aren\'t available to you' };
      const list = (r.body.athletes || []).filter((a) => (!bib || String(a.bib || '') === bib) && (!day || dayOf(a.firstAt) === day)).slice(0, 12);
      return { keptDays: r.body.keepDays, results: list.map((a) => ({ bib: a.bib || 'no number read', filmed: a.firstAt, camera: a.cam || 0, reps: a.reps, noReps: a.noReps,
        link: `/results.html?bib=${encodeURIComponent(a.bib || '')}&day=${dayOf(a.firstAt)}&athlete=${encodeURIComponent(`${a.server}~${a.n}`)}` })), found: list.length };
    }
    return { error: 'No such tool' };
  }

  // ---------------------------------------------------------------- asking
  async function ask(h, b) {
    const w = await gate(h); if (w.error) return w.error;
    const lang = LANGS[b?.lang] ? b.lang : 'en';
    const turns = (Array.isArray(b?.messages) ? b.messages : []).filter((x) => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string' && x.content.trim())
      .slice(-MAX_TURNS).map((x) => ({ role: x.role, content: clip(x.content, MAX_CHARS) }));
    if (!turns.length || turns[turns.length - 1].role !== 'user') return reply(400, { error: 'Ask a question' });
    const question = turns[turns.length - 1].content;
    // the passages for the question (and the one before, for a follow-up like "and if they miss?")
    const prior = turns.filter((x) => x.role === 'user').slice(-2, -1).map((x) => x.content).join(' ');
    const { hits, tokens: embedTokens } = await find(prior ? `${prior}\n${question}` : question);
    const today = new Date(now()).toISOString().slice(0, 10);
    const messages = [
      { role: 'system', content: SYSTEM },
      ...turns.slice(0, -1),
      { role: 'user', content: `Reference passages for this question:\n\n${hits.map(passage).join('\n\n---\n\n')}` },
      { role: 'system', content: `Today is ${today}. The referee's name is ${clip(w.m.name || 'not known', 60)}${w.m.admin ? ' (an admin)' : ''}. Reply in ${LANGS[lang][0]}.` },
      { role: 'user', content: question },
    ];
    let cost = costOf({ prompt_tokens: embedTokens }, 'text-embedding-3-small');
    const usage = { input: 0, cached: 0, output: 0 };
    const sources = new Map(hits.slice(0, 5).map((c) => [c.link, c.title]));
    const input = messages;
    let answer = '';
    try {
      for (let round = 0; round <= TOOL_ROUNDS; round++) {
        const r = await ai.respond({ input, ...(round < TOOL_ROUNDS ? { tools: TOOLS } : {}), reasoning: { effort: 'low' }, max_output_tokens: 4000 });
        cost += costOf(r.usage); const t = tokensOf(r.usage); usage.input += t.input; usage.cached += t.cached; usage.output += t.output;
        const calls = (r.output || []).filter((o) => o.type === 'function_call');
        if (calls.length) {
          input.push(...r.output);
          for (const call of calls) {
            let args = {}; try { args = JSON.parse(call.arguments || '{}'); } catch { /* given as nothing */ }
            const out = await tool(call.name, args, h, w.m).catch((e) => ({ error: String(e.message || e).slice(0, 200) }));
            for (const p of out.passages || []) sources.set(p.link, p.title);
            input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(out).slice(0, 20000) });
          }
          continue;
        }
        answer = (r.output || []).filter((o) => o.type === 'message').flatMap((o) => o.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('').trim();
        break;
      }
    } finally { await note(w.m, 'ask', { usage, cost }); }
    if (!answer) answer = 'Sorry, I couldn\'t put an answer together. Try asking another way.';
    // the model sometimes writes a site page as if it were in the app ("#/event.html?id=1"): put it right
    answer = answer.replace(/\]\(#\/((?:event|results)\.html[^)]*)\)/g, '](/$1)');
    // the passages it drew on, as the answer links them
    return reply(200, { answer, sources: [...sources].filter(([link]) => answer.includes(`](${link})`)).slice(0, 6).map(([link, title]) => ({ link, title })) });
  }

  // ---------------------------------------------------------------- talking and listening (Azure AI Speech, LEARN_SPEECH_*)
  async function listen(h, b) {
    const w = await gate(h); if (w.error) return w.error;
    if (!voiceOn) return reply(503, { error: 'Voice isn\'t set up here' });
    const audio = Buffer.from(String(b?.audio || ''), 'base64');
    if (audio.length < 1000 || audio.length > 2.2e6) return reply(400, { error: 'That recording is empty or too long (a minute at most)' });
    const lang = LANGS[b?.lang] ? b.lang : 'en';
    const r = await doFetch(`https://${speech.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${LANGS[lang][1]}&format=simple`, {
      method: 'POST', body: audio, headers: { 'Ocp-Apim-Subscription-Key': speech.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' } });
    if (r.status === 429) return reply(429, { error: 'Voice has reached its limit for now: type the question instead' });
    if (!r.ok) return reply(502, { error: `The speech service said ${r.status}` });
    const j = await r.json().catch(() => ({}));
    await note(w.m, 'listen', { units: Math.round((j.Duration || 0) / 1e7) });
    return reply(200, { text: j.RecognitionStatus === 'Success' ? String(j.DisplayText || '') : '' });
  }
  const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
  // what's read aloud: the answer's words, without the links' addresses and the Markdown marks
  const spoken = (s) => String(s || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 3000);
  async function speak(h, b) {
    const w = await gate(h); if (w.error) return w.error;
    if (!voiceOn) return reply(503, { error: 'Voice isn\'t set up here' });
    const lang = LANGS[b?.lang] ? b.lang : 'en', text = spoken(b?.text);
    if (!text) return reply(400, { error: 'Nothing to say' });
    const voice = (VOICES[lang] || VOICES.en)[0];
    const r = await doFetch(`https://${speech.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
      method: 'POST', body: `<speak version="1.0" xml:lang="${xml(voice.slice(0, 5))}"><voice name="${xml(voice)}">${xml(text)}</voice></speak>`,
      headers: { 'Ocp-Apim-Subscription-Key': speech.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3', 'User-Agent': 'spartanreferee-assistant' } });
    if (r.status === 429) return reply(429, { error: 'Voice has reached its limit for now' });
    if (!r.ok) return reply(502, { error: `The speech service said ${r.status}` });
    await note(w.m, 'speak', { units: text.length });
    return reply(200, { audio: Buffer.from(await r.arrayBuffer()).toString('base64') });
  }

  // ---------------------------------------------------------------- admins: on for whom, and the cap
  async function settings(h, method, b) {
    const w = await who(h); if (w.error) return w.error;
    if (!w.m.admin) return reply(403, { error: 'Only admins change the Assistant\'s settings' });
    if (method === 'PUT') {
      const mode = MODES.includes(b?.mode) ? b.mode : null, cap = Number(b?.capGbp);
      if (!mode && b?.mode !== undefined) return reply(400, { error: 'On for: off, everyone or chosen people' });
      if (b?.capGbp !== undefined && !(cap >= 0 && cap <= 1000)) return reply(400, { error: 'The monthly limit is £0 to £1,000' });
      await db.query('UPDATE {S}.assistant_setting SET mode = ISNULL(@m, mode), monthly_cap_gbp = ISNULL(@c, monthly_cap_gbp), updated_by = @by, updated_at = SYSUTCDATETIME() WHERE id = 1',
        { m: mode, c: b?.capGbp === undefined ? null : Math.round(cap * 100) / 100, by: await personOf(w.m.email) });
    } else if (method !== 'GET') return reply(405, { error: 'Not allowed' });
    const s = await setting();
    const people = await db.query('SELECT p.email, p.legal_name, p.preferred_name, a.added_at FROM {S}.assistant_access a JOIN {S}.person p ON p.person_id = a.person_id ORDER BY p.legal_name');
    const byKind = await db.query('SELECT kind, COUNT(*) AS n, ISNULL(SUM(cost_gbp), 0) AS gbp FROM {S}.assistant_usage WHERE at >= @f GROUP BY kind', { f: monthStart() });
    return reply(200, { mode: s.mode, capGbp: Number(s.monthly_cap_gbp), spentGbp: await spent(), month: byKind.map((k) => ({ kind: k.kind, count: k.n, gbp: Number(k.gbp) })),
      people: people.map((p) => ({ email: p.email, name: p.preferred_name || p.legal_name, addedAt: p.added_at })), voice: voiceOn });
  }
  async function access(h, method, email, b) {
    const w = await who(h); if (w.error) return w.error;
    if (!w.m.admin) return reply(403, { error: 'Only admins choose who has the Assistant' });
    const e = String(method === 'POST' ? b?.email : decodeURIComponent(email || '')).trim().toLowerCase();
    if (!EMAIL.test(e)) return reply(400, { error: 'Which address?' });
    const p = await personOf(e);
    if (method === 'POST') {
      if (!p) return reply(404, { error: 'Nobody with that address has signed in to Learning yet' });
      await db.query('IF NOT EXISTS (SELECT 1 FROM {S}.assistant_access WHERE person_id = @p) INSERT INTO {S}.assistant_access (person_id, added_by) VALUES (@p, @by)', { p, by: await personOf(w.m.email) });
    } else if (method === 'DELETE') { if (p) await db.query('DELETE FROM {S}.assistant_access WHERE person_id = @p', { p }); } else return reply(405, { error: 'Not allowed' });
    return settings(h, 'GET');
  }

  async function handle(method, parts, body, h) {
    if (!ai) return reply(503, { error: 'The Assistant isn\'t set up yet' });
    try {
      if (parts.length === 1 && method === 'GET') {
        const w = await who(h); if (w.error) return reply(200, { allowed: false });
        const g = await mayUse(w.m);
        return reply(200, { allowed: g.ok, voice: voiceOn, admin: !!w.m.admin, mode: g.s.mode, lang: w.m.language || '' });
      }
      if (parts[1] === 'ask' && method === 'POST') return await ask(h, body);
      if (parts[1] === 'listen' && method === 'POST') return await listen(h, body);
      if (parts[1] === 'speak' && method === 'POST') return await speak(h, body);
      if (parts[1] === 'settings' && parts.length === 2) return await settings(h, method, body);
      if (parts[1] === 'access' && parts.length <= 3) return await access(h, method, parts[2], body);
      return reply(404, { error: 'not found' });
    } catch (e) {
      if (e.status === 503) return reply(503, { error: e.message });
      if (e.status === 429) return reply(429, { error: 'The Assistant is busy: try again in a moment' });
      throw e;
    }
  }
  return { handle, find, knowledge };
}

module.exports = { createAssistant, SYSTEM, TOOLS, LANGS };
