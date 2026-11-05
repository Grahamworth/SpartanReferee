import { BurpeeJudge, GestureJudge, computeMetrics, DEFAULTS, LM } from './burpee.js';
import { EXERCISES, exercise, applyStrictness, PushupJudge, STRICTNESS_DEFAULT, strictnessWord, strictnessValue } from './exercises.js';
import { PoseFilter, TRACKING } from './pose-filter.js';
import { MultiTracker, MULTI_DEFAULTS, fromCrop, drawMasks, scanAreas, joinResults, unclaimedBoxes, boxArea } from './multi.js';
import { loadFinder } from './finder.js';
import { prepareDigits } from './ocr-prep.js';
import { createReader, mirrorImage, ENGINES } from './readers.js';
import { call, getMe, saveAttempt, loadLocalAttempts, bestAttempt, scoreKey, syncAttempts, loadAttempts } from './api-base.js';

// The pose engine and models. Inside the Receiver and the Android/iPhone app they're built in (vendor/), so
// judging works without internet; the website loads them from the internet (they're too big for the site).
const LOCAL = location.protocol === 'app:' || location.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(location.hostname);
const here = (p) => new URL(p, import.meta.url).href;
const MP_BASE = LOCAL ? here('vendor/mediapipe') : 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MP_BUNDLE = LOCAL ? `${MP_BASE}/vision_bundle.js` : `${MP_BASE}/vision_bundle.mjs`;
const MP_MODELS = 'https://storage.googleapis.com/mediapipe-models';
const model = (local, remote) => (LOCAL ? here(`vendor/mediapipe/models/${local}`) : `${MP_MODELS}/${remote}`);
const FACE_URL = model('blaze_face_short_range.tflite', 'face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite');
const MODEL_URLS = {
  lite: model('pose_landmarker_lite.task', 'pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task'),
  full: model('pose_landmarker_full.task', 'pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'),
  heavy: model('pose_landmarker_heavy.task', 'pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'),
};

const GESTURE_URL = model('gesture_recognizer.task', 'gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task');

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('canvas');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- settings

// judge.html?cfg=cam1 (a camera in the Receiver's video review): that camera's own settings, starting from the
// device's usual ones
const CFG = (new URLSearchParams(location.search).get('cfg') || '').replace(/[^a-z0-9]/gi, '');
// a camera's judge can hide its tracking (it still tracks and counts): see cameraSettings
const applyTracking = () => document.documentElement.classList.toggle('hide-tracking', !!CFG && !!new URLSearchParams(location.search).get('go') && settings.showTracking === false);
// judge.html?mode=practice: the Spartans Challenge, open to anyone (see the end of this file)
const PRACTICE = new URLSearchParams(location.search).get('mode') === 'practice';
// served by the Receiver app (its window, or /judge/ from its review server): the only place the fist test is offered
const IN_RECEIVER = location.protocol === 'app:' || location.pathname.startsWith('/judge/');
const CHALLENGE_EXERCISE = EXERCISES[new URLSearchParams(location.search).get('exercise')] ? new URLSearchParams(location.search).get('exercise') : 'burpees';
const SETTINGS_KEY = CFG ? `burpeeJudge.settings.${CFG}` : PRACTICE ? 'burpeeJudge.settings.practice' : 'burpeeJudge.settings';
const RESULTS_KEY = 'burpeeJudge.results';
// The burpee limits, and how straight push-up arms must be, before the
// strictness slider moves them. Not editable: the slider is the only control.
const JUDGE_LIMITS = ['chestMaxRatio', 'jumpMinLift', 'hipMinAngle', 'handsTolerance', 'downEnterTilt'];
const OLD_THRESHOLD_SETTINGS = [...JUDGE_LIMITS, 'pushupStraight']; // were in Settings once
const APP_VERSION = '2026-10-30';
const DEFAULT_SETTINGS = {
  station: '', facing: 'user', orientation: 'auto', model: 'full',
  repsChoice: '30', customReps: '',
  speech: true, record: true, debug: false, exercise: 'burpees', tracking: 'balanced',
  bibMin: 1, bibMax: 6, bibList: '', ocrEngine: 'digits', captureBib: true, people: 'multi', videoPace: 'prepass', strictness: STRICTNESS_DEFAULT, targetReps: DEFAULTS.targetReps,
};

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

let settings = { ...DEFAULT_SETTINGS, ...(CFG ? readJSON('burpeeJudge.settings', {}) : {}), ...readJSON(SETTINGS_KEY, {}) };
if (settings.repsChoice !== 'custom') { settings.repsChoice = '30'; settings.targetReps = 30; } // 15 was an option once
if (settings.practice) settings.exercise = 'practice'; // practice was a checkbox once
delete settings.practice;
settings.strictness = strictnessValue(settings.strictness); // was lenient/standard/strict once
for (const k of OLD_THRESHOLD_SETTINGS) delete settings[k];
// Several athletes became the default; phones that saved 'one' before then switch once.
// The official judge always tracks several athletes. The one-person hand-close test is only in the Receiver.
settings.people = 'multi';
if (exercise(settings.exercise).gestures && !IN_RECEIVER) settings.exercise = 'burpees';
// Analysing a test video first, then playing it at normal speed, became the
// default; phones that saved another choice before then switch once.
if (settings.videoPaceV !== 1) { settings.videoPace = 'prepass'; settings.videoPaceV = 1; }
queueMicrotask(() => applyTracking());
// Race-day setup for Spartan penalty burpees: several athletes, their numbers read from the head bands laid in
// front of them, lenient judging and tracking that holds on to people readily.
const SPARTAN_DEFAULT = {
  exercise: 'burpees', people: 'multi', captureBib: true, strictness: 20,
  tracking: 'forgiving', model: 'full', speech: true, record: true, debug: false,
};
// The Spartans Challenge judges to the same Spartan setup, for one person with no number; the voice is their choice.
if (PRACTICE) Object.assign(settings, SPARTAN_DEFAULT, { exercise: CHALLENGE_EXERCISE, people: 'one', captureBib: false, record: false, speech: settings.speech });
const currentExercise = () => exercise(settings.exercise);
const tracking = () => TRACKING[settings.tracking] || TRACKING.balanced;
const metricOpts = () => ({ ...DEFAULTS, minVisibility: tracking().minVis, aspect: S.frame?.w && S.frame?.h ? S.frame.w / S.frame.h : 1 });
const saveSettings = () => writeJSON(SETTINGS_KEY, settings);
const judgeOptions = () => ({
  ...Object.fromEntries(JUDGE_LIMITS.map((k) => [k, DEFAULTS[k]])),
  pushupStraight: PushupJudge.DEFAULTS.lockElbow,
  targetReps: Number(settings.targetReps),
});
const bibList = () => new Set((settings.bibList.match(/\d+/g) || []));
// Several athletes at once is a test mode; it never reads race numbers.
// several athletes at once, except hand-close practice, which watches one person's hand
const multiMode = () => !!S.forceMulti || (!PRACTICE && !exercise(settings.exercise).gestures);
// "Bib 123", or "Athlete 3" when numbers aren't captured.
const bibTitle = (r) => (r.bib === 'No number' ? `Athlete ${r.athlete ?? ''} · no number` : r.bibSource === 'none' ? `Athlete ${r.bib}` : `Bib ${r.bib}`);
function setBibWord(source) {
  for (const el of document.querySelectorAll('.bib-word')) el.textContent = source === 'none' ? 'Athlete' : 'Bib';
}

// ---------------------------------------------------------------- state

const S = {
  screen: 'home',
  landmarker: null, landmarkerKey: null, landmarkerLoading: null, scanner: null,
  gestures: null, gesturesLoading: null, gesture: null, handLm: null,
  faces: null, facesLoading: null, filter: null,
  reader: null, readerLoading: null, ocrReads: [], ocrFlip: false, ocrFlipKnown: false, headBox: null, scanHint: '', typing: false,
  pose: null, others: 0, metrics: null, lastVideoTime: -1,
  frameTimes: [], procTimes: [], clockBase: 0,
  bib: null, bibSource: null, bibConf: null, judge: null, attempt: null,
  frame: null, lastPoseT: null, repFlashTimer: null,
  readySince: null,
  recorder: null, chunks: [],
  testMode: false,
  stream: null, // a phone's stream being judged (see startStream)
  multi: null, multiRes: null, multiExtra: null, athleteNo: 0, lastModelT: 0,
  finder: null, finderError: null, finderLoading: false, finderReady: null, paceAt: 0,
  pace: 'prepass', nextPace: null,
  testTurn: 0,
  quiet: false, prepassing: false, replay: null, replayEvents: [], replayEvAt: 0, videoDur: 0, seekDrag: false, findBusy: false, findAt: -Infinity, findBoxes: null,
  flashUntil: 0, flashGood: false,
  doneTimer: null,
  audio: null, wakeLock: null,
};

// ---------------------------------------------------------------- screens

const CAMERA_SCREENS = new Set(['scan', 'position', 'countdown', 'count', 'done']);

// Screens where the "What counts?" button shows: home and whenever the camera is on.
const RULES_SCREENS = new Set(['home', 'setup', ...CAMERA_SCREENS]);

function show(id) {
  if (PRACTICE && id === 'home') id = 'setup'; // the Spartans Challenge has no station to set up
  document.querySelectorAll('.screen').forEach((el) => { el.hidden = el.id !== id; });
  $('stage').hidden = !CAMERA_SCREENS.has(id);
  S.screen = id;
  $('rulesBtn').hidden = !RULES_SCREENS.has(id);
  $('exitStation').hidden = !CAMERA_SCREENS.has(id);
  document.body.classList.toggle('has-rules-btn', RULES_SCREENS.has(id));
  if (!RULES_SCREENS.has(id)) showRules(false);
  if (id !== 'count' && id !== 'done') hideRepFlash();
  if (id === 'scan' && !S.typing) scheduleOcr();
}

// ---------------------------------------------------------------- orientation
//
// "Landscape" is for a phone standing on its side with rotation lock on. The
// browser then keeps the page and the camera frames portrait, so the athlete
// would appear lying down and the screen would read sideways. We turn the
// frames a quarter turn before judging, and turn the whole page with CSS.
// With rotation lock off the browser does both itself, and nothing is turned.

const rotCanvas = document.createElement('canvas');

// Quarter turns to apply to the raw frame: -1 anticlockwise, 1 clockwise.
// "left" means the top of the phone is on the left as you look at the screen.
// The front camera's raw (unmirrored) frame turns the other way to the back
// camera's.
function frameTurn() {
  const o = settings.orientation;
  if (o !== 'left' && o !== 'right') return 0;
  const back = S.testMode || S.stream || settings.facing === 'environment';
  return (o === 'left' ? -1 : 1) * (back ? 1 : -1);
}

// The frame everything works from: the video, or the video turned upright.
function frameSource() {
  const vw = video.videoWidth, vh = video.videoHeight;
  // A test video filmed with the phone turned on its side: the buttons turn
  // it back upright, a quarter turn at a time (the ⟲ and ⟳ buttons).
  if (S.testMode) return S.testTurn ? turnedFrame(S.testTurn) : { src: video, w: vw, h: vh };
  const turn = frameTurn();
  if (!turn || vw >= vh) return { src: video, w: vw, h: vh };
  if (rotCanvas.width !== vh || rotCanvas.height !== vw) { rotCanvas.width = vh; rotCanvas.height = vw; }
  const c = rotCanvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.translate(vh / 2, vw / 2);
  c.rotate((turn * Math.PI) / 2);
  c.drawImage(video, -vw / 2, -vh / 2);
  return { src: rotCanvas, w: vh, h: vw };
}

// The video turned by quarter turns (1 = clockwise, 2 = upside down, 3 = anticlockwise).
function turnedFrame(q) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const W = q % 2 ? vh : vw, H = q % 2 ? vw : vh;
  if (rotCanvas.width !== W || rotCanvas.height !== H) { rotCanvas.width = W; rotCanvas.height = H; }
  const c = rotCanvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.translate(W / 2, H / 2);
  c.rotate((q * Math.PI) / 2);
  c.drawImage(video, -vw / 2, -vh / 2);
  return { src: rotCanvas, w: W, h: H };
}

function applyPageTurn() {
  const o = settings.orientation;
  const portraitPage = window.innerHeight > window.innerWidth;
  document.documentElement.classList.toggle('turn-left', o === 'left' && portraitPage);
  document.documentElement.classList.toggle('turn-right', o === 'right' && portraitPage);
}
window.addEventListener('resize', applyPageTurn);
window.addEventListener('orientationchange', applyPageTurn);

// ---------------------------------------------------------------- pose model

async function loadLandmarker() {
  const conf = tracking().mpConf;
  const numPoses = multiMode() ? MULTI_DEFAULTS.maxPeople : 2;
  const mdl = S.modelOverride || settings.model;
  const key = `${mdl}:${conf}:${numPoses}`;
  if (S.landmarker && S.landmarkerKey === key) return S.landmarker;
  if (S.landmarkerLoading?.key === key) return S.landmarkerLoading.promise;
  const promise = (async () => {
    const { FilesetResolver, PoseLandmarker } = await import(MP_BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URLS[mdl], delegate },
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: conf,
      minTrackingConfidence: conf,
    });
    let lmk;
    try { lmk = await make('GPU'); } catch { lmk = await make('CPU'); }
    S.landmarker?.close();
    S.landmarker = lmk;
    // Several athletes: a second model takes the second looks, with people
    // already found painted over (see secondLook).
    S.scanner?.close();
    S.scanner = null;
    if (numPoses > 2) {
      const scan = (delegate) => PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URLS.full, delegate }, runningMode: 'IMAGE', numPoses: 3,
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: conf, minTrackingConfidence: conf,
      });
      try { S.scanner = await scan('GPU'); } catch { S.scanner = await scan('CPU').catch(() => null); }
      // And the person finder, in the background: until it's ready (or if it
      // can't run on this phone) the painted-over looks do its job.
      if (!S.finder && !S.finderLoading) {
        S.finderLoading = true;
        S.finderReady = loadFinder().then((fd) => { S.finder = fd; S.finderError = null; }).catch((e) => { S.finderError = e?.message || 'did not load'; }).finally(() => { S.finderLoading = false; });
      }
    }
    S.landmarkerKey = key;
    return lmk;
  })();
  S.landmarkerLoading = { key, promise };
  try { return await promise; } finally { S.landmarkerLoading = null; }
}

// Face finder for reading a headband close up, when too little of the body is
// in view for the pose model. Loaded with the station.
async function loadFaces() {
  if (S.faces) return S.faces;
  if (S.facesLoading) return S.facesLoading;
  S.facesLoading = (async () => {
    const { FilesetResolver, FaceDetector } = await import(MP_BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) => FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: FACE_URL, delegate },
      runningMode: 'VIDEO',
      minDetectionConfidence: 0.6,
    });
    try { S.faces = await make('GPU'); } catch { S.faces = await make('CPU'); }
    return S.faces;
  })();
  try { return await S.facesLoading; } finally { S.facesLoading = null; }
}

// Practice mode's hand-gesture model, loaded only when practice mode is on.
async function loadGestures() {
  if (S.gestures) return S.gestures;
  if (S.gesturesLoading) return S.gesturesLoading;
  S.gesturesLoading = (async () => {
    const { FilesetResolver, GestureRecognizer } = await import(MP_BUNDLE);
    const fileset = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
    const make = (delegate) => GestureRecognizer.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: GESTURE_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 1,
    });
    try { S.gestures = await make('GPU'); } catch { S.gestures = await make('CPU'); }
    return S.gestures;
  })();
  try { return await S.gesturesLoading; } finally { S.gesturesLoading = null; }
}

function renderExercise() {
  const ex = currentExercise();
  const key = settings.exercise;
  const banner = $('exerciseBanner');
  banner.hidden = key === 'burpees';
  banner.classList.toggle('practice', !!ex.gestures);
  banner.textContent = ex.gestures
    ? 'Practice mode is on: a fist then an open hand counts as a rep. Change the exercise in Settings before race use.'
    : `Exercise: ${ex.label}. Change it in Settings.`;
  $('repsLabel').textContent = ex.label;
  $('customUnit').textContent = ex.unit;
  $('scanUnit').textContent = ex.unit;
  $('posTitle').textContent = ex.ready.title;
  $('chkStand').textContent = ex.ready.check;
  // What counts? panel: drawn figures for burpees, a plain list otherwise.
  $('rulesEyebrow').textContent = key === 'burpees' ? 'Spartan penalty burpee' : ex.label;
  $('rulesFlow').textContent = ex.flow;
  $('rulesCamera').textContent = ex.camera || '';
  $('rulesCamera').hidden = !ex.camera;
  $('rulesBurpee').hidden = key !== 'burpees';
  const list = $('rulesList');
  list.hidden = key === 'burpees';
  list.replaceChildren(...ex.standards.map(([title, text]) => {
    const li = document.createElement('li');
    const h = document.createElement('h3'); h.textContent = title;
    const p = document.createElement('p'); p.textContent = text;
    li.append(h, p);
    return li;
  }));
}

function showRules(open) {
  $('rules').hidden = !open;
  $('rulesBtn').setAttribute('aria-expanded', String(open));
}

function preloadModel() {
  $('homeStatus').textContent = 'Loading pose model…';
  loadLandmarker()
    .then(() => { $('homeStatus').textContent = `Pose model ready (${settings.model}).`; })
    .catch((e) => {
      $('homeStatus').textContent = '';
      showHomeError(`The pose model didn't load: ${e.message}. Check the phone has internet and reload.`);
    });
}

