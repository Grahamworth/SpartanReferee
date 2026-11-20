// YouTube videos in a page. Until it's tapped a video is just its picture (nothing loads from YouTube before that); then the player
// starts, from youtube-nocookie.com, with captions on in the language the site is in: the video's own captions in that language if it has
// them, otherwise YouTube's translation of its English ones (the videos so far have only English captions, made by YouTube).
import { esc, t } from './core.js';

const lang = () => ((window.SR_I18N && SR_I18N.lang) || 'en').split('-')[0];
let api = null;
const loadApi = () => (api ||= new Promise((resolve, reject) => {
  if (window.YT && window.YT.Player) return resolve(window.YT);
  const before = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { if (before) before(); resolve(window.YT); };
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.onerror = () => { api = null; reject(new Error('YouTube didn’t load')); };
  document.head.append(s);
}));

/** the picture with a play button; wireVideos turns it into the player when tapped */
export const videoHtml = (id, title) => `<button type="button" class="ytFacade" data-yt="${esc(id)}" aria-label="${esc(t('Play the video: {title}', { title: t(title) }))}">
  <img src="https://i.ytimg.com/vi/${esc(id)}/hqdefault.jpg" alt="" loading="lazy"><span class="ytPlay" aria-hidden="true"></span></button>`;

/** captions in the site's language: its own track if there is one, otherwise the English (or first) one translated. The player only
 *  lists its tracks some time after the video starts (and not always the ones YouTube made), so with no list yet this asks for the English
 *  translated anyway; true once a listed track has been set */
function captions(player, l) {
  const list = player.getOption('captions', 'tracklist') || [];
  const own = list.find((x) => (x.languageCode || '').split('-')[0] === l);
  if (own) { player.setOption('captions', 'track', { languageCode: own.languageCode }); return true; }
  const src = list.find((x) => (x.languageCode || '').startsWith('en')) || list[0] || { languageCode: 'en' };
  player.setOption('captions', 'track', l === 'en' ? { languageCode: src.languageCode } : { languageCode: src.languageCode, translationLanguage: { languageCode: l } });
  return list.length > 0;
}

async function start(btn) {
  const id = btn.dataset.yt, l = lang(), box = document.createElement('div'), holder = document.createElement('div');
  box.className = 'ytBox'; box.append(holder); btn.replaceWith(box);
  try {
    const YT = await loadApi();
    let done = false, tries = 0;
    const set = () => { if (!done) { try { done = captions(box.player, l); } catch { /* the captions stay as YouTube chose */ } } };
    box.player = new YT.Player(holder, {
      host: 'https://www.youtube-nocookie.com', videoId: id,
      playerVars: { autoplay: 1, playsinline: 1, rel: 0, cc_load_policy: 1, cc_lang_pref: l, hl: l },
      events: {
        // iPhones only start a video with sound straight from a tap, and the player arrives after it: if it hasn't started, it starts
        // muted (allowed), with captions, so the tap never leaves YouTube's own play screen (whose title and logo open the YouTube app)
        onReady: (e) => {
          const p = e.target;
          p.playVideo();
          for (const ms of [1200, 3500]) setTimeout(() => { if (!box.started && p.getPlayerState() !== 3) { p.mute(); p.playVideo(); } }, ms);
        },
        // the captions part of the player arrives once the video plays: set the language then, and again a few times as its tracks come in
        onApiChange: set,
        onStateChange: (e) => { if (e.data === 1) box.started = true; if (e.data === 1 && !done && tries++ < 1) for (const ms of [800, 2500, 5000]) setTimeout(set, ms); },
      },
    });
  } catch {
    box.innerHTML = `<p class="note"><a href="https://www.youtube.com/watch?v=${esc(id)}" target="_blank" rel="noopener">${esc(t('Watch it on YouTube'))}</a></p>`;
  }
}
export function wireVideos(root = document) {
  for (const b of root.querySelectorAll('button[data-yt]')) b.addEventListener('click', () => start(b), { once: true });
}
