// What a lesson slide shows above its words (19 November 2026): one of the simple drawings (FIGURES, in lesson.js), or instead an
// uploaded picture or video (kept by the API's slidemedia.js), a YouTube video (video.js: captions in the site's language), or one of
// the animations (obstacle-scenes.js: an obstacle, or a movement such as the burpee). The lesson player and the lesson editor both
// draw it from here. The media is set in English and shows in every language.
import { API, esc, t } from './core.js';
import { videoHtml, wireVideos } from './video.js';

export const mediaUrl = (file) => `${API}/learn/slide-media/${encodeURIComponent(file)}`;

// the animations an editor can choose: every obstacle's, and the movements made for the lessons; the name is the scene's id
export const ANIMS = [['burpee', 'The burpee standard'], ['walls', 'Walls (6–10 ft)'], ['inverted', 'Inverted Wall'], ['slip', 'Slip Wall'], ['stairway', 'Stairway to Sparta'],
  ['bender', 'Bender'], ['rope', 'Rope Climb'], ['cargoplus', 'Vertical Cargo Plus'], ['cargo', 'Vertical Cargo / A-Frame Cargo'], ['hurdles', 'Hurdles'], ['out', 'O.U.T. / Over-Unders'],
  ['monkey', 'Monkey Bars'], ['ape', 'Ape Hanger'], ['multirig', 'Multi-Rig'], ['mitm', 'Monkey in the Middle'], ['twister', 'Twister'], ['hydra', 'Hydra'], ['helix', 'Helix'],
  ['olympus', 'Olympus'], ['zwall', 'Z Wall'], ['hanging', 'Hanging Walls'], ['tilting', 'Tilting Ladder'], ['tyrolean', 'Tyrolean Traverse'], ['hoist', 'Hercules Hoist'],
  ['atlas', 'Atlas Carry'], ['tireflip', 'Tire Flip'], ['sandbag', 'Sandbag Carry'], ['bucket', 'Bucket Carry'], ['log', 'Log Carry'], ['chain', 'Chain Carry'], ['armer', 'Armer'],
  ['drag', 'Plate / Tire Drag'], ['crawl', 'Barbed Wire / Net Crawl'], ['fire', 'Fire Jump'], ['swim', 'Swim / Water Crossing'], ['balance', 'Balance Beam'], ['slackline', 'Slackline'],
  ['spear', 'Spear Throw'], ['laser', 'Laser Pistol'], ['memory', 'Memory Test']];
export const animName = (id) => (ANIMS.find(([k]) => k === id) || [id, id])[1];

/** the slide's visual: its media if it has one, otherwise its drawing */
export function visualHtml(s, FIGURES) {
  const m = s.media;
  if (m?.type === 'image') return `<img class="lpMedia" src="${esc(mediaUrl(m.src))}" alt="" loading="lazy">`;
  if (m?.type === 'video') return `<video class="lpMedia" src="${esc(mediaUrl(m.src))}" controls playsinline preload="metadata"></video>`;
  if (m?.type === 'youtube') return videoHtml(m.src, s.heading || '');
  if (m?.type === 'anim') return `<div class="lpAnimSlot" data-scene="${esc(m.src)}"></div>`;
  return FIGURES[s.figure] || FIGURES.placeholder;
}
/** after it's on the page: a YouTube video waits for a tap; an animation loads and starts */
export function wireVisual(root) {
  if (!root) return;
  wireVideos(root);
  const slots = [...root.querySelectorAll('.lpAnimSlot')];
  if (!slots.length) return;
  Promise.all([import('./obstacle-anim.js'), import('./obstacle-scenes.js')]).then(([A, S]) => {
    for (const slot of slots) {
      const make = S.SCENES[slot.dataset.scene];
      if (!make || !slot.isConnected) continue;
      slot.innerHTML = A.playerHtml(animName(slot.dataset.scene), true);
      A.play(slot.querySelector('.obAnim'), make());
    }
  }).catch(() => { for (const slot of slots) slot.textContent = t('The animation didn’t load'); });
}
/** the YouTube id in a link someone pastes (watch, youtu.be, shorts, embed), or the id itself */
export function youtubeId(text) {
  const s = String(text || '').trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(s);
  return m ? m[1] : '';
}
/** a file sent up in pieces (slidemedia.js), with progress(0..1); resolves to { type, src } for the slide */
export async function upload(file, call, { programmeId, progress = () => {} } = {}) {
  const r = await call('slide-media', { method: 'POST', body: { name: file.name, size: file.size, programmeId } });
  const pieces = Math.max(1, Math.ceil(file.size / r.chunk));
  for (let n = 0; n < pieces; n++) {
    const buf = new Uint8Array(await file.slice(n * r.chunk, (n + 1) * r.chunk).arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    await call(`slide-media/${r.file}/${n}`, { method: 'PUT', body: { data: btoa(bin) } });
    progress((n + 1) / pieces);
  }
  const d = await call(`slide-media/${r.file}/done`, { method: 'POST', body: { pieces } });
  return { type: d.type, src: d.file };
}