// Pick the athlete: the biggest person in frame. Count others large enough to matter.
function pickPose(res) {
  if (!res?.landmarks?.length) return { pose: null, others: 0 };
  const sized = res.landmarks.map((lm, i) => {
    const pts = lm.filter((p) => (p.visibility ?? 1) > 0.5);
    if (!pts.length) return { i, area: 0 };
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    return { i, area: (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) };
  }).sort((a, b) => b.area - a.area);
  const main = sized[0];
  const others = sized.slice(1).filter((s) => s.area > main.area * 0.35).length;
  return { pose: { lm: res.landmarks[main.i], wlm: res.worldLandmarks[main.i] }, others };
}

// ---------------------------------------------------------------- camera

async function startCamera() {
  stopCamera();
  if (!window.isSecureContext) throw new Error('The camera only works over https:// (or on localhost).');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser has no camera access.');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: settings.facing, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
    audio: false,
  });
  video.removeAttribute('src');
  video.srcObject = stream;
  await video.play();
  S.mirror = settings.facing === 'user';
  S.ocrFlipKnown = false;
}

function stopCamera() {
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  stopStream();
}

// ---------------------------------------------------------------- watching a stream
//
// A phone streams (Larix) to MediaMTX on this computer, which hands the video
// to the browser over WebRTC: the browser offers to receive, posts the offer
// to the stream's address (WHEP) and gets the answer back. The stream then
// stands in for the camera, and everything else works as with a camera.
// Use the localhost address on the computer running MediaMTX: browsers block
// an https page from fetching a plain http address elsewhere on the network.
const DEFAULT_STREAM_URL = 'http://localhost:8889/live/station1/whep';

async function connectStream(url) {
  // the stream's page address (…/live/station1) works too: WHEP lives at …/whep
  url = url.trim();
  if (!/\/whep\/?$/i.test(url)) url = url.replace(/\/+$/, '') + '/whep';
  const pc = new RTCPeerConnection();
  pc.addTransceiver('video', { direction: 'recvonly' });
  const track = new Promise((res) => { pc.ontrack = (e) => res(e.streams[0] || new MediaStream([e.track])); });
  await pc.setLocalDescription(await pc.createOffer());
  // Send the offer once this computer's own addresses are in it (or after 2 s).
  await new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    const t = setTimeout(res, 2000);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); res(); } });
  });
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
  } catch {
    pc.close();
    throw new Error(`Couldn't reach ${url}. Is the streaming server running on this computer? (Use a localhost address here; if the browser asks to allow access to devices on your local network, allow it.)`);
  }
  if (!r.ok) {
    pc.close();
    throw new Error(r.status === 404 ? 'Nothing is streaming to that address yet. Start Larix on the phone, then try again.' : `The streaming server refused (${r.status}).`);
  }
  try {
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    const media = await Promise.race([track, new Promise((_, rej) => setTimeout(() => rej(new Error('No video arrived from the stream.')), 10000))]);
    return { pc, media };
  } catch (e) { pc.close(); throw e; }
}

async function startStream(url) {
  stopCamera();
  const { pc, media } = await connectStream(url);
  S.stream = { url, pc, retry: null };
  watchStream(pc);
  video.removeAttribute('src');
  video.srcObject = media;
  video.muted = true;
  await video.play();
  S.mirror = false;
  S.ocrFlipKnown = false;
}

// A dropped stream (phone lost signal, Larix stopped) is reconnected every
// few seconds; the count screen says so meanwhile.
function watchStream(pc) {
  pc.addEventListener('connectionstatechange', () => {
    if (!S.stream || S.stream.pc !== pc) return;
    if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') reconnectStream();
  });
}

function reconnectStream() {
  const st = S.stream;
  if (!st || st.retry) return;
  st.lost = true;
  st.retry = setTimeout(async () => {
    st.retry = null;
    if (S.stream !== st) return;
    try {
      const { pc, media } = await connectStream(st.url);
      try { st.pc.close(); } catch { /* already closed */ }
      st.pc = pc;
      watchStream(pc);
      video.srcObject = media;
      await video.play();
      st.lost = false;
    } catch {
      reconnectStream();
    }
  }, 3000);
}

function stopStream() {
  const st = S.stream;
  if (!st) return;
  S.stream = null;
  clearTimeout(st.retry);
  try { st.pc.close(); } catch { /* already closed */ }
}

async function keepAwake() {
  try { S.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not granted */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && CAMERA_SCREENS.has(S.screen)) keepAwake();
});

// ---------------------------------------------------------------- sound

function beep(freq, ms, type = 'sine', gain = 0.25) {
  const a = S.audio;
  if (!a || S.quiet || (PRACTICE && !settings.speech)) return; // the challenge's mute button silences everything
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(gain, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + ms / 1000);
  o.connect(g).connect(a.destination);
  o.start(); o.stop(a.currentTime + ms / 1000);
}

// Android's in-app browser has no speech of its own: the app's Speech plugin says it instead.
const nativeSpeech = () => (window.Capacitor?.getPlatform?.() === 'android' ? window.Capacitor.Plugins?.Speech : null);
function say(text) {
  if (!settings.speech || S.quiet) return;
  const native = nativeSpeech();
  if (native) { native.speak({ text, rate: 1.15 }).catch(() => {}); return; }
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.15;
  speechSynthesis.speak(u);
}

// ---------------------------------------------------------------- bib scanning (OCR)

// The number reader chosen in Settings, loaded once.
async function ensureReader() {
  const engine = settings.ocrEngine;
  if (S.reader?.engine === engine) return S.reader;
  if (S.readerLoading?.engine === engine) return S.readerLoading.promise;
  const promise = (async () => {
    const r = createReader(engine);
    await r.load();
    S.reader = r;
    return r;
  })();
  S.readerLoading = { engine, promise };
  try { return await promise; } finally { S.readerLoading = null; }
}

// Where a headband number sits, in frame pixels, from the tracked head: a box
// over the forehead, sized from the distance between the ears. Follows the
// athlete as they sway. null if no head is in view.
function headBandBox(lm) {
  if (!lm || !S.frame) return null;
  const { w, h } = S.frame;
  const minVis = Math.min(0.5, tracking().minVis);
  const seen = (i) => lm[i] && (lm[i].visibility ?? 1) >= minVis;
  const P = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const dist = (a, b) => Math.hypot(P(a).x - P(b).x, P(a).y - P(b).y);
  if (!seen(LM.NOSE)) return null;
  const nose = P(LM.NOSE);
  let e; // head width in pixels, from the ears, or the eyes when the ears are hidden
  if (seen(LM.L_EAR) && seen(LM.R_EAR)) e = dist(LM.L_EAR, LM.R_EAR);
  else if (seen(LM.L_EAR)) e = 2 * dist(LM.L_EAR, LM.NOSE);
  else if (seen(LM.R_EAR)) e = 2 * dist(LM.R_EAR, LM.NOSE);
  else if (seen(LM.L_EYE) && seen(LM.R_EYE)) e = 2.5 * dist(LM.L_EYE, LM.R_EYE);
  else return null;
  const eyes = [2, 5].filter(seen).map(P); // MediaPipe left/right eye
  const eyeY = eyes.length ? eyes.reduce((t, p) => t + p.y, 0) / eyes.length : nose.y - 0.15 * e;
  const bw = 2.3 * e, bh = 1.6 * e;
  const x = Math.max(0, nose.x - bw / 2), y = Math.max(0, eyeY - 0.75 * e - bh / 2);
  return { x, y, w: Math.min(bw, w - x), h: Math.min(bh, h - y), headPx: e };
}

// The same forehead box from a face detection (close up). Uses the biggest face.
function faceBandBox(res) {
  if (!res?.detections?.length || !S.frame) return null;
  const { w, h } = S.frame;
  const d = res.detections.reduce((a, b) => (b.boundingBox.width > a.boundingBox.width ? b : a));
  const bb = d.boundingBox;
  const kp = d.keypoints || [];
  // BlazeFace keypoints: 0 right eye, 1 left eye, 2 nose tip, 3 mouth, 4 right ear, 5 left ear.
  const eyeY = kp[0] && kp[1] ? ((kp[0].y + kp[1].y) / 2) * h : bb.originY + bb.height * 0.4;
  const cx = kp[2] ? kp[2].x * w : bb.originX + bb.width / 2;
  const e = bb.width;
  const bw = 2.3 * e, bh = 1.6 * e;
  const x = Math.max(0, cx - bw / 2), y = Math.max(0, eyeY - 0.75 * e - bh / 2);
  return { x, y, w: Math.min(bw, w - x), h: Math.min(bh, h - y), headPx: e };
}

// Crop a box from the frame as grayscale, scaled so it is about targetH tall.
const cropCanvas = document.createElement('canvas');
function grabGray(b, targetH) {
  const scale = Math.min(6, 960 / b.w, targetH / b.h);
  const W = (cropCanvas.width = Math.round(b.w * scale));
  const H = (cropCanvas.height = Math.round(b.h * scale));
  const c = cropCanvas.getContext('2d', { willReadFrequently: true });
  c.imageSmoothingQuality = 'high';
  c.drawImage(S.frame?.src || video, b.x, b.y, b.w, b.h, 0, 0, W, H);
  const d = c.getImageData(0, 0, W, H).data;
  const gray = new Uint8Array(W * H);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
  return { gray, W, H };
}

// Fallback when no digit run is found: Otsu-binarize, cut down to the bright
// band the number is printed on, and pad with white.
function otsuImage(gray, W, H) {
  const hist = new Array(256).fill(0);
  for (const v of gray) hist[v]++;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = W * H - wB;
    if (!wF) break;
    sB += i * hist[i];
    const between = wB * wF * (sB / wB - (sum - sB) / wF) ** 2;
    if (between > best) { best = between; thr = i; }
  }
  const rows = new Array(H).fill(0), cols = new Array(W).fill(0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (gray[y * W + x] > thr) { rows[y]++; cols[x]++; }
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) if (rows[y] > W * 0.15) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  for (let x = 0; x < W; x++) if (cols[x] > (y1 - y0) * 0.3) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); }
  if (x1 <= x0 || y1 <= y0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
  const s = Math.min(3, Math.max(1, 220 / (y1 - y0 + 1)));
  const pad = 30;
  const width = Math.round((x1 - x0 + 1) * s) + pad * 2, height = Math.round((y1 - y0 + 1) * s) + pad * 2;
  const data = new Uint8ClampedArray(width * height).fill(255);
  for (let py = pad; py < height - pad; py++) {
    const y = y0 + Math.floor((py - pad) / s);
    for (let px = pad; px < width - pad; px++) {
      const x = x0 + Math.floor((px - pad) / s);
      data[py * width + px] = gray[y * W + x] > thr ? 255 : 0;
    }
  }
  return { width, height, data };
}

// One gray byte per pixel -> canvas, optionally mirrored.
function toCanvas(img, flip = false) {
  const src = document.createElement('canvas');
  src.width = img.width; src.height = img.height;
  const sc = src.getContext('2d');
  const id = sc.createImageData(img.width, img.height);
  for (let i = 0; i < img.data.length; i++) {
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = img.data[i];
    id.data[i * 4 + 3] = 255;
  }
  sc.putImageData(id, 0, 0);
  if (!flip) return src;
  const out = document.createElement('canvas');
  out.width = img.width; out.height = img.height;
  const oc = out.getContext('2d');
  oc.translate(img.width, 0); oc.scale(-1, 1);
  oc.drawImage(src, 0, 0);
  return out;
}

// Shows the athlete what the scanner is reading, so they can line it up.
function showPeek(cv) {
  const peek = $('ocrPeek');
  if (!cv) { peek.hidden = true; return; }
  peek.width = cv.width; peek.height = cv.height;
  peek.getContext('2d').drawImage(cv, 0, 0);
  peek.hidden = false;
}

// Keeps reads that are sure enough, the right length and (if a start list is
// loaded) a real race number.
function filterBibs(cands, minConf) {
  const list = bibList();
  const min = Number(settings.bibMin), max = Number(settings.bibMax);
  return cands
    .filter((w) => w.conf >= minConf && w.text.length >= min && w.text.length <= max)
    .filter((w) => !list.size || list.has(w.text))
    .sort((a, b) => b.conf - a.conf);
}

let ocrTimer = null;
function scheduleOcr(delay = 300) {
  clearTimeout(ocrTimer);
  ocrTimer = setTimeout(ocrTick, delay);
}

async function ocrTick() {
  if (S.screen !== 'scan' || S.typing) return; // the marshal is typing the number
  if (!video.videoWidth || !S.frame) return scheduleOcr();
  try {
    const reader = await ensureReader();
    if (S.screen !== 'scan') return;
    // Only read from the forehead of a detected person (from the pose when
    // standing back, from the face finder when close up), so numbers elsewhere
    // in the picture are never read.
    const opts = { minDigits: Number(settings.bibMin), maxDigits: Number(settings.bibMax) };
    let runs = [], fallback = null;
    const head = S.headBox;
    if (!head) {
      showPeek(null);
      $('ocrReading').textContent = S.scanHint || '–';
      S.ocrReads.push(null);
      S.ocrReads = S.ocrReads.slice(-4);
      return scheduleOcr(200);
    }
    const g = grabGray(head, 260);
    runs = prepareDigits(g.gray, g.W, g.H, opts);
    if (!runs.length) fallback = otsuImage(g.gray, g.W, g.H);
    // The digit model is quick enough to try every candidate; the others try
    // the best two, stopping at the first that reads. The Otsu fallback is only worth it for Tesseract.
    const images = runs.length
      ? (reader.engine === 'digits' ? runs : runs.slice(0, 2))
      : fallback && reader.engine === 'tesseract' ? [fallback] : [];
    showPeek(images.length ? toCanvas(images[0]) : null);
    // Some front cameras deliver mirrored frames. Once a read shows which way
    // round this camera is, only read that way; until then try both.
    // The digit model is cheap enough to always check both; the slower readers
    // re-check the other way every fifth try in case the guess was wrong.
    S.ocrTries = (S.ocrTries || 0) + 1;
    const sides = !S.ocrFlipKnown || reader.engine === 'digits' || S.ocrTries % 5 === 0 ? [S.ocrFlip, !S.ocrFlip] : [S.ocrFlip];
    const minConf = ENGINES[reader.engine].minConf;
    let top = null, reads = 0;
    const t0 = performance.now();
    for (const img of images) {
      for (const flip of sides) {
        const view = flip ? mirrorImage(img) : img;
        const cands = filterBibs(await reader.read(view), minConf);
        reads++;
        if (S.screen !== 'scan') return;
        if (cands.length) { top = { ...cands[0], view, flip }; break; }
      }
      if (top) break;
    }
    if (reads) $('ocrMeta').textContent = `${ENGINES[reader.engine].label} · ${Math.round((performance.now() - t0) / reads)} ms per read`;
    if (top) {
      S.ocrFlip = top.flip;
      S.ocrFlipKnown = true;
      showPeek(toCanvas(top.view));
    }
    const best = top?.text || null;
    $('ocrReading').textContent = best || S.scanHint || '–';
    S.ocrReads.push(best);
    S.ocrReads = S.ocrReads.slice(-4);
    // Accept a number once it's been read the same way twice in the last four
    // tries, so a tired athlete swaying about still gets read.
    if (S.typing) return;
    if (best && S.ocrReads.filter((r) => r === best).length >= 2) {
      S.ocrReads = [];
      beep(1200, 120);
      goPosition(best, `scanner (${ENGINES[reader.engine].label})`, Math.round(top.conf));
      return;
    }
  } catch (e) {
    setTyping(true);
    $('ocrReading').textContent = `Scanner unavailable (${e.message}). Type the number.`;
    return;
  }
  scheduleOcr(120);
}

// ---------------------------------------------------------------- flow

// The rep count chosen on the home screen, or null if Custom isn't filled in.
function chosenReps() {
  if (settings.repsChoice !== 'custom') return Number(settings.repsChoice);
  const n = Number($('customReps').value);
  return Number.isInteger(n) && n >= 1 && n <= 200 ? n : null;
}

function renderReps() {
  for (const b of document.querySelectorAll('.seg button[data-reps]')) {
    b.setAttribute('aria-checked', String(b.dataset.reps === settings.repsChoice));
  }
  $('customRepsWrap').hidden = settings.repsChoice !== 'custom';
}

// Validates and stores the rep choice. Returns false (with a message) if Custom is empty.
function applyReps() {
  if (PRACTICE) { settings.targetReps = PRACTICE_REPS; return true; } // practice has no amount: it counts all you can do
  const reps = chosenReps();
  if (!reps) {
    showHomeError(`Enter how many ${currentExercise().unit} each athlete must complete (1–200), or pick 30.`);
    $('customReps').focus();
    return false;
  }
  settings.targetReps = reps;
  settings.customReps = $('customReps').value;
  saveSettings();
  return true;
}

