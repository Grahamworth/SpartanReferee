// Video judgement clips (step 4): a burpee, drawn by the site's own animated figure (tracked-demos.js), done right or with one fault,
// so a question can ask "does it meet the standard?" without third-party footage. It plays on request (never by itself), loops, and
// can be paused; it's a short silent loop, so it has a text description too.
import { POSES, drawFrame, poseAt } from '../tracked-demos.js';

const { STAND, CROUCH, PLANK, CHEST_DOWN, JUMP } = POSES;
const NEAR_GROUND = { ...PLANK, head: [79, 66], arm: [[72, 70], [73, 79], [73, 87]], torso: [[72, 70], [46, 74]] }; // chest stays well off the ground
const HALF_UP = { ...CROUCH, head: [56, 30], torso: [[54, 38], [44, 58]] }; // hips not extended at the top
const STEPS = {
  good: [STAND, CROUCH, PLANK, CHEST_DOWN, PLANK, CROUCH, STAND, JUMP],
  noJump: [STAND, CROUCH, PLANK, CHEST_DOWN, PLANK, CROUCH, STAND, STAND],
  shallow: [STAND, CROUCH, PLANK, NEAR_GROUND, PLANK, CROUCH, STAND, JUMP],
  noExtension: [HALF_UP, CROUCH, PLANK, CHEST_DOWN, PLANK, CROUCH, HALF_UP, HALF_UP],
};
const TIMING = [[0.2, 0.25], [0.35, 0.02], [0.28, 0.04], [0.28, 0.45], [0.28, 0.04], [0.28, 0.02], [0.22, 0], [0.22, 0.45]];
export const DESCRIBE = {
  good: 'An athlete does burpees: down to the ground with the chest touching, back up to standing, then a jump with the hands above the head.',
  noJump: 'An athlete does burpees: down to the ground with the chest touching, back up to standing, then straight into the next one without jumping.',
  shallow: 'An athlete does burpees: down into a plank with the chest staying above the ground, back up to standing, then a jump with the hands above the head.',
  noExtension: 'An athlete does burpees: down to the ground with the chest touching, but only half stands up between them, hips bent, without a full jump.',
};

/** draws a clip into holder: a canvas, a play/pause button and its description */
export function clip(holder, variant = 'good') {
  const steps = (STEPS[variant] || STEPS.good).map((pose, i) => ({ pose, move: TIMING[i][0], hold: TIMING[i][1] }));
  holder.innerHTML = '<div class="clip"><canvas width="320" height="320" role="img"></canvas><button type="button" class="clipBtn">Play the clip</button></div><p class="note clipText"></p>';
  const canvas = holder.querySelector('canvas'), btn = holder.querySelector('button'), ctx = canvas.getContext('2d');
  canvas.setAttribute('aria-label', DESCRIBE[variant] || DESCRIBE.good);
  holder.querySelector('.clipText').textContent = `Described: ${DESCRIBE[variant] || DESCRIBE.good}`;
  const css = getComputedStyle(holder), read = (n) => css.getPropertyValue(n).trim();
  const colours = { line: read('--line'), body: read('--muted'), top: read('--primary'), track: read('--accent'), hit: read('--accent'), dot: read('--text') };
  let playing = false, start = 0, raf = 0, at = 0.3;
  const paint = (t) => drawFrame(ctx, 320, poseAt(steps, t).pose, colours, false);
  const frame = (ms) => { if (!playing) return; at = (ms - start) / 1000; paint(at); raf = requestAnimationFrame(frame); };
  btn.onclick = () => {
    playing = !playing; btn.textContent = playing ? 'Pause' : 'Play the clip';
    if (playing) { start = performance.now() - at * 1000; raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf);
  };
  paint(at);
}