async function openStation(streamUrl = null) {
  hideHomeError();
  if (!applyReps()) return;
  settings.station = $('stationName').value.trim();
  saveSettings();
  applyPageTurn();
  try {
    S.audio ??= new (window.AudioContext || window.webkitAudioContext)();
    S.audio.resume?.();
  } catch { /* no audio */ }
  // Unlock speech on iOS: it needs a first utterance inside a tap.
  if (settings.speech && window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  $('openStation').disabled = true;
  try {
    if (streamUrl) await startStream(streamUrl); else await startCamera();
    S.testMode = false;
    S.athleteNo = 0;
    keepAwake();
    loadLandmarker().catch(() => {});
    loadFaces().catch(() => {});
    if (currentExercise().gestures) loadGestures().catch((e) => showFlash(false, 'Hand model not loaded', e.message));
    ensureReader().catch(() => {});
    if (!history.state?.station && !document.documentElement.classList.contains('embedded')) history.pushState({ station: true }, '');
    goScan();
  } catch (e) {
    if (streamUrl) stopStream();
    showHomeError(streamUrl ? e.message : cameraErrorText(e));
  } finally {
    $('openStation').disabled = false;
  }
}

function cameraErrorText(e) {
  if (e.name === 'NotAllowedError') return 'Camera permission was refused. Allow camera access for this site in the browser settings, then try again.';
  if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return 'No camera found for that direction. Try the other camera.';
  return `Couldn't start the camera: ${e.message}`;
}

function goScan() {
  clearInterval(S.doneTimer);
  S.bib = null;
  S.ocrReads = [];
  S.headBox = null;
  setTyping(false);
  $('scanTarget').textContent = settings.targetReps;
  $('ocrReading').textContent = '–';
  $('ocrPeek').hidden = true;
  $('manualForm').hidden = true;
  $('manualWarn').hidden = true;
  $('manualBib').value = '';
  S.multi = null;
  if (multiMode()) { startMulti(); return; }
  if (!settings.captureBib || currentExercise().gestures) { goPosition(String(++S.athleteNo), 'none'); return; }
  show('scan');
}

function goPosition(bib, source = 'typed', conf = null) {
  clearTimeout(S.countdownTimer);
  S.bib = bib;
  S.bibSource = source;
  S.bibConf = conf;
  S.readySince = null;
  $('posBib').textContent = bib;
  setBibWord(source);
  if (PRACTICE) {
    $('posTitle').textContent = 'Getting ready…';
    say(currentExercise().gestures ? 'Hold your hand up to the camera.' : 'Step back until your whole body is in view.');
  }
  show('position');
  loadLandmarker().catch((e) => showFlash(false, 'Pose model not loaded', e.message));
}

// Number known and athlete standing in view: show the number and a green
// START, and start judging straight away (the first plank is a second away).
function startAttempt() {
  if (S.screen === 'count') return;
  S.filter = new PoseFilter(tracking());
  S.attempt = newAttempt(S.bib, settings.station);
  startRecording();
  beginCounting();
  if (PRACTICE) { S.finalSaid = null; showCallout('GO!', 900); return; }
  showStart(S.bib);
  beep(1320, 400, 'square', 0.2);
  say(S.bibSource === 'none' ? `Athlete ${S.bib}. Start!` : `Number ${S.bib.split('').join(' ')}. Start!`);
}

// Several athletes at once: no number or start position. Each athlete is
// tracked and counted from their own first rep.
function startMulti() {
  S.attempt = newAttempt('ALL', settings.station);
  startRecording();
  beginMulti();
  beep(1320, 400, 'square', 0.2);
  if (!quietJudge()) say('Counting. Start when ready.');
}

function beginMulti() {
  const a = S.attempt;
  a.multi = true;
  a.bibSource = 'none';
  if (exercise(a.mode).gestures) a.mode = 'burpees'; // hand practice is one person only
  // Judging as it happens (a live camera, or a real-time test), keeping up
  // matters more than finding every half-hidden person: each extra look costs
  // a full pose search, and with several people in view they ate most of the
  // time. A detailed test has time for them all.
  const detailed = S.testMode && S.pace === 'prepass';
  S.multi = new MultiTracker({
    make: () => applyStrictness(exercise(a.mode).make(a.target, judgeOptions()), a.mode, settings.strictness),
    tracking: tracking(), metricOpts,
    opts: detailed ? {} : { lookAgainMax: 1, lookEveryMs: 250 },
  });
  beginCounting();
}

// Everything recorded about one athlete's attempt.
function newAttempt(bib, station) {
  const list = bibList();
  return {
    id: `${Date.now().toString(36)}-${bib}`, bib, station, cfg: CFG || null,
    startedAt: new Date().toISOString(), goAt: null, finishedAt: null,
    target: IN_RECEIVER && currentExercise().gestures ? PRACTICE_REPS : Number(settings.targetReps), reps: 0, noReps: 0, reasons: {},
    events: [], status: 'running', durationMs: 0, video: false,
    mode: S.testMode && currentExercise().gestures ? 'burpees' : settings.exercise,
    bibSource: S.testMode ? 'test' : S.bibSource, bibConfidence: S.bibConf,
    bibOnStartList: list.size ? list.has(bib) : null,
    camera: S.testMode ? 'video file' : settings.facing === 'user' ? 'front' : 'back',
    orientation: settings.orientation, model: S.modelOverride || settings.model, tracking: settings.tracking, strictness: settings.strictness, filledPct: null,
    poseFrames: 0, avgFps: null, outOfViewMs: 0, othersInViewMs: 0,
    thresholds: judgeOptions(), device: navigator.userAgent, app: APP_VERSION,
  };
}

// Judging clock in ms. For a test video it follows the video's own time, so
// slowing the video down (see paceTestVideo) doesn't change the judging.
function clockNow() {
  return S.testMode ? S.clockBase + video.currentTime * 1000 : performance.now();
}

// Frames the phone actually analyses per second (real time).
function procFps() {
  const p = S.procTimes;
  return p.length > 5 ? (p.length - 1) / ((p.at(-1) - p[0]) / 1000) : null;
}

// A test video plays at full speed only if the phone can analyse enough
// frames per second of it; otherwise it's slowed so quick moves like the jump
// aren't skipped between frames. Faster (10): a hop still lands on 2-3 frames,
// but an athlete half hidden behind another is picked up less often. Most
// accurate (15) catches them, at half the speed again.
const testVideoFps = () => (S.pace === 'accurate' ? 15 : 10);
// The speed changes at most once a second and in small steps (quicker down
// than up), so playback doesn't lurch.
function paceTestVideo() {
  if (!S.testMode || video.paused || S.replay || S.pace === 'realtime') return;
  const now = performance.now();
  if (now - S.paceAt < 1000) return;
  const fps = procFps();
  if (fps == null) return;
  S.paceAt = now;
  const want = Math.min(1, Math.max(0.2, fps / testVideoFps()));
  const cur = video.playbackRate;
  const next = Math.round(Math.min(cur + 0.1, Math.max(cur - 0.3, want)) * 20) / 20;
  if (Math.abs(next - cur) >= 0.05) video.playbackRate = next;
}

function beginCounting() {
  S.judge = S.multi ? null : applyStrictness(exercise(S.attempt.mode).make(S.attempt.target, judgeOptions()), S.attempt.mode, settings.strictness);
  S.attempt.thresholds = { ...(S.judge ?? S.multi.make()).o };
  S.attempt.goAt = clockNow();
  S.lastPoseT = null;
  $('cntBib').textContent = S.attempt.bib;
  setBibWord(S.attempt.bibSource);
  $('count').classList.toggle('multi', !!S.multi);
  $('endAttempt').textContent = PRACTICE ? 'Stop' : S.multi ? 'End round' : 'End attempt';
  if (S.multi) renderMulti();
  $('cntTarget').textContent = S.attempt.target;
  $('cntNum').textContent = '0';
  $('cntNoReps').textContent = '0';
  $('flash').hidden = true;
  hideRepFlash();
  $('cntWarn').hidden = true;
  $('debug').hidden = !settings.debug;
  $('recDot').hidden = !S.recorder;
  show('count');
}

function eventRecord(goAt, n, ev, count) {
  const d = ev.detail || {};
  const rel = (v) => (v == null ? null : Math.round(v - goAt));
  return {
    n, type: ev.type, t: Math.round(clockNow() - goAt), at: new Date().toISOString(),
    count, reasons: ev.reasons || [],
    ...d, downAt: rel(d.downAt), upAt: rel(d.upAt), endAt: rel(d.endAt),
  };
}

function onJudgeEvent(ev) {
  const a = S.attempt;
  if (ev.type === 'rep') a.reps = ev.count;
  else {
    a.noReps++;
    for (const r of ev.reasons) a.reasons[r] = (a.reasons[r] || 0) + 1;
  }
  a.events.push(eventRecord(a.goAt, a.events.length + 1, ev, a.reps));
  // Analysing first: shown when the replay reaches it.
  if (S.prepassing) { S.replayEvents.push({ t: clockNow(), ev }); return; }
  showJudgeEvent(ev);
}

// The count, sound and flash for one athlete's rep or no rep.
function showJudgeEvent(ev) {
  const a = S.attempt;
  if (ev.type === 'rep') {
    const num = $('cntNum');
    num.textContent = ev.count;
    num.classList.remove('bump');
    void num.offsetWidth; // restart the bump animation
    num.classList.add('bump');
    beep(1050, 140);
    if (S.finalSaid == null) say(ev.done ? `${ev.count}. Complete!` : String(ev.count));
    if (ev.done) setTimeout(() => finishAttempt('complete'), 600);
  } else {
    $('cntNoReps').textContent = a.noReps;
    showRepFlash(false, null, ev.reasons);
    beep(180, 350, 'sawtooth', 0.2);
    if (S.finalSaid == null) say(`No rep. ${ev.reasons[0]}`);
  }
}

// Whole-screen flash for a no rep: red with a cross and the reasons. (Good reps
// only bump the count.)
function showRepFlash(good, count, reasons = []) {
  const el = $('repFlash');
  el.className = `rep-flash ${good ? 'good' : 'bad'}`;
  $('rfNum').textContent = count ?? '';
  $('rfReasons').textContent = reasons.join(' · ');
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('pop');
  const ms = good ? 800 : 1500;
  S.flashGood = good;
  S.flashUntil = performance.now() + ms;
  clearTimeout(S.repFlashTimer);
  S.repFlashTimer = setTimeout(hideRepFlash, ms);
}

function showStart(bib) {
  const el = $('repFlash');
  el.className = 'rep-flash start';
  $('rfNum').textContent = bib;
  $('rfReasons').textContent = 'Start';
  el.hidden = false;
  clearTimeout(S.repFlashTimer);
  S.repFlashTimer = setTimeout(hideRepFlash, 2000);
}

function hideRepFlash() {
  clearTimeout(S.repFlashTimer);
  $('repFlash').hidden = true;
}

function showFlash(good, title, detail = '') {
  const el = $('flash');
  el.className = `flash ${good ? 'good' : 'bad'}`;
  el.textContent = title;
  if (detail) {
    const s = document.createElement('small');
    s.textContent = detail;
    el.append(s);
  }
  el.hidden = false;
  S.flashGood = good;
  S.flashUntil = performance.now() + (good ? 900 : 2200);
}

async function finishAttempt(status) {
  if (S.multi) return finishMulti(status);
  if (!S.attempt || S.attempt.status !== 'running') return;
  const a = S.attempt;
  if (S.judge && status !== 'complete') {
    const ev = S.judge.finish();
    if (ev) onJudgeEvent(ev);
  }
  a.status = S.testMode ? 'test' : status;
  a.durationMs = a.goAt ? Math.round(clockNow() - a.goAt) : 0;
  a.finishedAt = new Date().toISOString();
  a.avgFps = procFps() != null ? Number(procFps().toFixed(1)) : a.durationMs ? Number((a.poseFrames / (a.durationMs / 1000)).toFixed(1)) : null;
  a.outOfViewMs = Math.round(a.outOfViewMs);
  a.othersInViewMs = Math.round(a.othersInViewMs);
  if (S.filter?.frames) a.filledPct = Math.round((100 * S.filter.filledFrames) / S.filter.frames);
  S.judge = null;
  saveResult(a);

  // Target reached: green tick, test video or not. Otherwise a red cross, or
  // grey for a test video that ended short.
  const test = a.status === 'test';
  const ok = a.reps >= a.target;
  $('doneLabel').textContent = (ok ? 'Complete' : test ? 'Test run' : 'Not complete') +
    (ok && test ? ' (test video)' : '') + (a.mode === 'practice' ? ' (practice)' : '');
  $('doneLabel').title = exercise(a.mode).label;
  $('done').classList.toggle('bad', !ok && !test);
  $('done').classList.toggle('test', !ok && test);
  $('doneAutoLine').hidden = S.testMode;
  $('doneReps').textContent = a.reps;
  $('doneTarget').textContent = a.target;
  $('doneBib').textContent = a.bib;
  setBibWord(a.bibSource);
  $('done').classList.remove('multi');
  $('nextAthlete').textContent = S.testMode ? 'Done' : PRACTICE ? 'Go again' : 'Next athlete';
  $('doneTime').textContent = fmtTime(a.durationMs);
  $('doneNoReps').textContent = a.noReps;
  $('doneVideo').textContent = S.recorder ? 'Saving video…' : '';
  if (PRACTICE) practiceDone(a, status);
  show('done');

  const blob = await stopRecording();
  if (blob) {
    try {
      await videos.put(a.id, blob);
      a.video = true;
      a.videoType = blob.type;
      saveResult(a);
      $('doneVideo').textContent = `Video saved (${(blob.size / 1e6).toFixed(1)} MB).`;
    } catch (e) {
      $('doneVideo').textContent = `Video not saved: ${e.message}`;
    }
  }

  if (S.testMode || PRACTICE) return;
  let left = 6;
  $('doneAuto').textContent = left;
  clearInterval(S.doneTimer);
  S.doneTimer = setInterval(() => {
    left--;
    $('doneAuto').textContent = left;
    if (left <= 0 && S.screen === 'done') goScan();
    if (left <= 0 || S.screen !== 'done') clearInterval(S.doneTimer);
  }, 1000);
}

// Several athletes: one result per athlete, all sharing the round's video.
async function finishMulti(status) {
  const g = S.attempt;
  if (!g || g.status !== 'running') return;
  for (const { track, ev } of S.multi.finish()) onMultiEvent(track, ev);
  sendProof(true);
  g.status = S.testMode ? 'test' : status;
  g.durationMs = g.goAt ? Math.round(clockNow() - g.goAt) : 0;
  g.finishedAt = new Date().toISOString();
  g.avgFps = procFps() != null ? Number(procFps().toFixed(1)) : null;
  const rows = S.multi.athletes.map((k) => ({
    ...g, events: k.events || [], id: `${g.id}-${k.label}`, athlete: k.label, group: g.id, videoId: g.id,
    bib: k.bib || (settings.captureBib ? 'No number' : String(k.label)), bibSource: k.bib ? 'scanner (head band)' : settings.captureBib ? 'not read' : 'none', bibConfidence: k.bibConf ?? null,
    firstAt: (k.events || [])[0]?.at || null, lastAt: (k.events || []).slice(-1)[0]?.at || null,
    reps: k.judge.count, noReps: k.judge.noReps, reasons: { ...k.judge.reasonCounts },
    status: S.testMode ? 'test' : k.judge.count >= g.target ? 'complete' : status,
    filledPct: k.filter.frames ? Math.round((100 * k.filter.filledFrames) / k.filter.frames) : null,
  }));
  for (const r of [...rows].reverse()) saveResult(r);
  for (const r of rows) reportAthlete({ done: true, label: r.athlete, bib: r.bib, reps: r.reps, noReps: r.noReps, id: r.id, firstAt: r.firstAt, lastAt: r.lastAt });

  const test = S.testMode;
  const ok = rows.length > 0 && rows.every((r) => r.reps >= r.target);
  $('doneLabel').textContent = !rows.length ? 'No athletes counted' : ok ? `All complete${test ? ' (test video)' : ''}` : test ? 'Test run' : 'Not all complete';
  $('doneLabel').title = exercise(g.mode).label;
  $('done').classList.toggle('bad', !ok && !test);
  $('done').classList.toggle('test', !ok && test);
  $('done').classList.add('multi');
  $('nextAthlete').textContent = S.testMode ? 'Done' : 'New round';
  $('doneAutoLine').hidden = true;
  $('doneReps').textContent = rows.filter((r) => r.reps >= r.target).length;
  $('doneTarget').textContent = rows.length;
  const list = $('doneMulti');
  list.replaceChildren();
  for (const r of rows) {
    const li = document.createElement('li');
    li.className = r.reps >= r.target ? 'ok' : '';
    li.style.setProperty('--ath', athleteColour(r.athlete ?? r.bib));
    li.innerHTML = '<b></b><span></span><small></small>';
    li.querySelector('b').textContent = r.bib === 'No number' ? `Athlete ${r.athlete} · no number` : r.bibSource === 'none' ? `Athlete ${r.bib}` : `No. ${r.bib}`;
    li.querySelector('span').textContent = `${r.reps}/${r.target}`;
    li.querySelector('small').textContent = `${r.noReps} no rep${r.noReps === 1 ? '' : 's'}`;
    list.append(li);
  }
  $('doneVideo').textContent = S.recorder ? 'Saving video…' : '';
  show('done');

  const blob = await stopRecording();
  if (blob) {
    try {
      await videos.put(g.id, blob);
      for (const r of rows) { r.video = true; r.videoType = blob.type; saveResult(r); }
      $('doneVideo').textContent = `Video saved (${(blob.size / 1e6).toFixed(1)} MB).`;
    } catch (e) {
      $('doneVideo').textContent = `Video not saved: ${e.message}`;
    }
  }
}

// ---------------------------------------------------------------- per-frame

// The zoomed part of the frame for the pose model (see MultiTracker.region).
const zoomCanvas = document.createElement('canvas');
const zoomCtx = zoomCanvas.getContext('2d');
function zoomFrame(src, w, h, c) {
  const k = Math.min(1, 640 / Math.max(c.w * w, c.h * h)); // no bigger than the model needs
  const W = Math.max(16, Math.round(c.w * w * k)), H = Math.max(16, Math.round(c.h * h * k));
  if (zoomCanvas.width !== W || zoomCanvas.height !== H) { zoomCanvas.width = W; zoomCanvas.height = H; }
  zoomCtx.drawImage(src, c.x * w, c.y * h, c.w * w, c.h * h, 0, 0, W, H);
  return zoomCanvas;
}

// A second look at part of the frame (crop, as shares of the frame) with the
// given people (whole-frame landmark lists) painted over, so whoever they
// hide can be found. Results in whole-frame coordinates.
const lookCanvas = document.createElement('canvas');
const lookCtx = lookCanvas.getContext('2d', { willReadFrequently: true });
function secondLook(src, w, h, crop, poses) {
  if (!S.scanner) return null;
  const k = Math.min(1, 640 / Math.max(crop.w * w, crop.h * h));
  const W = Math.max(16, Math.round(crop.w * w * k)), H = Math.max(16, Math.round(crop.h * h * k));
  if (lookCanvas.width !== W || lookCanvas.height !== H) { lookCanvas.width = W; lookCanvas.height = H; }
  lookCtx.drawImage(src, crop.x * w, crop.y * h, crop.w * w, crop.h * h, 0, 0, W, H);
  // Paint in the area's average colour, so the paint doesn't look like a person.
  const avg = (() => { const d = lookCtx.getImageData(0, 0, W, H).data; const c = [0, 0, 0]; let n = 0;
    for (let i = 0; i < d.length; i += 64) { c[0] += d[i]; c[1] += d[i + 1]; c[2] += d[i + 2]; n++; }
    return `rgb(${c.map((v) => Math.round(v / n)).join(',')})`; })();
  drawMasks(lookCtx, poses, crop, W, H, avg);
  try { return fromCrop(S.scanner.detect(lookCanvas), crop); } catch { return null; }
}
// Where to look again for a missing track: around where they were last seen.
function lookAround(k, w, h) {
  const aspect = w / h, side = Math.min(1, 2.4 * k.scale);
  const cw = Math.min(1, side / aspect), ch = side;
  const x = Math.min(1 - cw, Math.max(0, k.box.cx / aspect - cw / 2)), y = Math.min(1 - ch, Math.max(0, k.box.cy - ch / 2));
  return { x, y, w: cw, h: ch };
}

// A small copy of the frame, for the colour of each person's clothes.
const colourCanvas = document.createElement('canvas');
const colourCtx = colourCanvas.getContext('2d', { willReadFrequently: true });
function frameSampler() {
  const { src, w, h } = S.frame;
  const W = 384, H = Math.max(1, Math.round((W * h) / w));
  if (colourCanvas.width !== W || colourCanvas.height !== H) { colourCanvas.width = W; colourCanvas.height = H; }
  colourCtx.drawImage(src, 0, 0, W, H);
  const d = colourCtx.getImageData(0, 0, W, H).data;
  return (x, y) => {
    const X = Math.round(x * W), Y = Math.round(y * H);
    if (X < 0 || Y < 0 || X >= W || Y >= H) return null;
    const i = (Y * W + X) * 4;
    return [d[i], d[i + 1], d[i + 2]];
  };
}

// Several athletes: match everyone in this frame to their track and judge.
function onMulti(t) {
  if (S.screen !== 'count' || !S.attempt || S.attempt.status !== 'running') return;
  S.attempt.poseFrames++;
  let sample = null;
  try { sample = frameSampler(); } catch { /* match on position alone */ }
  const { src, w, h } = S.frame;
  const lookAgain = (k, poses) => secondLook(src, w, h, lookAround(k, w, h), poses);
  const moved = S.multi.update(S.multiRes, t, w / h, sample, S.multiExtra, lookAgain);
  recordProof(t);
  for (const { track, ev } of moved) onMultiEvent(track, ev);
  sendProof();
  multiBibTick();
  renderMulti();
}

// ---------------------------------------------------------------- several athletes: their numbers from the head bands
// At a Spartan penalty zone each athlete's head band is either worn or laid on the ground in front of them while they
// do their burpees, and either can happen at any point in their set. Every half second one athlete still without a
// number gets a look at both places: their forehead (from their pose) and the ground just in front of them (below
// their feet in the picture, a little wider than them), each the right way up and upside down. A number read the same
// way twice is theirs. One that's never read is saved as "No number" (it can be typed in afterwards).
let multiBibAt = 0, multiBibBusy = false, multiBibTurn = 0;
const rotate180 = (img) => ({ ...img, data: Uint8ClampedArray.from(img.data).reverse() });
async function multiBibTick() {
  if (!settings.captureBib || !S.multi || (S.prepassing && !S.upload) || multiBibBusy || !S.frame) return;
  const now = performance.now(); if (now - multiBibAt < 500) return; multiBibAt = now;
  // everyone being tracked, from the moment they appear (the number stays with them when they start counting)
  const everyone = S.multi.tracks || S.multi.athletes;
  const taken = new Set(everyone.map((k) => k.bib).filter(Boolean));
  const todo = everyone.filter((k) => !k.bib && !k.gone && k.box && (k.label != null || k.pose));
  if (!todo.length) return;
  const k = todo[multiBibTurn++ % todo.length];
  multiBibBusy = true;
  try {
    const reader = await ensureReader();
    const { w, h } = S.frame, b = k.box;
    const bw = (b.right - b.left) * w, bh = Math.max((b.bottom - b.top) * h, bw * 0.6);
    const x0 = Math.max(0, b.left * w - bw * 0.4), x1 = Math.min(w, b.right * w + bw * 0.4);
    const y0 = Math.max(0, b.bottom * h - bh * 0.15), y1 = Math.min(h, b.bottom * h + bh * 0.6);
    const places = [];
    const head = k.pose && k.pose.lm ? headBandBox(k.pose.lm) : null;   // worn on the forehead
    if (head && head.w >= 16 && head.h >= 10) places.push(head);
    if (x1 - x0 >= 20 && y1 - y0 >= 12) places.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });   // on the ground in front
    const runs = [];
    for (const box of places) { const g = grabGray(box, 260); runs.push(...prepareDigits(g.gray, g.W, g.H, { minDigits: Number(settings.bibMin), maxDigits: Number(settings.bibMax) }).slice(0, 3)); }
    let best = null;
    for (const img of runs.slice(0, 6)) {
      for (const view of [img, rotate180(img)]) {
        const c = filterBibs(await reader.read(view), ENGINES[reader.engine].minConf).filter((x) => !taken.has(x.text));
        if (c.length) { best = c[0]; break; }
      }
      if (best) break;
    }
    k.bibReads = [...(k.bibReads || []), best ? best.text : null].slice(-6);
    if (best && k.bibReads.filter((x) => x === best.text).length >= 2) { k.bib = best.text; k.bibConf = Math.round(best.conf); if (!quietJudge()) beep(1200, 120); if (k.label != null) reportAthlete({ type: 'number', label: k.label, bib: k.bib }); }
  } catch { /* no number reader: the numbers are typed in afterwards */ } finally { multiBibBusy = false; }
}

// the Receiver's video review marks each athlete on its timeline: picked up, their number, their reps when saved
// (an uploaded video judged in the review's Upload tab reports the same way, with the seconds into the video)
const reportsAthletes = () => document.documentElement.classList.contains('embedded') && (!S.testMode || !!S.upload) && !!CFG && !!S.attempt && (!S.prepassing || !!S.upload);
const athleteKey = () => ({ cam: +CFG.replace(/\D/g, '') || 0, src: S.upload ? 'upload' : 'live', video: S.upload?.saved || '', round: S.attempt.id, at: new Date().toISOString() });
const reportAthleteDone = (k) => reportAthlete({ done: true, label: k.label, bib: k.bib, reps: k.judge.count, noReps: k.judge.noReps, id: `${S.attempt.id}-${k.label}` });
function reportAthlete(o) {
  if (!reportsAthletes()) return;
  const body = { ...athleteKey(), t: S.upload ? +video.currentTime.toFixed(2) : null, ...o };
  fetch('/api/athlete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
}
// The proof of each athlete's count: their skeleton about 12 times a second and every rep and no rep, saved on the
// laptop so the review's Watch can draw them over the recording. Times: ms into an uploaded video, or the laptop's clock.
// A frame: [time, bit mask of guessed points, x, y, x, y...] in ten-thousandths of the picture, -1 for a point not seen.
const PROOF_POINTS = [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
function recordProof(t) {
  if (!reportsAthletes()) return;
  // finished or gone for good: their entry in the review's lists is ready
  for (const k of S.multi.athletes) if ((k.gone || k.judge.done) && !k.reportedDone) { k.reportedDone = true; reportAthleteDone(k); }
  const now = S.upload ? Math.round(S.lastVideoTime * 1000) : S.frameAt, minVis = tracking().minVis;
  S.proofNow = now; S.proofT = t;
  for (const k of S.multi.tracks) {
    if (!k.pose || k.seenAt !== t || now - (k.proofAt ?? -1e15) < 80) continue;
    k.proofAt = now;
    const f = [now, 0];
    PROOF_POINTS.forEach((p, i) => {
      const q = k.pose.lm[p], ok = (q.visibility ?? 1) >= minVis;
      if (ok && q.filled) f[1] |= 1 << i;
      f.push(ok ? Math.round(q.x * 10000) : -1, ok ? Math.round(q.y * 10000) : -1);
    });
    (k.proof ??= []).push(f);
    if (k.label == null && k.proof.length > 750) k.proof.splice(0, 150); // nobody counted yet: the last minute will do
  }
}
function proofEvent(k, ev) {
  if (S.proofNow == null) return;
  const d = ev.detail || {}, back = (x) => (x == null ? null : Math.round(S.proofNow - (S.proofT - x)));
  (k.proofEvents ??= []).push({ type: ev.type, count: ev.type === 'rep' ? (ev.count ?? k.judge.count) : k.judge.count, reasons: ev.reasons || [], from: back(d.downAt), t: back(d.endAt) ?? S.proofNow });
}
function sendProof(all) {
  if (!reportsAthletes() || (!all && Date.now() - (S.proofSent || 0) < 2000)) return;
  S.proofSent = Date.now();
  for (const k of S.multi.tracks) {
    if (k.label == null) continue;
    do {
      const frames = (k.proof ?? []).splice(0, 150), evs = (k.proofEvents ?? []).splice(0);
      if (!frames.length && !evs.length) break;
      fetch('/api/athlete-track', { method: 'POST', keepalive: !!all, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...athleteKey(), label: k.label, frames, events: evs }) }).catch(() => {});
    } while (all);
  }
}
// a picture of the athlete for the review's list: their box from the frame, 200 px tall. Sent when first picked up,
// then again when they're seen bigger (standing up straight, nearer): the clearest picture wins.
function athletePic(k) {
  const b = k.box, f = S.frame; if (!b || !f || !f.w) return null;
  const x0 = Math.max(0, b.left - 0.02), x1 = Math.min(1, b.right + 0.02), y0 = Math.max(0, b.top - 0.04), y1 = Math.min(1, b.bottom + 0.02);
  const sw = (x1 - x0) * f.w, sh = (y1 - y0) * f.h; if (sw < 8 || sh < 8) return null;
  const H = 200, W = Math.max(40, Math.min(320, Math.round((H * sw) / sh)));
  const c = athletePic.c ??= document.createElement('canvas'); c.width = W; c.height = H;
  try { c.getContext('2d').drawImage(f.src, x0 * f.w, y0 * f.h, sw, sh, 0, 0, W, H); return c.toDataURL('image/jpeg', 0.75); } catch { return null; }
}
function reportSeen(k, extra) {
  const b = k.box, size = b ? (b.bottom - b.top) * (b.right - b.left) : 0, now = clockNow();
  const o = { label: k.label, reps: k.judge.count, noReps: k.judge.noReps, ...extra };
  if (b) o.box = { x: b.x, y: (b.top + b.bottom) / 2 };
  if (b && (!k.picSize || (size > k.picSize * 1.25 && now - (k.picAt || 0) > 4000))) { const pic = athletePic(k); if (pic) { o.pic = pic; k.picSize = size; k.picAt = now; } }
  reportAthlete(o);
}
function onMultiEvent(k, ev) {
  k.events ??= [];
  proofEvent(k, ev);
  reportSeen(k, { bib: k.bib || '', reps: k.judge.count, noReps: k.judge.noReps });
  k.events.push(eventRecord(S.attempt.goAt, k.events.length + 1, ev, k.judge.count));
  // The athlete's outline flashes green or red; no whole-screen flash, as
  // it's someone else's rep half the time.
  k.flashGood = ev.type === 'rep';
  k.flashUntil = clockNow() + (k.flashGood ? 600 : 1200); // on the judging clock, so a replay shows it too
  if (S.prepassing) { S.replayEvents.push({ t: clockNow(), k, ev }); return; }
  multiEventSound(k, ev);
}

// inside a camera in the Receiver's video review the judge works quietly: it tracks everyone and records their reps,
// and a referee looks an athlete up when needed (no counts, labels or sounds on screen)
const quietJudge = () => document.documentElement.classList.contains('embedded');
const MIN_LIVE_FPS = 8;
function multiEventSound(k, ev) {
  if (quietJudge()) return;
  if (ev.type === 'rep') {
    beep(1050, 120);
    if (ev.done) say(`Athlete ${k.label} complete`);
  } else {
    beep(180, 250, 'sawtooth', 0.15);
  }
}

// Each athlete's own colour, on their outline, head label, chip and finish
// row, so a count can be matched to its athlete at a glance. Red and green
// are left for the no-rep and good-rep flashes; white text reads on all.
const ATHLETE_COLOURS = ['#2563eb', '#ea580c', '#9333ea', '#0891b2', '#db2777', '#ca8a04', '#4f46e5', '#0d9488'];
const athleteColour = (label) => ATHLETE_COLOURS[(Number(label) - 1) % ATHLETE_COLOURS.length];

// The strip of counts at the top of the count screen.
// people: [{label, count, noReps}], live or from a replay.
function renderMulti(people = S.multi.athletes.map((k) => ({ label: k.label, bib: k.bib, count: k.judge.count, noReps: k.judge.noReps, gone: !!k.gone }))) {
  // every 5 s, everyone still in the picture: still on screen (and a clearer picture of them, if there is one)
  if (!S.prepassing && clockNow() - (S.seenTick || 0) > 5000) { S.seenTick = clockNow(); for (const k of S.multi.athletes) if (k.events?.length && !k.gone && clockNow() - (k.seenAt || 0) < 1500) reportSeen(k); }
  const list = $('multiList');
  const ath = people;
  const key = ath.map((k) => `${k.label}:${k.bib || ''}:${k.count}:${k.noReps}:${k.gone ? 1 : 0}`).join(' ');
  // the line under the counts (in the Receiver, who is being recorded): set every time, the strip only on change
  const warn = quietJudge()
    ? `Recording reps for ${ath.length} athlete${ath.length === 1 ? '' : 's'}${ath.some((k) => k.bib) ? ` · numbers read: ${ath.filter((k) => k.bib).map((k) => k.bib).join(', ')}` : ''}`
    : ath.length ? '' : 'Watching for athletes (grey outline = seen). Each is counted from their first good burpee.';
  // a live camera can't be slowed down: say when reps are likely being missed
  const fps = quietJudge() && !S.testMode ? procFps() : null;
  const slow = fps != null && fps < MIN_LIVE_FPS ? `⚠ Only ${Math.round(fps)} frames a second analysed: jumps will be missed, so counts will be low. ` : '';
  $('cntWarn').textContent = slow + warn;
  $('cntWarn').hidden = !(slow + warn);
  $('cntWarn').classList.toggle('too-slow', !!slow);
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  list.replaceChildren();
  for (const k of ath) {
    const el = document.createElement('div');
    el.className = `mchip${k.count >= S.attempt.target ? ' ok' : ''}${k.gone ? ' gone' : ''}`; // gone: finished and left
    el.style.setProperty('--ath', athleteColour(k.label));
    el.innerHTML = '<b></b><span></span>';
    el.querySelector('b').textContent = k.label;
    el.querySelector('span').textContent = `${k.count}/${S.attempt.target}${k.noReps ? ` · ${k.noReps} ✕` : ''}`;
    list.append(el);
  }
}

// Everyone tracked at judging-clock time tc, ready to draw: live, or as
// recorded while analysing a test video first.
function multiView(tc) {
  return S.multi.tracks.filter((k) => k.pose && tc - k.seenAt <= 1500).map((k) => ({
    lm: k.pose.lm, label: k.label, bib: k.bib, count: k.judge.count, noReps: k.judge.noReps, box: k.box,
    flash: tc < (k.flashUntil || 0) ? (k.flashGood ? 'good' : 'bad') : null,
  }));
}

// Each athlete's number and count, just above their head.
function drawMultiLabels(w, h, view) {
  const fs = Math.max(16, Math.round(h / 26));
  ctx.font = `700 ${fs}px Barlow, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const k of view) {
    if (k.label == null) continue;
    const x = (S.mirror ? 1 - k.box.x : k.box.x) * w;
    const y = Math.max(fs * 1.4, k.box.top * h - fs * 0.3);
    const text = quietJudge() ? `${k.bib ? '#' + k.bib : 'A' + k.label}  ${k.count}` : `${k.bib ? '#' + k.bib : k.label}  ${k.count}/${S.attempt.target}${k.count >= S.attempt.target ? ' ✓' : ''}`;
    const tw = ctx.measureText(text).width + fs;
    ctx.fillStyle = athleteColour(k.label);
    ctx.fillRect(x - tw / 2, y - fs * 1.2, tw, fs * 1.25);
    ctx.fillStyle = '#fff';
    ctx.fillText(text, x, y);
  }
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

function onPose(t) {
  const m = S.pose ? computeMetrics(S.pose.lm, S.pose.wlm, metricOpts()) : null;
  S.metrics = m;

  if (S.screen === 'scan') {
    if (S.typing) { S.headBox = null; return; }
    S.headBox = headBandBox(S.pose?.lm);
    if (!S.headBox && S.faces && S.frame) {
      try { S.headBox = faceBandBox(S.faces.detectForVideo(S.frame.src, t)); } catch { S.headBox = null; }
    }
    S.scanHint = !S.headBox ? (S.pose ? 'Face the camera' : 'Stand in view, facing the camera')
      : S.headBox.headPx < 45 ? 'Come a little closer'
      : 'Looking for your number…';
    return;
  }

  if (S.screen === 'countdown') {
    // Stepping out of the picture stops the countdown, so the clock can't start without them.
    if (currentExercise().gestures || wholeBody(m)) S.lostSince = null;
    else { S.lostSince ??= t; if (t - S.lostSince > 800) cancelCountdown(); }
    return;
  }

  if (S.screen === 'position') {
    const body = PRACTICE ? wholeBody(m) : !!m?.fullBody;
    const ex = currentExercise();
    // Push-ups: the start check uses the same straight-arms angle as the judge.
    const readyOpts = settings.exercise === 'pushups'
      ? applyStrictness({ o: { ...PushupJudge.DEFAULTS } }, 'pushups', settings.strictness).o
      : judgeOptions();
    const inPlace = !!(m && ex.ready.test(m, readyOpts));
    const extra = ex.ready.live?.(m);
    $('chkStand').textContent = extra ? `${ex.ready.check} (${extra})` : ex.ready.check;
    $('chkBody').classList.toggle('ok', body);
    $('chkStand').classList.toggle('ok', inPlace);
    if (PRACTICE) $('posTitle').textContent = ex.gestures ? ex.ready.title : !body ? 'Get your whole body in view' : !inPlace ? ex.ready.title : 'Hold still';
    if ((body && inPlace) || (ex.gestures && (S.pose || IN_RECEIVER))) { // the fist test may only see a hand, no body
      S.readySince ??= t;
      if (t - S.readySince > 500) { if (PRACTICE) startCountdown(); else startAttempt(); }
    } else {
      S.readySince = null;
    }
    return;
  }

  if (S.screen === 'count' && S.judge) {
    const a = S.attempt;
    const dt = S.lastPoseT == null ? 0 : Math.min(500, t - S.lastPoseT);
    S.lastPoseT = t;
    a.poseFrames++;
    if (!m?.fullBody) a.outOfViewMs += dt;
    if (S.others) a.othersInViewMs += dt;
    const ev = S.judge.update(m, t);
    if (ev) onJudgeEvent(ev);
    let warn = '';
    if (!S.pose) warn = "Can't see the athlete";
    else if (S.others) warn = 'Another person in view – keep the area clear';
    else if (S.judge?.phase === 'up' && !m?.fullBody) warn = 'Step back – whole body must be in view';
    else if (!S.testMode && procFps() != null && procFps() < 12) warn = `Phone is analysing only ${Math.round(procFps())} frames a second – quick jumps may be missed.${PRACTICE ? '' : ' Try the Lite pose model.'}`;
    $('cntWarn').textContent = warn;
    $('cntWarn').hidden = !warn;
    if (settings.debug && S.judge) renderDebug();
  }
}

const GESTURE_NAMES = { Closed_Fist: 'fist', Open_Palm: 'open hand', Thumb_Down: 'thumbs down' };

function onGesture(t) {
  const a = S.attempt;
  a.poseFrames++;
  const ev = S.judge.update(S.gesture, t);
  if (ev) onJudgeEvent(ev);
  if (S.screen !== 'count') return;
  const next = S.judge.phase === 'fist' ? 'now open your hand' : 'make a fist';
  $('cntWarn').textContent = `Practice: ${next}${S.gesture && GESTURE_NAMES[S.gesture] ? ` (seeing ${GESTURE_NAMES[S.gesture]})` : !S.handLm ? ' (no hand seen)' : ''}`;
  $('cntWarn').hidden = false;
}

function renderDebug() {
  if (!(S.judge instanceof BurpeeJudge)) {
    const f = (v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
    $('debug').textContent = Object.entries(S.judge.live).map(([k, v]) => `${k.padEnd(7)}${f(v)}`).join('\n');
    return;
  }
  const L = S.judge.live, o = S.judge.o;
  const f = (v, d = 2) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));
  const fps = procFps() ?? 0;
  $('debug').textContent = [
    `phase  ${L.phase}`,
    `fps    ${f(fps, 0)}`,
    `tilt   ${f(L.tilt, 0)}°  (down >${o.downEnterTilt}, up <${o.upExitTilt})`,
    `chest  ${f(L.chest)}  min ${f(L.chestMin)}  (≤${o.chestMaxRatio})`,
    `lift   ${f(L.lift, 3)}  (>${o.jumpMinLift}) ${L.air ? 'AIR' : ''}`,
    `hip    ${f(L.hip, 0)}°  (≥${o.hipMinAngle}) ${L.hipOk ? 'OK' : ''}`,
    `hands  ${L.hands ? 'UP' : 'down'}`,
  ].join('\n');
}

const BONES = [
  [LM.L_SH, LM.R_SH], [LM.L_SH, LM.L_EL], [LM.L_EL, LM.L_WR], [LM.R_SH, LM.R_EL], [LM.R_EL, LM.R_WR],
  [LM.L_SH, LM.L_HIP], [LM.R_SH, LM.R_HIP], [LM.L_HIP, LM.R_HIP],
  [LM.L_HIP, LM.L_KNEE], [LM.L_KNEE, LM.L_ANK], [LM.R_HIP, LM.R_KNEE], [LM.R_KNEE, LM.R_ANK],
  [LM.L_ANK, LM.L_HEEL], [LM.L_HEEL, LM.L_FOOT], [LM.L_ANK, LM.L_FOOT],
  [LM.R_ANK, LM.R_HEEL], [LM.R_HEEL, LM.R_FOOT], [LM.R_ANK, LM.R_FOOT],
];

function drawSkeleton(lm, w, h, color, thin = false) {
  const lw = Math.max(thin ? 2 : 3, w / (thin ? 400 : 220));
  const minVis = tracking().minVis;
  const ok = (i) => (lm[i].visibility ?? 1) >= minVis;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  // Seen bones solid, bones to a guessed point dashed.
  for (const dashed of [false, true]) {
    ctx.setLineDash(dashed ? [lw * 2, lw * 2] : []);
    ctx.beginPath();
    for (const [a, b] of BONES) {
      if (!ok(a) || !ok(b) || !!(lm[a].filled || lm[b].filled) !== dashed) continue;
      ctx.moveTo(lm[a].x * w, lm[a].y * h);
      ctx.lineTo(lm[b].x * w, lm[b].y * h);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = '#e2231a';
  ctx.strokeStyle = '#e2231a';
  for (const i of [LM.NOSE, LM.L_EAR, LM.R_EAR, ...BONES.flat()]) {
    if (!ok(i)) continue;
    ctx.beginPath();
    ctx.arc(lm[i].x * w, lm[i].y * h, lw * 1.3, 0, Math.PI * 2);
    if (lm[i].filled) ctx.stroke(); else ctx.fill();
  }
}

function fmtTime(ms) {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

// Text burned into the frame, so the saved video stands on its own as evidence.
function drawBurnIn(w, h) {
  const a = S.attempt;
  if (!a) return;
  const elapsed = a.goAt ? fmtTime(clockNow() - a.goAt) : 'starting';
  const line1 = S.multi
    ? `${(S.replay ? replayAt(clockNow())?.people || [] : S.multi.athletes.map((k) => ({ label: k.label, count: k.judge.count }))).map((k) => `${k.label}: ${k.count}/${a.target}`).join('   ') || 'WAITING FOR ATHLETES'}   ${elapsed}`
    : `${a.bibSource === 'none' ? 'ATHLETE' : 'BIB'} ${a.bib}   ${a.reps}/${a.target}   NO REP ${a.noReps}   ${elapsed}`;
  const line2 = `${a.station || 'Station'}   ${new Date().toLocaleString()}`;
  let fs = Math.max(14, Math.round(h / 28));
  ctx.font = `700 ${fs}px Barlow, Arial, sans-serif`;
  // Smaller text when it wouldn't fit across (a portrait video is narrow).
  const wide = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width) + fs;
  if (wide > w) { fs = Math.max(8, Math.floor((fs * w) / wide)); ctx.font = `700 ${fs}px Barlow, Arial, sans-serif`; }
  const pad = fs * 0.5;
  const tw = Math.max(ctx.measureText(line1).width, ctx.measureText(line2).width);
  const x = w - tw - pad * 2; // bottom right, clear of the on-screen controls
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillRect(x, h - fs * 2.6 - pad, tw + pad * 2, fs * 2.6 + pad);
  ctx.fillStyle = '#fff';
  ctx.fillText(line1, x + pad, h - fs * 1.5 - pad * 0.3);
  ctx.fillStyle = '#ccc';
  ctx.fillText(line2, x + pad, h - fs * 0.4 - pad * 0.3);
}

function frame() {
  requestAnimationFrame(frame);
  if (S.prepassing || !CAMERA_SCREENS.has(S.screen) || !video.videoWidth) return;
  S.frame = frameSource();
  const { src, w, h } = S.frame;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }

  const practice = S.screen === 'count' && S.judge instanceof GestureJudge;
  if (practice && S.gestures && video.currentTime !== S.lastVideoTime && !video.paused) {
    S.lastVideoTime = video.currentTime;
    const t = performance.now();
    try {
      const res = S.gestures.recognizeForVideo(src, t);
      const top = res.gestures?.[0]?.[0];
      S.gesture = top && top.score > 0.5 ? top.categoryName : null;
      S.handLm = res.landmarks?.[0] || null;
    } catch {
      S.gesture = null; S.handLm = null;
    }
    onGesture(t);
  }

  const wantPose = (!!S.landmarker || !!S.replay) && !practice;
  if (wantPose && !S.replay && video.currentTime !== S.lastVideoTime && !video.paused) {
    S.lastVideoTime = video.currentTime;
    analyseFrame(src, w, h, clockNow());
  }
  if (S.replay) replayTo(clockNow());
  drawFrame(src, w, h, wantPose, practice);
}

// Pose search and judging for one frame at judging-clock time t.
function analyseFrame(src, w, h, t) {
    S.frameAt = Date.now();
    const wide = w > h;
    if (S.multi && S.frameWide != null && wide !== S.frameWide) { S.multi.reorient(t); S.findBoxes = null; }
    S.frameWide = wide;
    try {
      // Several athletes: the pose model looks at the part of the frame where
      // people are, zoomed in, so far-off athletes are found more often.
      const crop = S.multi ? S.multi.region(t, w / h) : null;
      // The pose model needs every frame's time strictly later than the last,
      // to the millisecond, or it stops working for good. A video's clock can
      // report two frames a hair apart at the start, so keep them 1 ms apart.
      const mpT = Math.max(t, S.lastModelT + 1);
      S.lastModelT = mpT;
      const res = S.landmarker.detectForVideo(crop ? zoomFrame(src, w, h, crop) : src, mpT);
      if (S.multi) {
        S.multiRes = fromCrop(res, crop);
        const z = S.multi.zoom;
        const area = z ? { x: z.x0, y: z.y0, w: z.x1 - z.x0, h: z.y1 - z.y0 } : { x: 0, y: 0, w: 1, h: 1 };
        S.multiExtra = null;
        if (S.finder) {
          // The person finder looks over the whole picture twice a second, in
          // the background (newcomers can appear anywhere); anyone it saw that
          // hasn't been found gets a zoomed look of their own, with the people
          // found painted over.
          if (!S.findBusy && t - S.findAt >= MULTI_DEFAULTS.findEveryMs) {
            S.findAt = t;
            S.findBusy = true;
            S.finder.find(src, w, h).then((b) => { S.findBoxes = b; }).catch(() => {}).finally(() => { S.findBusy = false; });
          }
          if (S.findBoxes) {
            const found = S.multiRes?.landmarks || [];
            const looks = unclaimedBoxes(S.findBoxes, found, w / h).slice(0, 2).map((b) => secondLook(src, w, h, boxArea(b), found));
            S.findBoxes = null;
            S.multiExtra = joinResults(looks);
          }
        } else if (S.scanner && S.multi.wantsScan(t)) {
          // No finder: look at the watched area again twice a second with
          // everyone being tracked painted over, for anyone they were hiding.
          const poses = S.multi.tracks.filter((k) => k.pose && t - k.seenAt < 300).map((k) => k.pose.lm);
          S.multiExtra = joinResults(scanAreas(area).map((a) => secondLook(src, w, h, a, poses)));
        }
        S.pose = null;
      } else {
        const picked = pickPose(res);
        S.filter ??= new PoseFilter(tracking());
        S.pose = S.filter.update(picked.pose, t);
        S.others = picked.others;
      }
    } catch (e) {
      S.pose = null;
      S.multiRes = null;
      // A broken pose model never recovers: load a fresh one.
      if (/timestamp|Graph has errors/i.test(String(e?.message ?? e)) && !S.landmarkerLoading) {
        try { S.landmarker?.close(); } catch { /* already broken */ }
        S.landmarker = null;
        S.landmarkerKey = null;
        loadLandmarker().catch(() => {});
      }
    }
    S.frameTimes.push(t);
    if (S.frameTimes.length > 30) S.frameTimes.shift();
    S.procTimes.push(performance.now());
    if (S.procTimes.length > 30) S.procTimes.shift();
    paceTestVideo();
    if (S.multi) onMulti(t); else onPose(t);
}

function drawFrame(src, w, h, wantPose, practice) {
  const now = performance.now();
  const tc = clockNow();
  const snap = S.replay ? replayAt(tc) : null;
  const pose = snap ? (snap.lm ? { lm: snap.lm } : null) : S.pose;
  const view = S.multi ? (snap ? snap.tracks || [] : multiView(tc)) : null;
  if (S.flashUntil && now > S.flashUntil) { $('flash').hidden = true; S.flashUntil = 0; }

  ctx.save();
  // The scan screen isn't mirrored, so the number reads the right way round.
  if (S.mirror && S.screen !== 'scan') { ctx.translate(w, 0); ctx.scale(-1, 1); }
  // A test video shows through from underneath (smoother); the camera is
  // drawn here, as it's what gets recorded.
  if (S.testMode && !S.testTurn) ctx.clearRect(0, 0, w, h); else ctx.drawImage(src, 0, 0, w, h);
  if (wantPose && pose && S.screen !== 'scan') {
    const color = S.flashUntil ? (S.flashGood ? '#22c55e' : '#e2231a') : '#ffffff';
    drawSkeleton(pose.lm, w, h, color);
  }
  if (wantPose && view) {
    // Everyone being tracked is outlined, so it's clear they've been seen:
    // thin grey until their first good burpee, then in their own colour.
    for (const k of view) {
      if (k.label == null) { drawSkeleton(k.lm, w, h, 'rgba(200, 200, 200, 0.8)', true); continue; }
      drawSkeleton(k.lm, w, h, k.flash ? (k.flash === 'good' ? '#22c55e' : '#e2231a') : athleteColour(k.label));
    }
  }
  if (practice && S.handLm) {
    ctx.fillStyle = S.gesture === 'Closed_Fist' ? '#ffb020' : S.gesture === 'Open_Palm' ? '#22c55e' : '#ffffff';
    for (const p of S.handLm) { ctx.beginPath(); ctx.arc(p.x * w, p.y * h, Math.max(4, w / 240), 0, 7); ctx.fill(); }
  }
  ctx.restore();

  if (S.screen === 'scan') {
    // A box that follows the athlete's forehead. Nothing is read without one.
    const b = S.headBox;
    if (b) {
      ctx.lineWidth = Math.max(4, w / 200);
      ctx.strokeStyle = '#e2231a';
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
  }
  if (view && S.screen === 'count') drawMultiLabels(w, h, view);
  if (S.attempt?.status === 'running' && !PRACTICE) drawBurnIn(w, h); // the challenge isn't race evidence
  if (S.screen === 'count' && S.attempt?.goAt) {
    if (S.challenge?.secs) {
      const left = S.challenge.secs * 1000 - (clockNow() - S.attempt.goAt);
      $('cntTimer').textContent = fmtTime(Math.max(0, left));
      callFinalSeconds(left);
      if (left <= 0 && S.attempt.status === 'running') finishAttempt('time');
    } else $('cntTimer').textContent = fmtTime(clockNow() - S.attempt.goAt);
  }
  if (S.testMode && !$('seek').hidden) { updateSeek(); $('testInfo').textContent = testInfo(); }
  $('streamLost').hidden = !(S.stream?.lost && CAMERA_SCREENS.has(S.screen));
}

// ---------------------------------------------------------------- recording

function startRecording() {
  S.recorder = null;
  if (!settings.record || S.testMode || !canvas.captureStream || !window.MediaRecorder) return;
  const type = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4']
    .find((t) => MediaRecorder.isTypeSupported(t));
  try {
    const rec = new MediaRecorder(canvas.captureStream(25), { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 1_500_000 });
    S.chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) S.chunks.push(e.data); };
    rec.start(1000);
    S.recorder = rec;
  } catch {
    S.recorder = null;
  }
}

function stopRecording() {
  const rec = S.recorder;
  S.recorder = null;
  if (!rec || rec.state === 'inactive') return Promise.resolve(null);
  return new Promise((resolve) => {
    rec.onstop = () => resolve(S.chunks.length ? new Blob(S.chunks, { type: rec.mimeType || 'video/webm' }) : null);
    rec.stop();
  });
}

// ---------------------------------------------------------------- storage

const videos = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('burpeeJudge', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('videos');
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => reject(req.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const t = db.transaction('videos', mode);
      const r = fn(t.objectStore('videos'));
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    });
  },
  put(id, blob) { return this.tx('readwrite', (s) => s.put(blob, id)); },
  get(id) { return this.tx('readonly', (s) => s.get(id)); },
  clear() { return this.tx('readwrite', (s) => s.clear()); },
};

function loadResults() { return readJSON(RESULTS_KEY, []); }
function saveResult(a) {
  const { events, ...rest } = a;
  const list = loadResults().filter((r) => r.id !== a.id);
  list.unshift({ ...rest, events });
  writeJSON(RESULTS_KEY, list);
  $('resultsCount').textContent = list.length;
}

function renderResults() {
  const list = loadResults();
  const body = $('resultsBody');
  body.replaceChildren();
  $('resultsEmpty').hidden = list.length > 0;
  for (const r of list) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => openAttempt(r.id));
    const cells = [
      new Date(r.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      r.bibSource === 'none' ? `Athlete ${r.bib}` : r.bib, `${r.reps}/${r.target}`, r.noReps, fmtTime(r.durationMs),
    ];
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.append(td);
    }
    const st = document.createElement('td');
    const pill = document.createElement('span');
    pill.className = `pill ${r.status === 'complete' ? 'ok' : r.status === 'test' ? 'test' : 'bad'}`;
    pill.textContent = (r.status === 'complete' ? 'Complete' : r.status === 'test' ? 'Test' : 'Not complete') + (r.mode && r.mode !== 'burpees' ? ` · ${exercise(r.mode).unit}` : '');
    st.append(pill);
    tr.append(st);
    const vd = document.createElement('td');
    if (r.video) {
      const wrap = document.createElement('div');
      wrap.className = 'video-cell';
      const play = document.createElement('button');
      play.type = 'button';
      play.className = 'btn btn-red';
      play.textContent = '▶ Play';
      play.addEventListener('click', (e) => { e.stopPropagation(); playVideo(r); });
      const save = document.createElement('button');
      save.type = 'button';
      save.className = 'btn btn-ghost';
      save.textContent = 'Save';
      save.addEventListener('click', (e) => { e.stopPropagation(); downloadVideo(r); });
      wrap.append(play, save);
      vd.append(wrap);
    } else {
      vd.textContent = '–';
    }
    tr.append(vd);
    body.append(tr);
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function downloadVideo(r) {
  const blob = await videos.get(r.videoId ?? r.id);
  if (!blob) return;
  const ext = (r.videoType || blob.type).includes('mp4') ? 'mp4' : 'webm';
  downloadBlob(blob, `${(r.mode || 'burpees').replace(/\W+/g, '')}_${r.bibSource === 'none' ? 'athlete' : 'bib'}${r.bib}_${r.startedAt.replace(/[:.]/g, '-')}.${ext}`);
}

// Replay a saved attempt video in the player overlay.
let playerUrl = null, playerAttempt = null;
async function playVideo(r) {
  const blob = await videos.get(r.videoId ?? r.id);
  const v = $('playerVideo');
  closePlayer();
  playerAttempt = r;
  $('playerTitle').textContent = bibTitle(r);
  $('playerInfo').textContent = blob
    ? `${r.reps}/${r.target} ${exercise(r.mode).unit}, ${r.noReps} no reps, ${fmtTime(r.durationMs)}. ${new Date(r.startedAt).toLocaleString()}`
    : 'The video for this attempt is no longer on this phone.';
  $('playerSave').hidden = !blob;
  $('player').hidden = false;
  if (!blob) return;
  playerUrl = URL.createObjectURL(blob);
  v.src = playerUrl;
  // Recorded WebM often has no duration, which breaks the seek bar. Seeking
  // far past the end makes the browser work it out, then go back to the start.
  v.onloadedmetadata = () => {
    if (v.duration !== Infinity) return;
    v.ontimeupdate = () => { v.ontimeupdate = null; v.currentTime = 0; };
    v.currentTime = 1e9;
  };
  v.play().catch(() => {});
}
function closePlayer() {
  const v = $('playerVideo');
  v.pause();
  v.onloadedmetadata = v.ontimeupdate = null;
  v.removeAttribute('src');
  v.load();
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = null;
  $('player').hidden = true;
}

const csvEsc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const sec = (ms) => (ms == null ? '' : (ms / 1000).toFixed(2));
const yesNo = (v) => (v == null ? '' : v ? 'yes' : 'no');

function downloadCsv(cols, rows, kind) {
  const csv = [cols.join(','), ...rows.map((r) => r.map(csvEsc).join(','))].join('\n');
  const tag = (settings.station || 'station').replace(/[^\w-]+/g, '_');
  downloadBlob(new Blob([csv], { type: 'text/csv' }), `burpee_${kind}_${tag}_${new Date().toISOString().slice(0, 10)}.csv`);
}

// One row per attempt.
function exportCsv() {
  const cols = ['attemptId', 'startedAt', 'finishedAt', 'station', 'bib', 'exercise', 'status', 'reps', 'target', 'noReps', 'durationSec',
    'noRepReasons', 'repTimesSec', 'bibReadBy', 'bibConfidence', 'bibOnStartList', 'camera', 'orientation', 'poseModel',
    'avgFps', 'outOfViewSec', 'othersInViewSec', 'video', 'thresholds', 'device', 'appVersion'];
  const rows = loadResults().map((r) => [
    r.id, r.startedAt, r.finishedAt, r.station, r.bib, r.mode || 'burpees', r.status, r.reps, r.target, r.noReps, sec(r.durationMs),
    Object.entries(r.reasons || {}).map(([k, v]) => `${k}: ${v}`).join('; '),
    (r.events || []).filter((e) => e.type === 'rep').map((e) => sec(e.t)).join(' '),
    r.bibSource, r.bibConfidence, yesNo(r.bibOnStartList), r.camera, r.orientation, r.model,
    r.avgFps, sec(r.outOfViewMs), sec(r.othersInViewMs), yesNo(r.video), JSON.stringify(r.thresholds || {}), r.device, r.app,
  ]);
  downloadCsv(cols, rows, 'summary');
}

// One row per burpee, with what was measured.
function exportRepLog() {
  const cols = ['attemptId', 'startedAt', 'station', 'bib', 'exercise', 'target', 'rep', 'result', 'countAfter', 'atSec', 'clockTime',
    'reasons', 'chestMin', 'chestFrames', 'maxLift', 'airFrames', 'maxHipAngle', 'maxHandMargin',
    'jumpOk', 'handsOk', 'hipsOk', 'downAtSec', 'upAtSec', 'decidedAtSec', 'measures'];
  const SHARED = new Set(['n', 'type', 't', 'at', 'count', 'reasons', 'downAt', 'upAt', 'endAt', 'chestMin', 'chestFrames', 'maxLift',
    'airFrames', 'maxHipAngle', 'maxHandMargin', 'jump', 'hands', 'hips']);
  const rows = [];
  for (const r of loadResults()) {
    for (const e of r.events || []) {
      rows.push([r.id, r.startedAt, r.station, r.bib, r.mode || 'burpees', r.target, e.n, e.type === 'rep' ? 'good' : 'no rep', e.count, sec(e.t), e.at,
        (e.reasons || []).join('; '), e.chestMin, e.chestFrames, e.maxLift, e.airFrames, e.maxHipAngle, e.maxHandMargin,
        yesNo(e.jump), yesNo(e.hands), yesNo(e.hips), sec(e.downAt), sec(e.upAt), sec(e.endAt),
        Object.entries(e).filter(([k]) => !SHARED.has(k)).map(([k, v]) => `${k}=${v}`).join('; ')]);
    }
  }
  downloadCsv(cols, rows, 'replog');
}

let openAttemptId = null;
function openAttempt(id) {
  const r = loadResults().find((x) => x.id === id);
  if (!r) return;
  openAttemptId = id;
  $('atBib').textContent = bibTitle(r);
  $('atNumber').value = r.bib === 'No number' ? '' : r.bibSource === 'none' ? '' : r.bib;
  const when = (iso) => (iso ? new Date(iso).toLocaleString() : '–');
  const facts = [
    ['Result', r.status === 'complete' ? 'Complete' : r.status === 'test' ? 'Test run' : 'Not complete'],
    ['Exercise', exercise(r.mode).label],
    ['Reps', `${r.reps} / ${r.target}`],
    ['No reps', r.noReps],
    ['Time', fmtTime(r.durationMs)],
    ['Started', when(r.startedAt)],
    ['Finished', when(r.finishedAt)],
    ['Station', r.station || '–'],
    ['Number read by', r.bibSource?.startsWith('scanner') ? `${r.bibSource.replace('scanner', 'Scanner')}, ${r.bibConfidence ?? '?'}% sure` : r.bibSource === 'typed' ? 'Typed in' : r.bibSource || '–'],
    ['On start list', r.bibOnStartList == null ? 'No list loaded' : r.bibOnStartList ? 'Yes' : 'No'],
    ['Camera', [r.camera, r.orientation && r.orientation !== 'auto' ? `landscape (${r.orientation})` : null].filter(Boolean).join(', ') || '–'],
    ['Pose model', r.model || '–'],
    ['Body tracking', r.tracking ? `${r.tracking}${r.filledPct != null ? `, points filled in on ${r.filledPct}% of frames` : ''}` : '–'],
    ['Tracking rate', r.avgFps ? `${r.avgFps} fps` : '–'],
    ['Athlete out of view', r.outOfViewMs != null ? `${(r.outOfViewMs / 1000).toFixed(1)} s` : '–'],
    ['Others in view', r.othersInViewMs != null ? `${(r.othersInViewMs / 1000).toFixed(1)} s` : '–'],
    ['No-rep reasons', Object.entries(r.reasons || {}).map(([k, v]) => `${k} ×${v}`).join(', ') || 'None'],
    ['Judging strictness', r.strictness == null ? '–' : `${strictnessWord(strictnessValue(r.strictness))} (${strictnessValue(r.strictness)} of 100)`],
    ['Thresholds', Object.entries(r.thresholds || {}).map(([k, v]) => `${k} ${v}`).join(', ')],
  ];
  const dl = $('atFacts');
  dl.replaceChildren();
  for (const [k, v] of facts) {
    const div = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    div.append(dt, dd);
    dl.append(div);
  }
  $('atVideo').hidden = !r.video;
  $('atPlay').hidden = !r.video;
  const ex = exercise(r.mode);
  const head = $('atHead');
  head.replaceChildren(...['#', 'At', 'Result', ...ex.columns.map((c) => c[0]), 'Why'].map((txt) => {
    const th = document.createElement('th'); th.textContent = txt; return th;
  }));
  $('atNote').textContent = ex.note;
  $('atNote').hidden = !ex.note;
  const body = $('atBody');
  body.replaceChildren();
  for (const e of r.events || []) {
    const tr = document.createElement('tr');
    const pill = document.createElement('span');
    pill.className = `pill ${e.type === 'rep' ? 'ok' : 'bad'}`;
    pill.textContent = e.type === 'rep' ? `Good ${e.count}` : 'No rep';
    const cells = [e.n ?? '', fmtTime(e.t), pill, ...ex.columns.map(([, key, fmt]) => fmt(e[key])), (e.reasons || []).join(', ')];
    for (const c of cells) {
      const td = document.createElement('td');
      if (c instanceof Node) td.append(c); else td.textContent = c;
      tr.append(td);
    }
    body.append(tr);
  }
  if (!(r.events || []).length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4 + ex.columns.length; td.textContent = `No ${ex.unit} were recorded.`;
    tr.append(td); body.append(tr);
  }
  show('attempt');
}

// ---------------------------------------------------------------- confirm dialog

function confirmDialog(text, yesLabel = 'Yes') {
  return new Promise((resolve) => {
    $('confirmText').textContent = text;
    $('confirmYes').textContent = yesLabel;
    $('confirm').hidden = false;
    const done = (v) => {
      $('confirm').hidden = true;
      $('confirmYes').onclick = $('confirmNo').onclick = null;
      resolve(v);
    };
    $('confirmYes').onclick = () => done(true);
    $('confirmNo').onclick = () => done(false);
  });
}

// ---------------------------------------------------------------- settings form

const FORM_FIELDS = ['exercise', 'people', 'videoPace', 'strictness', 'orientation', 'model', 'tracking', 'speech', 'record', 'debug', 'ocrEngine', 'captureBib', 'bibMin', 'bibMax', 'bibList'];

function fillSettingsForm() {
  for (const k of FORM_FIELDS) {
    const el = $(`s_${k}`);
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else el.value = settings[k];
  }
  showStrictness();
  $('settingsSaved').hidden = true;
  $('spartanDone').hidden = true;
}

// The word under the strictness slider follows it as it is dragged.
function showStrictness() {
  const v = Number($('s_strictness').value);
  $('strictnessWord').textContent = `${strictnessWord(v)} (${v})`;
}
$('s_strictness').addEventListener('input', showStrictness);

function readSettingsForm() {
  for (const k of FORM_FIELDS) {
    const el = $(`s_${k}`);
    if (el.type === 'checkbox') settings[k] = el.checked;
    else if (el.type === 'number' || el.type === 'range') settings[k] = el.value === '' ? DEFAULT_SETTINGS[k] : Number(el.value);
    else settings[k] = el.value;
  }
  if (settings.bibMin > settings.bibMax) [settings.bibMin, settings.bibMax] = [settings.bibMax, settings.bibMin];
}

// ---------------------------------------------------------------- home helpers

function showHomeError(text) { $('homeError').textContent = text; $('homeError').hidden = false; }
function hideHomeError() { $('homeError').hidden = true; }

function renderFacing() {
  for (const b of document.querySelectorAll('.seg button[data-facing]')) {
    b.setAttribute('aria-checked', String(b.dataset.facing === settings.facing));
  }
}

// Exit from anywhere while the camera is on, after a confirm. A running
// attempt is saved as not complete, with its video, before the camera stops.
let exitAsking = false;
async function askExitStation() {
  if (exitAsking || !CAMERA_SCREENS.has(S.screen)) return;
  exitAsking = true;
  cancelCountdown();
  const a = S.attempt?.status === 'running' ? S.attempt : null;
  const text = PRACTICE
    ? (a ? `Stop at ${a.reps}? It goes in your history and the camera turns off.` : 'Leave? The camera turns off.')
    : a
    ? `Exit the station? The attempt for bib ${a.bib} at ${a.reps}/${a.target} will be saved as not complete and the camera turns off.`
    : 'Exit the station? The camera turns off.';
  try {
    if (!(await confirmDialog(text, PRACTICE ? 'Leave' : 'Exit station'))) return;
    if (a) await finishAttempt('ended');
    await closeStation();
  } finally {
    exitAsking = false;
  }
}

async function closeStation() {
  clearInterval(S.doneTimer);
  if (S.testMode) { S.testMode = false; video.pause(); video.removeAttribute('src'); video.load(); }
  $('stage').classList.remove('overlay');
  showSeek(false);
  S.prepassing = false;
  S.quiet = false;
  S.replay = null;
  showLoader(null);
  // Drop the history entry added when the station opened.
  if (history.state?.station) { ignorePop = true; history.back(); }
  await stopRecording();
  stopCamera();
  S.attempt = null;
  S.judge = null;
  S.multi = null;
  try { await S.wakeLock?.release(); } catch { /* already released */ }
  show('home');
}

async function runTestVideo(file) {
  hideHomeError();
  if (!applyReps()) return;
  stopCamera();
  try {
    S.audio ??= new (window.AudioContext || window.webkitAudioContext)();
  } catch { /* no audio */ }
  $('homeStatus').textContent = 'Loading pose model…';
  // How to run it: the home screen's Detailed or Real-time test button, or Settings.
  S.pace = S.nextPace ?? settings.videoPace;
  S.testTurn = 0;
  S.nextPace = null;
  showLoader(S.landmarker ? 'Loading video…' : 'Loading pose model…');
  try {
    await loadLandmarker();
  } catch (e) {
    showLoader(null);
    showHomeError(`The pose model didn't load: ${e.message}`);
    return;
  }
  $('homeStatus').textContent = `Pose model ready (${settings.model}).`;
  // Several athletes: wait for the person finder too (it can take a few
  // seconds), so the start of the video isn't played past unwatched.
  if (multiMode() && S.finderReady) {
    showLoader('Loading person finder…');
    await Promise.race([S.finderReady, new Promise((r) => setTimeout(r, 30000))]);
  }
  showLoader('Loading video…');
  S.testMode = true;
  S.mirror = false;
  video.srcObject = null;
  video.src = file.url || URL.createObjectURL(file);
  video.loop = false;
  video.onended = () => finishAttempt('ended');
  S.bib = 'TEST';
  S.attempt = newAttempt('TEST', `Test: ${file.name}`);
  if (!history.state?.station) history.pushState({ station: true }, '');
  try {
    await new Promise((res, rej) => { video.onloadeddata = res; video.onerror = () => rej(new Error(video.error?.message || 'unsupported file')); });
    // Each model's first run is slow (it sets itself up on the graphics
    // chip, freezing the page for a moment): get that done before playing.
    showLoader('Getting ready…');
    await warmUp();
    // The video itself is shown, playing smoothly; outlines and labels are
    // drawn on a clear layer over it.
    $('stage').classList.add('overlay');
    S.procTimes = [];
    S.paceAt = performance.now();
    S.clockBase = performance.now();
    if (S.pace === 'prepass') {
      // Analyse every frame first, then play it all at normal speed.
      if (multiMode()) beginMulti(); else beginCounting();
      await prepass(S.pickScout ? await S.pickScout() : null);
      if (!S.testMode) return; // closed while analysing
      if (S.afterPrepass) { const after = S.afterPrepass; S.afterPrepass = null; showLoader(null); return after(); }
      await seekTo(0);
      video.playbackRate = 1;
      showLoader(null);
      if (S.upload) { // analysed: it waits for someone to press play
        showSeek(true);
        try { parent.postMessage({ judge: 'analysed', cfg: CFG }, location.origin); } catch { /* not in a frame */ }
        return;
      }
      await video.play();
      showSeek(true);
      return;
    }
    S.replay = null;
    S.videoDur = await videoDuration();
    // Real time: normal speed throughout, judging whatever frames the phone
    // keeps up with, as a live camera would. Otherwise start slower and
    // settle to what the phone keeps up with.
    video.playbackRate = S.pace === 'realtime' || !multiMode() ? 1 : 0.5;
    await video.play();
    showSeek(true);
  } catch (e) {
    showLoader(null);
    await closeStation();
    showHomeError(`That video couldn't be played: ${e.message}`);
    return;
  }
  showLoader(null);
  if (multiMode()) beginMulti(); else beginCounting();
}

// ---------------------------------------------------------------- analyse first, then play
//
// A test video can be analysed frame by frame first (no frame skipped, however
// slow the phone), then played at normal speed with everything shown at the
// moment it happened. Each frame's outlines and counts are kept in S.replay;
// reps and no reps in S.replayEvents, with their sounds and flashes played
// when the video reaches them.
const PREPASS_FPS = 15;

// The video's length. Videos recorded in a browser often don't say; seeking
// far past the end makes it work it out.
async function videoDuration() {
  if (Number.isFinite(video.duration)) return video.duration;
  await new Promise((r) => { video.ontimeupdate = () => { video.ontimeupdate = null; r(); }; video.currentTime = 1e9; });
  const d = video.duration;
  video.currentTime = 0;
  return Number.isFinite(d) ? d : 0;
}

// ---------------------------------------------------------------- test video controls
//
// Play/pause and a bar to jump to any point. In a detailed test everything is
// already worked out, so the picture, counts and list simply show that moment
// (the sounds of reps jumped over are skipped). Judged as it plays, the
// judging clock carries on forward from where it was, as if the camera had
// cut: counts so far stay, and reps jumped over aren't seen.
function showSeek(on) {
  $('seek').hidden = !on;
  $('testInfo').hidden = !on;
  // Turning only while judging as it plays: a detailed test's outlines were
  // worked out on the picture as it was.
  $('seekTurn').hidden = !!S.replay;
  if (on) updateSeek();
}

// What a test is running on, so its result can be judged: frames analysed a
// second (real time), whether the person finder is working, people in view.
function testInfo() {
  const finder = !multiMode() ? ''
    : S.finder ? ` · person finder: ${S.finder.provider === 'webgpu' ? 'graphics chip' : 'processor (slow)'}`
    : S.finderLoading ? ' · person finder: loading'
    : ` · person finder: off${S.finderError ? ` (${S.finderError})` : ''}`;
  const people = S.multi ? ` · ${S.multi.tracks.filter((k) => clockNow() - k.seenAt < 1500).length} in view` : '';
  const speed = S.replay ? 'Detailed: every frame analysed' : `Analysing ${Math.round(procFps() ?? 0)} frames/s`;
  return speed + finder + people;
}

function updateSeek() {
  const d = S.videoDur || video.duration || 0;
  if (!S.seekDrag && d) $('seekBar').value = Math.round((video.currentTime / d) * 1000);
  const at = S.seekDrag ? (Number($('seekBar').value) / 1000) * d : video.currentTime;
  $('seekTime').textContent = `${fmtTime(at * 1000)} / ${fmtTime(d * 1000)}`;
  $('seekPlay').textContent = video.paused ? '▶' : '❚❚';
  $('seekPlay').setAttribute('aria-label', video.paused ? 'Play' : 'Pause');
}

async function jumpTo(time) {
  const d = S.videoDur || video.duration || 0;
  time = Math.max(0, Math.min(d ? d - 0.05 : time, time));
  if (S.replay) {
    await seekTo(time);
    S.replayEvAt = S.clockBase + time * 1000; // don't play the reps jumped over
  } else {
    const before = clockNow();
    await seekTo(time);
    S.clockBase = before + 1 - time * 1000; // the judging clock only goes forward
    S.lastVideoTime = -1;
  }
  updateSeek();
}

function seekTo(time) {
  return new Promise((r) => {
    const done = () => { clearTimeout(timer); r(); };
    const timer = setTimeout(() => { video.removeEventListener('seeked', done); r(); }, 3000);
    video.addEventListener('seeked', done, { once: true });
    video.currentTime = time;
  });
}

// What to draw for the frame just analysed.
function snapshot(t) {
  if (S.multi) return { t, tracks: multiView(t), people: S.multi.athletes.map((k) => ({ label: k.label, count: k.judge.count, noReps: k.judge.noReps, gone: !!k.gone })) };
  return { t, lm: S.pose?.lm ?? null, reps: S.attempt.reps, noReps: S.attempt.noReps };
}

// range (seconds, optional): analyse only that stretch of the video
async function prepass(range) {
  S.prepassing = true;
  S.quiet = true;
  S.replay = [];
  S.replayEvents = [];
  S.videoDur = await videoDuration();
  const i0 = range ? Math.max(0, Math.floor(range.from * PREPASS_FPS)) : 0;
  const n = Math.floor((range ? Math.min(range.to, S.videoDur) : S.videoDur) * PREPASS_FPS);
  for (let i = i0; i < n && S.testMode; i++) {
    await seekTo(i / PREPASS_FPS);
    S.lastVideoTime = video.currentTime;
    S.frame = frameSource();
    const { src, w, h } = S.frame;
    const t = clockNow();
    // The person finder is waited for here (no frame goes by meanwhile).
    if (S.multi && S.finder && t - S.findAt >= MULTI_DEFAULTS.findEveryMs) {
      S.findAt = t;
      const z = S.multi.zoom;
      const area = z ? { x: z.x0, y: z.y0, w: z.x1 - z.x0, h: z.y1 - z.y0 } : { x: 0, y: 0, w: 1, h: 1 };
      try { S.findBoxes = await S.finder.find(src, w, h); } catch { S.findBoxes = null; }
    }
    analyseFrame(src, w, h, t);
    S.replay.push(snapshot(t));
    if (i % 5 === 0) {
      showLoader(`${range ? 'Analysing the athlete' : 'Analysing the video'}… ${Math.round((100 * (i - i0)) / Math.max(1, n - i0))}%`);
      await new Promise((r) => setTimeout(r));
    }
  }
  // an uploaded video: the end of the analysis is the end of the round for its entries in the review
  if (S.upload && S.multi && S.testMode) {
    for (const { track, ev } of S.multi.finish()) onMultiEvent(track, ev);
    sendProof(true);
    for (const k of S.multi.athletes) if (!k.reportedDone) { k.reportedDone = true; reportAthleteDone(k); }
  }
  S.prepassing = false;
  S.quiet = false;
  S.replayEvAt = -Infinity;
}

// The snapshot for judging-clock time tc (the last one at or before it).
function replayAt(tc) {
  const r = S.replay;
  if (!r?.length) return null;
  let lo = 0, hi = r.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (r[mid].t <= tc) lo = mid; else hi = mid - 1; }
  return r[lo];
}

// Play the sounds and flashes of reps the replay has reached, and keep the
// count and list up to date.
function replayTo(tc) {
  for (const e of S.replayEvents) {
    if (e.t <= S.replayEvAt || e.t > tc) continue;
    if (e.k) multiEventSound(e.k, e.ev);
    else showJudgeEvent(e.ev);
  }
  S.replayEvAt = tc;
  const snap = replayAt(tc);
  if (!snap || S.screen !== 'count') return;
  if (S.multi) renderMulti(snap.people); // everyone counted so far, in view or not
  else { $('cntNum').textContent = snap.reps; $('cntNoReps').textContent = snap.noReps; }
}

// First run of each model on the video's first frame (see runTestVideo).
async function warmUp() {
  const t = Math.max(performance.now(), S.lastModelT + 1);
  S.lastModelT = t;
  try { S.landmarker?.detectForVideo(video, t); } catch { /* the first real frame will tell */ }
  try { S.scanner?.detect(video); } catch { /* optional */ }
  try { await S.finder?.find(video, video.videoWidth, video.videoHeight); } catch { /* optional */ }
}

// Full-screen loader with a message, or null to hide it.
function showLoader(text) {
  $('loader').hidden = !text;
  if (text) $('loaderText').textContent = text;
}

// ---------------------------------------------------------------- wire up

$('stationName').value = settings.station;
$('customReps').value = settings.customReps;
renderFacing();
renderReps();
renderExercise();
applyPageTurn();
$('resultsCount').textContent = loadResults().length;

for (const b of document.querySelectorAll('.seg button[data-facing]')) {
  b.addEventListener('click', () => { settings.facing = b.dataset.facing; saveSettings(); renderFacing(); });
}
for (const b of document.querySelectorAll('.seg button[data-reps]')) {
  b.addEventListener('click', () => {
    settings.repsChoice = b.dataset.reps;
    saveSettings();
    renderReps();
    hideHomeError();
    if (settings.repsChoice === 'custom') $('customReps').focus();
  });
}
$('customReps').addEventListener('input', () => { settings.customReps = $('customReps').value; saveSettings(); });
$('openStation').addEventListener('click', () => openStation());
// Judging a phone's stream on this computer: ask for its address (remembered).
$('openStream').addEventListener('click', () => {
  $('streamUrl').value = settings.streamUrl || DEFAULT_STREAM_URL;
  $('streamDlg').hidden = false;
  $('streamUrl').focus();
});
// Opened for one station (judge.html?stream=…, as the PC Receiver app does): its address is filled in, ready to go.
{
  const fromLink = new URLSearchParams(location.search).get('stream');
  if (fromLink) {
    settings.streamUrl = fromLink;
    saveSettings();
    $('streamUrl').value = fromLink;
    // &go=1 (the Receiver's video review): start judging straight away, and keep trying until the picture arrives
    if (new URLSearchParams(location.search).get('go')) {
      // inside a camera in the video review: the judging screen only (the review starts and stops it)
      document.documentElement.classList.add('embedded');
      const go = async () => { await openStation(fromLink); if (!$('home').hidden && !S.stream) setTimeout(go, 5000); };
      go();
    } else $('streamDlg').hidden = false;
  }
}
$('streamCancel').addEventListener('click', () => { $('streamDlg').hidden = true; });
$('streamForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const url = $('streamUrl').value.trim();
  if (!url) return;
  settings.streamUrl = url;
  saveSettings();
  $('streamDlg').hidden = true;
  openStation(url);
});
$('rulesBtn').addEventListener('click', () => showRules(true));
$('rulesClose').addEventListener('click', () => showRules(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('rules').hidden) showRules(false); });
$('goResults').addEventListener('click', () => { renderResults(); show('results'); });
$('goSettings').addEventListener('click', () => { fillSettingsForm(); show('settings'); });
// judge.html?settings=1 (the Receiver's Judge settings): open on the settings
if (IN_RECEIVER) $('s_exercise').insertAdjacentHTML('beforeend', '<option value="practice">Fist test: one hand, to check detection</option>');
if (new URLSearchParams(location.search).get('settings')) { if (CFG) cameraSettings(); fillSettingsForm(); show('settings'); }

// A camera's settings in the Receiver's video review: everything on one screen, the camera's name and the reps
// required at the top, and Close / Save at the bottom. The video review hears which was pressed.
function cameraSettings() {
  const form = $('settingsForm');
  const top = document.createElement('div');
  top.className = 'camera-top';
  top.innerHTML = `<div class="cfg-actions"><button type="button" class="btn btn-ghost" data-cfgclose>Close</button><button type="submit" class="btn btn-red">Save</button></div>
    <label class="field" for="c_name"><span>Camera name</span><input id="c_name" type="text" maxlength="40" placeholder="e.g. Burpee zone – front"></label>
    <label class="field" for="c_reps"><span>Reps each athlete must complete</span><input id="c_reps" type="number" inputmode="numeric" min="1" max="200" step="1"></label>
    <label class="check" for="c_track"><input id="c_track" type="checkbox"> <span>Show the tracking on the picture (outlines and labels). Off: just the video, while the judge still tracks and counts.</span></label>`;
  form.prepend(top);
  $('c_name').value = settings.station || '';
  $('c_reps').value = settings.targetReps || 30;
  $('c_track').checked = settings.showTracking !== false;
  $('settingsBack').hidden = true;
  const row = form.querySelector('button[type="submit"]').parentElement;
  // the usual Save settings / Reset buttons stay (hidden: other code uses them); Close and Save take their place
  for (const b of row.querySelectorAll('button')) b.hidden = true;
  row.insertAdjacentHTML('beforeend', '<button type="button" id="cfgClose" class="btn btn-ghost">Close</button><button type="submit" class="btn btn-red">Save</button>');
  const tell = (what) => { try { parent.postMessage({ judge: what, cfg: CFG }, location.origin); } catch { /* not in a frame */ } };
  $('cfgClose').onclick = () => tell('close');
  top.querySelector('[data-cfgclose]').onclick = () => tell('close');
  form.addEventListener('submit', (e) => {
    e.preventDefault(); e.stopImmediatePropagation();
    readSettingsForm();
    const reps = Math.max(1, Math.min(200, Math.round(Number($('c_reps').value)) || 30));
    settings.targetReps = reps; settings.repsChoice = reps === 30 ? '30' : 'custom'; settings.customReps = String(reps);
    settings.station = $('c_name').value.trim();
    settings.showTracking = $('c_track').checked;
    saveSettings();
    tell('saved');
  }, true);
}

// ---------------------------------------------------------------- one athlete in a recorded clip (the Receiver's replay)
// judge.html?clip=<video address>&pickx=&picky=&pickt=: analyse the clip frame by frame, watching everyone, then open
// the breakdown (every rep and no rep, with the measurements and reasons) for the athlete who was at pickx, picky
// (shares of the picture's width and height) pickt seconds into the clip.
// When the picked athlete is on screen: the person finder alone, 3 times a second, out from the picked moment both
// ways, following whoever was clicked (the box that overlaps theirs most across the picture) until they've been out
// of sight for 4 seconds. Returns the stretch to analyse in full (2 seconds' margin each side), or null for all of it.
async function scoutPick(px, py, pt) {
  if (S.finderReady) await Promise.race([S.finderReady, new Promise((r) => setTimeout(r, 30000))]);
  const dur = await videoDuration();
  if (!S.finder || !dur) return null;
  const STEP = 1 / 3, GONE = 4;
  const boxesAt = async (t) => { await seekTo(t); const f = frameSource(); try { return await S.finder.find(f.src, f.w, f.h); } catch { return []; } };
  const xOverlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) / Math.max(0.01, Math.min(a.x1 - a.x0, b.x1 - b.x0));
  const inside = (b) => px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1;
  const dist = (b) => Math.hypot(px - (b.x0 + b.x1) / 2, py - (b.y0 + b.y1) / 2);
  // the person there at that moment (or within 2 seconds of it: the finder can miss someone lying flat)
  let first = null;
  for (const dt of [0, -0.5, 0.5, -1, 1, -2, 2]) {
    const t = Math.max(0, Math.min(pt + dt, dur - 0.05)), boxes = await boxesAt(t);
    first = boxes.find(inside) || boxes.filter((b) => dist(b) < 0.25).sort((a, b) => dist(a) - dist(b))[0];
    if (first) { pt = t; break; }
  }
  if (!first) return null;
  let from = pt, to = pt, done = 0;
  for (const dir of [1, -1]) {
    let ref = first, seen = pt;
    for (let t = pt + dir * STEP; t >= 0 && t <= dur - 0.05 && Math.abs(t - seen) <= GONE && S.testMode; t += dir * STEP) {
      const m = (await boxesAt(t)).map((b) => ({ b, o: xOverlap(b, ref) })).filter((x) => x.o > 0.3).sort((a, b) => b.o - a.o)[0];
      if (m) { ref = m.b; seen = t; }
      if (++done % 6 === 0) { showLoader(`Finding when they're on screen… ${Math.round(Math.abs(seen - pt))} s`); await new Promise((r) => setTimeout(r)); }
    }
    if (dir > 0) to = seen; else from = seen;
  }
  return { from: Math.max(0, from - 2), to: Math.min(dur, to + 2) };
}
async function analysePick(url, px, py, pt) {
  S.forceMulti = true;   // for this run only: everyone is followed so the right one can be picked
  S.nextPace = 'prepass';
  S.pickScout = () => scoutPick(px, py, pt);
  S.afterPrepass = async () => {
    const tc = S.clockBase + pt * 1000;
    let best = null, bestD = Infinity;
    for (const snap of S.replay || []) {
      const dt = Math.abs(snap.t - tc);
      if (dt > 1500 || !snap.tracks) continue;
      for (const k of snap.tracks) {
        if (k.label == null || !k.box) continue;
        const b = k.box;
        const inside = px >= b.left && px <= b.right && py >= b.top && py <= b.bottom;
        const d = (inside ? 0 : Math.hypot(px - b.x, py - (b.top + b.bottom) / 2)) + dt / 20000;
        if (d < bestD) { bestD = d; best = k.label; }
      }
    }
    const id = S.attempt.id;
    await finishMulti('ended');
    if (best != null && bestD < 0.25) openAttempt(`${id}-${best}`);
    else {
      $('doneLabel').textContent = 'No athlete found there';
      $('doneMulti').replaceChildren(Object.assign(document.createElement('li'), { textContent: 'Nobody the judge counted reps for was where you clicked at that moment. Try clicking on the athlete while they are standing, or show a longer clip.' }));
    }
  };
  try { await runTestVideo({ url, name: 'replay clip' }); } finally { S.forceMulti = false; S.afterPrepass = null; S.pickScout = null; }
}
{
  const q = new URLSearchParams(location.search);
  if (q.get('heavy')) S.modelOverride = 'heavy';
  if (q.get('clip')) analysePick(q.get('clip'), +q.get('pickx'), +q.get('picky'), +q.get('pickt'));
  // an uploaded video in the review's Upload tab: judged as it plays, exactly like a live camera (judge.html?video=&go=1&cfg=upload)
  else if (q.get('video') && q.get('go')) {
    document.documentElement.classList.add('embedded');
    S.upload = { saved: decodeURIComponent(q.get('video').split('/').pop()), name: q.get('name') || 'video' };
    S.forceMulti = true; S.nextPace = 'prepass'; // every frame analysed first, so no jump falls between frames; it doesn't play by itself
    runTestVideo({ url: q.get('video'), name: S.upload.name });
  }
}
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', () => show('home')));
// Two ways to test with a video file: detailed (every frame analysed first,
// then played at normal speed) or real time (as a live camera would judge it).
for (const [id, pace] of [['testDetailed', 'prepass'], ['testRealtime', 'realtime']]) {
  $(id).addEventListener('click', () => { S.nextPace = pace; $('testFile').click(); });
}
for (const [id, q] of [['turnLeft', 3], ['turnRight', 1]]) {
  $(id).addEventListener('click', () => {
    S.testTurn = (S.testTurn + q) % 4;
    // Upright again: the smooth video shows through; turned, the app draws it.
    $('stage').classList.toggle('overlay', !S.testTurn);
    S.lastVideoTime = -1;
  });
}
$('seekPlay').addEventListener('click', () => {
  if (video.paused) video.play().catch(() => {}); else video.pause();
  updateSeek();
});
$('seekBar').addEventListener('input', () => { S.seekDrag = true; updateSeek(); });
$('seekBar').addEventListener('change', async () => {
  const d = S.videoDur || video.duration || 0;
  await jumpTo((Number($('seekBar').value) / 1000) * d);
  S.seekDrag = false;
  updateSeek();
});
$('testFile').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  e.target.value = '';
  if (f) runTestVideo(f);
});

// Type number stops the scanner until the marshal switches back to scanning
// (or the next athlete), so a read can't jump in while they type.
function setTyping(on) {
  S.typing = on;
  $('manualForm').hidden = !on;
  $('typeBib').textContent = on ? 'Scan instead' : 'Type number';
  if (on) {
    clearTimeout(ocrTimer);
    S.ocrReads = [];
    S.headBox = null;
    $('ocrReading').textContent = 'Scanner off: type the number';
    $('ocrMeta').textContent = '';
    $('ocrPeek').hidden = true;
    $('manualBib').focus();
  } else {
    $('manualWarn').hidden = true;
    if (S.screen === 'scan') { $('ocrReading').textContent = '–'; scheduleOcr(); }
  }
}
$('typeBib').addEventListener('click', () => setTyping(!S.typing));
let manualOverride = null;
$('manualForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const bib = $('manualBib').value.replace(/\D/g, '');
  if (!bib) return;
  const list = bibList();
  if (list.size && !list.has(bib) && manualOverride !== bib) {
    manualOverride = bib;
    $('manualWarn').textContent = `${bib} isn't on the start list. Tap Confirm again to use it anyway.`;
    $('manualWarn').hidden = false;
    return;
  }
  manualOverride = null;
  goPosition(bib);
});
// inside a camera in the video review, EXIT stops this camera's AI judge (the review does it)
$('exitStation').addEventListener('click', (e) => {
  if (document.documentElement.classList.contains('embedded')) { e.stopImmediatePropagation(); window.__finishRound().then(() => { try { parent.postMessage({ judge: 'exit', cfg: CFG }, location.origin); } catch { /* not in a frame */ } }); return; }
  askExitStation();
});
// Browser Back while the station is open: stay on the page and ask first.
let ignorePop = false;
window.addEventListener('popstate', () => {
  if (document.documentElement.classList.contains('embedded')) return;
  if (ignorePop) { ignorePop = false; return; }
  if (!CAMERA_SCREENS.has(S.screen)) return;
  history.pushState({ station: true }, '');
  askExitStation();
});
$('wrongBib').addEventListener('click', goScan);
$('forceStart').addEventListener('click', () => { if (S.landmarker) { if (PRACTICE) startCountdown(); else startAttempt(); } });

$('endAttempt').addEventListener('click', async () => {
  if (S.testMode) { video.pause(); finishAttempt('ended'); return; }
  const a = S.attempt;
  const ask = PRACTICE ? `Stop now at ${a.reps}?` : S.multi
    ? 'End this round? Each athlete is saved with the reps counted so far.'
    : `End the attempt for ${bibTitle(a).toLowerCase()} at ${a.reps}/${a.target}? It will be saved as not complete.`;
  if (await confirmDialog(ask, PRACTICE ? 'Stop' : S.multi ? 'End round' : 'End attempt')) {
    finishAttempt('ended');
  }
});
$('nextAthlete').addEventListener('click', () => {
  if (S.testMode) { closeStation(); return; }
  goScan();
});

let homeSavedTimer = null;
$('settingsForm').addEventListener('submit', (e) => { e.preventDefault(); saveSettingsAndGoHome(); });
$('settingsBack').addEventListener('click', saveSettingsAndGoHome);
function saveSettingsAndGoHome() {
  const oldModel = `${settings.model}:${settings.tracking}`;
  const oldMulti = multiMode();
  readSettingsForm();
  saveSettings();
  applyPageTurn();
  renderExercise();
  if (currentExercise().gestures) loadGestures().catch(() => {});
  ensureReader().catch((e) => showHomeError(`The number reader didn't load: ${e.message}`));
  if (`${settings.model}:${settings.tracking}` !== oldModel || multiMode() !== oldMulti) preloadModel();
  S.filter = null;
  show('home');
  $('homeSaved').hidden = false;
  clearTimeout(homeSavedTimer);
  homeSavedTimer = setTimeout(() => { $('homeSaved').hidden = true; }, 3000);
}
$('spartanDefault').addEventListener('click', () => {
  Object.assign(settings, SPARTAN_DEFAULT);
  saveSettings();
  fillSettingsForm();
  $('spartanDone').hidden = false;
});
$('resetSettings').addEventListener('click', () => {
  settings = { ...DEFAULT_SETTINGS, station: settings.station, facing: settings.facing };
  saveSettings();
  fillSettingsForm();
});

$('exportCsv').addEventListener('click', exportCsv);
$('exportReps').addEventListener('click', exportRepLog);
$('attemptBack').addEventListener('click', () => { renderResults(); show('results'); });
$('atPlay').addEventListener('click', () => {
  const r = loadResults().find((x) => x.id === openAttemptId);
  if (r) playVideo(r);
});
$('playerClose').addEventListener('click', closePlayer);
$('playerSave').addEventListener('click', () => { if (playerAttempt) downloadVideo(playerAttempt); });
$('playerDetail').addEventListener('click', () => { const r = playerAttempt; closePlayer(); if (r) openAttempt(r.id); });
$('atVideo').addEventListener('click', () => {
  const r = loadResults().find((x) => x.id === openAttemptId);
  if (r) downloadVideo(r);
});
$('clearResults').addEventListener('click', async () => {
  const n = loadResults().length;
  if (!n) return;
  if (await confirmDialog(`Delete all ${n} results and their videos from this phone? This can't be undone. Export the CSV first if you need it.`, 'Delete all')) {
    writeJSON(RESULTS_KEY, []);
    try { await videos.clear(); } catch { /* nothing stored */ }
    $('resultsCount').textContent = 0;
    renderResults();
  }
});

// the home screen, unless this was opened on the settings (judge.html?settings=1) or the rules (?rules=1: what counts,
// for the review's What counts? button; closing it tells the review)
const onlyRules = new URLSearchParams(location.search).get('rules');
const onlyAttempt = new URLSearchParams(location.search).get('attempt');
if (onlyAttempt) { document.documentElement.classList.add('embedded'); openAttempt(onlyAttempt); if ($('attempt').hidden) { show('home'); showHomeError('That athlete\'s reps aren\'t on this device: open the video review on the judging laptop.'); } }
else if (onlyRules) {
  document.documentElement.classList.add('embedded', 'rules-only');
  showRules(true);
  $('rulesClose').addEventListener('click', () => { try { parent.postMessage({ judge: 'close', cfg: CFG }, location.origin); } catch { /* not in a frame */ } });
} else if (!new URLSearchParams(location.search).get('settings')) show('home');
preloadModel();
requestAnimationFrame(frame);

// The round in progress, saved (counts, numbers, video): before the video review stops or restarts this judge.
window.__finishRound = async () => {
  if (!S.attempt || S.attempt.status !== 'running') return;
  try { if (S.attempt.multi) await finishMulti('stopped'); else await finishAttempt('stopped'); } catch { /* nothing to save */ }
};

// Typing in (or correcting) an athlete's number on their breakdown: saved with their result, so the number search finds them.
$('atNumberSave').addEventListener('click', () => {
  const r = loadResults().find((x) => x.id === openAttemptId); if (!r) return;
  const v = $('atNumber').value.trim();
  r.bib = v || (r.bibSource === 'none' ? r.bib : 'No number'); r.bibSource = v ? 'typed' : r.bibSource;
  saveResult(r);
  $('atBib').textContent = bibTitle(r); $('atNumberSaved').hidden = false; setTimeout(() => { $('atNumberSaved').hidden = true; }, 2000);
});

// ---------------------------------------------------------------- Spartans Challenge (judge.html?mode=practice&exercise=...&challenge=...)
// For anyone, to the Spartan setup, the phone's owner only (no race number, no station). Chosen on the menu
// (scoreboard.html). Where to put the camera, then front or back; once they're in position a spoken countdown starts
// it. Practice counts until they stop; the 1-minute and 5-minute challenges run out the clock, calling the last 5
// seconds. Every attempt goes in their history; a full challenge can go on the scoreboard if they say so. The hand test
// is for admins: the menu only shows it to them, this page sends anyone else back, and the server refuses their scores.
const PRACTICE_REPS = 9999;
const CHALLENGES = { free: { label: 'Practice', secs: 0 }, '1min': { label: '1 Minute', secs: 60 }, '5min': { label: '5 Minute', secs: 300 } };

// Head to feet in the picture: the judge alone doesn't need the head, but a fair start does.
function wholeBody(m) {
  return !!m?.fullBody && m.earY != null && m.earY > 0 && m.footY < 1;
}

function startCountdown() {
  const steps = ['Starting in', '3', '2', '1'], el = $('countdownNum');
  let i = 0;
  S.lostSince = null;
  show('countdown');
  const next = () => {
    if (i === steps.length) { el.classList.remove('words'); say('Go!'); beep(1320, 400, 'square', 0.2); startAttempt(); return; }
    const word = steps[i++];
    el.textContent = word;
    el.classList.toggle('words', word.length > 1);
    say(word);
    if (word.length === 1) beep(880, 120);
    S.countdownTimer = setTimeout(next, word.length > 1 ? 1200 : 1000);
  };
  next();
}

function cancelCountdown() {
  if (S.screen === 'countdown') goPosition(S.bib, S.bibSource);
}

function showCallout(text, ms = 0) {
  const el = $('callout');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(S.calloutTimer);
  if (ms) S.calloutTimer = setTimeout(() => { el.hidden = true; }, ms);
}

// The last 5 seconds of a timed challenge, on screen and out loud (rep numbers stop being said so they don't talk over it).
function callFinalSeconds(left) {
  const sec = Math.ceil(left / 1000);
  if (left <= 0 || sec > 5 || sec === S.finalSaid) return;
  S.finalSaid = sec;
  showCallout(String(sec));
  say(String(sec));
  beep(880, 120);
}

function practiceHome() {
  const chosen = new URLSearchParams(location.search).get('challenge');
  if (!CHALLENGES[chosen]) { location.replace('scoreboard.html'); return; }
  S.challenge = { mode: chosen, ...CHALLENGES[chosen] };
  document.documentElement.classList.add('practice-mode');
  const ex = currentExercise(), menu = `scoreboard.html?mode=${chosen}&exercise=${settings.exercise}`;
  if (ex.gestures) {
    $('setup').hidden = true;
    getMe().then((me) => { if (!me.admin) location.replace('scoreboard.html'); else if (S.screen === 'setup') $('setup').hidden = false; });
    document.querySelector('.setup-pictures').hidden = true;
    document.querySelector('.setup-tips').hidden = true;
    $('chkBody').hidden = true;
  }
  document.title = `Spartans challenge: ${ex.label}`;
  $('setupEyebrow').textContent = `Spartans challenge · ${ex.label}`;
  $('setupTitle').textContent = S.challenge.label;
  $('setupFlow').textContent = ex.flow || '';
  $('setupBack').href = menu;
  $('doneMenu').href = menu;
  $('doneMenu').hidden = false;
  $('nextAthlete').textContent = 'Go again';
  $('setup').append($('homeError'));
  const start = (facing) => () => { settings.facing = facing; openStation(); };
  $('startFront').addEventListener('click', start('user'));
  $('startBack').addEventListener('click', start('environment'));
  const showMute = () => {
    $('muteBtn').textContent = settings.speech ? '🔊 Mute' : '🔇 Unmute';
    $('muteBtn').setAttribute('aria-pressed', String(!settings.speech));
  };
  $('muteBtn').hidden = false;
  showMute();
  $('muteBtn').addEventListener('click', () => {
    settings.speech = !settings.speech;
    saveSettings();
    showMute();
    if (!settings.speech) { nativeSpeech()?.stop().catch(() => {}); window.speechSynthesis?.cancel(); }
  });
  $('submitNo').addEventListener('click', () => { $('submitAsk').hidden = true; $('doneVideo').textContent = 'Not submitted. It\'s in your history.'; });
  syncAttempts();
}

// The score, saved to their history, and for a full challenge the question of the scoreboard.
function practiceDone(a, status) {
  const c = S.challenge;
  const full = !c.secs || status === 'time';
  const key = settings.exercise, unit = currentExercise().unit;
  const before = bestAttempt(loadLocalAttempts(), key, c.mode, S.challengeBests);
  const record = { id: a.id.replace(/[^a-z0-9-]/gi, '').slice(0, 40), exercise: key, mode: c.mode, reps: a.reps, noReps: a.noReps, durationMs: a.durationMs, status: full ? 'full' : 'stopped', camera: a.camera === 'back' ? 'back' : 'front', at: Date.now(), submitted: false };
  saveAttempt(record);
  $('callout').hidden = true;
  $('doneLabel').textContent = `${currentExercise().label}: ${c.label}`;
  $('done').classList.remove('bad'); $('done').classList.add('practice');
  $('doneAutoLine').hidden = true;
  const pb = full && a.reps > 0 && (!before || a.reps > before.reps);
  $('doneVideo').textContent = (pb ? 'New personal best! ' : '') + (full ? 'Saved to your history.' : 'Stopped early: saved to your history. Only a full challenge can go on the scoreboard.');
  const offer = !!c.secs && full && a.reps > 0;
  $('submitAsk').hidden = !offer;
  $('submitYes').disabled = false;
  if (offer) {
    $('submitYes').onclick = async () => {
      $('submitYes').disabled = true;
      $('doneVideo').textContent = 'Submitting…';
      try {
        await call(`scores/${scoreKey(key, c.mode)}`, { method: 'POST', body: { reps: a.reps, noReps: a.noReps } });
        saveAttempt({ ...record, submitted: true });
        $('submitAsk').hidden = true;
        $('doneVideo').textContent = `Submitted: ${a.reps} is on the scoreboard.`;
      } catch (e) {
        $('submitYes').disabled = false;
        $('doneVideo').textContent = `Couldn't submit: ${e.message}`;
      }
    };
  }
  say(c.secs && full ? `Time! ${a.reps} ${unit}.${offer ? ' Submit your score?' : ''}` : `${a.reps} ${unit}.`);
}
if (PRACTICE) {
  practiceHome();
  loadAttempts().then((r) => { S.challengeBests = r.bests; }).catch(() => {});
}

