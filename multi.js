// Several athletes in one camera view, each with their own judge and count
// (test mode). Pure logic, no DOM, so it can be unit tested in Node.
//
// Every frame the pose model gives a list of people in no particular order.
// Everyone in view gets a track, athlete or not. Each person is matched to the
// track nearest where it was last seen, so counts stay with the right athlete
// as they move and as a hand-held camera drifts; a person nobody matches
// starts a new track. A track is only handed a body that could really be the
// same person a moment later: no further than a person can move in the time
// since (about two body heights a second), no flip between lying and standing
// within a quarter of a second, and no clearly different top. Without these,
// an athlete lost for a few frames (lying flat is hard to see) had their
// track handed to whoever was standing nearest, and came back as someone new.
//
// Burpees are done on one patch of ground, so each track also has a home
// spot: where its hips have been on average over the last few seconds. An
// athlete's track is only handed a body near their home spot, so it can't
// cling to someone walking past, and a missing athlete is looked for there.
//
// Only people who do the exercise count as athletes: a track becomes one at
// its first good rep, and any no reps before it are reported then. If an
// unfinished athlete went out of sight shortly before (the camera was moved,
// or someone walked in front), and the clothes match, the new track carries
// on that athlete's count instead of starting a new one (unless they walked
// out of the side of the picture: then they've gone). Officials
// and spectators walking or crouching never complete a rep, so they're never
// labelled or counted. People far in the background are too small to track.
// That first rep has to be one the judge can stand behind: done in one go (firstRepMs from going down to the jump: a bystander
// who bent down once and stretched a minute later isn't doing burpees, nor is anyone while the camera's being moved), and not at
// the very side of the picture (firstRepEdge: someone half out of it, or a reflection in a mirror there). Measured on a morning's
// test: real first reps took 2.4 to 2.8 s; of the six false athletes, four took 17 s to over 3 minutes and one was a reflection
// at the edge. Someone refused starts again from nothing, so a real athlete is picked up at their next rep.
// And the jump has to be read from a foot the pose model is sure of (firstRepFoot): feet hidden behind furniture are guessed, and
// the guess moving was read as a jump for someone who bent over a chair. In 86 real first reps the foot was 0.80 sure or more
// every time; in the false ones 0.32 and 0.60.
// The model sometimes finds one person twice: two poses with the shoulders
// and hips in the same places. The smaller copy is dropped. (Outlines alone
// won't do: an athlete lying at an official's feet overlaps him.)
//
// A person's outline shrinks to a third of their height when they crouch, so
// distances are measured against the tallest they've been lately (their
// scale), and a track that's already an athlete wins a close call against a
// newer one.
//
// Small people are often found on only some frames, and an official standing
// next to an athlete can be the only one found on a frame. Position alone
// would then hand him the athlete's track, so each track also remembers what
// its person is wearing: the colour of the top (sampled across the torso) and
// of the shorts, kept separately for standing and lying down, because a top
// of two colours reads differently in each. Colour counts in every match, and
// a clear mismatch in the same posture rules the match out. The colour is the
// balance of red, green and blue, which shade and sun barely change;
// brightness proved too unsteady on people this small.
//
// A top doesn't read the same standing and bent over. Under a ceiling spotlight one blue top read near grey from the front,
// standing, and blue from behind, bent over: further apart than two different people's tops. Each posture's colour is kept
// separately, but going down or getting up a body still looks like one posture while it counts as the other, so the rule
// "clearly different in the same posture: someone else" took the athlete for someone else at every burpee. A new track followed
// them through the jump, their own track's judge never saw the hands go up, and five good burpees were judged five no reps
// with nobody counted (20 November 2026). So a body is compared with both of the track's remembered looks, and the nearer one
// decides (clothesGap): someone else is unlike both.
//
// A person finder (finder.js), when the caller has one, looks for everyone
// about twice a second; anyone it sees that hasn't been found
// (unclaimedBoxes()) gets a zoomed second look of their own (boxArea()).
//
// The pose model shrinks the whole frame to a small square before looking, so
// athletes far from the camera are found on only some frames. region() gives
// the part of the frame around everyone being tracked, for the caller to zoom
// into (fromCrop() maps the results back). The zoomed view must not jump to
// the whole frame and back (the model loses people for a few frames each
// time), so new people are found by a second look, twice a second
// (wantsScan()), passed to update() as 'extra'. Athletes lined up one behind
// the other from the camera are often found as one person, so that look is
// taken with everyone already tracked painted over (drawMasks()), across the
// whole area and its left and right parts (scanAreas()): whoever is still
// found is someone new. It only adds people nobody is tracking.
//
// When someone being tracked isn't found in a frame, update() asks the
// caller to look again (lookAgain): zoomed in on where they were, with the
// people already found painted over. On a clip of three athletes in a row
// this found the two still in view together on 44 frames in 72, against 5.
//
// Cones (a camera setting, cones.js): when the athletes each do their reps
// behind a cone, setCones() gives where the cones are. Then someone only
// becomes an athlete at a rep done near a cone nobody else is using (their
// cone), so an official or someone walking past isn't counted. An athlete's
// home spot is then kept where they are behind their cone, so it moves with
// the cone if the camera drifts, and an athlete lost for a moment is looked
// for there. Until any cone has been seen, everything works as without.
//
// Someone walking past (an official, a spectator) often hides an athlete
// completely for a moment, and then the model finds only them. A track knows
// it's someone walking (moving()) when it isn't an athlete, has kept going
// over the last second and is well away from its home spot (an athlete is
// never taken for one: a burpee can look like it). Where a walker should be
// now (predicted()) is where they were plus the way they were going, so they
// keep their own track as they cross, even unseen for a moment. When a walker
// isn't found and the body handed to an athlete is where the walker should
// be, it's the walker's: the athlete's track is held (not seen) while someone
// is in front of them, so it isn't dragged off and the judge isn't fed
// someone else's moves. Someone who came walking in (an official who then
// stands in front) doesn't give way to an athlete in a close call, as a copy
// of an athlete or someone new does. When they step aside, the one left on
// the athlete's spot is the athlete, so their tracks don't swap as the two
// come apart. All of this is a camera setting (holdWalkers, off unless
// chosen), and only comes into play once someone has been seen walking:
// otherwise tracking is as it was.
import { computeMetrics } from './burpee.js';
import { PoseFilter } from './pose-filter.js';

export const MULTI_DEFAULTS = {
  maxPeople: 5,       // poses asked of the model per frame...
  maxPeopleBusy: 10,  // ...and while more than that are in view (peopleWanted)
  busyAfterMs: 1500,  // more than maxPeople seen for this long: ask for maxPeopleBusy
  crowdPeople: 4,     // this many people in view...
  crowdAfterMs: 3000, // ...for this long is a crowd: more than a live judge counts well (crowdSeen)
  quietAfterMs: 20000, // no more than maxPeople for this long: back to maxPeople
  firstRepMs: 10000,  // someone new becomes an athlete by a rep done in this long, going down to the jump...
  firstRepEdge: 0.05, // ...with their middle at least this far in from the side of the picture...
  firstRepFoot: 0.7,  // ...and the jump read from a foot the pose model is at least this sure of (0 to 1)
  minSize: 0.1,       // smaller than this fraction of the frame height: background, not a new track
  keepSize: 0.04,     // an existing track still follows its person down to this size (crouched, far off)
  sameDist: 0.2,      // shoulders and hips this close (share of body size): one person found twice
  matchDist: 1.0,     // furthest a track's person can have moved, in body heights (scale)
  moveBase: 0.35,     // ...one frame later; the reach grows by moveRate a second after that
  moveRate: 2,
  homeDist: 0.7,      // an athlete's track only takes a body this near their home spot (body heights): room for a burpee, not for walking off
  homeMs: 3000,
  followMs: 150,      // seen this recently (about a frame ago) and dressed the same: still being followed
  followColour: 0.1,       // how quickly the home spot follows them (copes with a drifting camera)
  postureMs: 250,     // within this long, a body can't swing between lying and upright...
  postureJump: 50,    // ...by more than this many degrees of torso tilt
  colourGate: 0.2,    // clothes this different, in the same posture: not the same person
  colourGateOther: 0.3, // ...compared with the other posture (only that one known yet)
  scaleMs: 10000,     // how quickly the remembered tallest size fades
  lostMs: 2000,       // unseen this long: the track pauses
  forgetMs: 2000,     // unseen this long and never an athlete: dropped (only athletes need picking up again later)
  rematchDist: 1.6,   // a paused track can be picked up again from this far
  colourWeight: 3,    // how much a colour difference counts against a match
  colourFrames: 5,    // colour samples a track needs before its colour counts
  resumeColour: 0.3,  // a new track this different in colour doesn't carry on a lost athlete
  zoomPad: 0.6,       // space kept around the people in the zoomed region (body heights)
  zoomMin: 0.3,       // smallest region, as a share of the frame height
  zoomBig: 0.3,       // people this big are found without zooming, so they don't widen the region
  scanEveryMs: 500,   // look for new people this often
  lookAgainMax: 2,    // most look-agains for missing people per frame (each costs a full pose search)
  lookEveryMs: 0,     // and for any one person, no more often than this
  claimedCover: 0.7,  // a finder box covering this much of someone found...
  claimedFill: 0.3,   // ...which their outline fills this much of, is them
  findEveryMs: 500,   // run the person finder this often (in the background)
  twinDist: 0.6,      // a new athlete this close to one already counted (body heights)...
  twinColour: 0.1,    // ...and dressed no more differently than this is a copy of them
  leftoverDist: 0.35, // a person found this close to a tracked one, despite the paint: a leftover of them
  hiVisGreen: 0.42,   // a top this green, this red and this little blue is hi-vis yellow (an official)
  hiVisRed: 0.3,
  hiVisBlue: 0.2,
  edge: 0.04,         // an athlete last seen this close to the side of the picture has walked out of it
  goneMs: 20000,      // an athlete out of sight this long has finished and gone: no more counts for them
  coneReach: 1.6,     // cones: an athlete's cone is this near where they do their reps (body heights)
  coneSide: 'left',   // ...usually on this side of them in the picture ('left', 'right' or 'any')
  coneSidePenalty: 0.5, // ...so a cone on the other side has to be this much nearer to be theirs
  coneOffMs: 9000,    // how quickly where they are behind their cone follows them
  holdWalkers: false, // the camera setting: hold an athlete while someone walks in front of them (all of the below)
  walkMs: 1000,       // someone walking: over the last this long ...
  walkSpeed: 0.6,     // ... they moved this fast (body heights a second: a burpee's hips go back and forth, a walker keeps going)
  walkAway: 0.3,      // ... and are this far from their home spot (body heights)
  holdRatio: 0.7,     // a body this much nearer where a walker (not found) should be than to an athlete: the walker's
  heldMs: 10000,      // an athlete hidden up to this long gets their spot back when whoever was in front moves aside ...
  heldMinMs: 400,     // ... once hidden at least this long (missed for a frame or two is just the model)
};

// A crowd: the person finder has kept seeing this many people or more (tiny ones in the background don't count) for this long. More
// than a live judge can follow and still keep up, so the recording is analysed in full afterwards. state: {} at first, kept by the
// caller; true while it lasts.
export function crowdSeen(state, boxes, t, aspect = 1, o = MULTI_DEFAULTS) {
  const seen = (boxes || []).filter((b) => Math.max(b.y1 - b.y0, (b.x1 - b.x0) * aspect) >= o.minSize).length;
  if (seen < o.crowdPeople) { state.since = null; return false; }
  state.since ??= t;
  return t - state.since >= o.crowdAfterMs;
}

// How many people to ask the pose model for. It follows that many at once; asking for more than are there costs nothing, but
// every extra person followed takes time on every frame, shared by everyone, so it stays at maxPeople until the person finder
// keeps seeing more than that (boxes: what it saw, shares of the frame; tiny ones in the background don't count), then goes to
// maxPeopleBusy, and comes back once they've gone. state: {} at first, kept by the caller.
export function peopleWanted(state, boxes, t, aspect = 1, o = MULTI_DEFAULTS) {
  const seen = (boxes || []).filter((b) => Math.max(b.y1 - b.y0, (b.x1 - b.x0) * aspect) >= o.minSize).length;
  state.cap ??= o.maxPeople;
  const busy = state.cap > o.maxPeople, wantsChange = busy ? seen <= o.maxPeople : seen > o.maxPeople;
  if (!wantsChange) { state.since = null; return state.cap; }
  state.since ??= t;
  if (t - state.since >= (busy ? o.quietAfterMs : o.busyAfterMs)) { state.cap = busy ? o.maxPeople : o.maxPeopleBusy; state.since = null; }
  return state.cap;
}

// When a frame arrived, on a steady clock: what the saved skeletons are timed by. Frames come over a phone's connection in bunches
// but were filmed evenly, so the time is read off a steady line through the arrivals. Returns a function of (got: when the frame
// reached this machine, ms on its clock; rtp: the frame's own timestamp, 90,000 a second, or null if the browser doesn't say;
// mono: a clock that never jumps, ms) giving the time to stamp it with. A frame's own timestamp says how long after the line's
// start it was filmed. One arriving sooner than the line says moves the line (it was running late); the line creeps later by
// itself (2 ms a second at most) to follow a phone whose clock runs slow; a timestamp that makes no sense (a new connection)
// starts it again.
export function arrivalClock() {
  const line = { wall: 0, rtp: 0, at: 0 };
  return (got, rtp, mono) => {
    if (rtp == null) return Math.round(got);
    const est = line.wall + ((rtp - line.rtp) | 0) / 90;
    if (!line.wall || est > got || got - est > 2000) { line.wall = got; line.rtp = rtp; line.at = mono; return Math.round(got); }
    line.wall += Math.min(got - est, (mono - line.at) * 0.002); line.at = mono;
    return Math.round(line.wall + ((rtp - line.rtp) | 0) / 90);
  };
}

// What to draw at time `due` between two of the judge's snapshots: a ({ at, snap }, the one showing) moved part of the way to b
// (the next, or nothing yet). Each person (matched by their track's id) and a lone athlete's points are moved; counts, labels and
// anyone not in both stay as in a. Snapshots more than maxGap ms apart aren't one movement: a as it is.
export function blendSnaps(a, b, due, maxGap = 400) {
  const gap = b ? b.at - a.at : 0;
  if (!(gap > 0) || gap > maxGap) return a.snap;
  const m = Math.max(0, Math.min(1, (due - a.at) / gap)), s = a.snap, n = b.snap;
  if (!m) return s;
  const points = (la, lb) => la.map((p, i) => (lb[i] ? { ...p, x: p.x + (lb[i].x - p.x) * m, y: p.y + (lb[i].y - p.y) * m } : p));
  const box = (x, y) => (x && y ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'number' && typeof y[k] === 'number' ? v + (y[k] - v) * m : v])) : x);
  if (s.tracks && n.tracks) {
    const next = new Map(n.tracks.filter((k) => k.id != null).map((k) => [k.id, k]));
    return { ...s, tracks: s.tracks.map((k) => { const o = next.get(k.id); return o ? { ...k, lm: points(k.lm, o.lm), box: box(k.box, o.box) } : k; }) };
  }
  return s.lm && n.lm ? { ...s, lm: points(s.lm, n.lm) } : s;
}

// Where to take the look for new people: the area being watched (r, as
// shares of the frame), and its left and right 60% (a person standing beside
// another fills more of a narrower view).
export function scanAreas(r) {
  return [r, { ...r, w: r.w * 0.6 }, { ...r, x: r.x + r.w * 0.4, w: r.w * 0.6 }];
}

// People the person finder saw that nobody has been found as yet: its boxes
// (shares of the frame) that don't match the outline of anyone in found
// (landmark lists). A box is someone found when it covers most of their
// outline and their outline fills a fair part of it (finder boxes have a
// margin round the body); a second athlete half hidden behind another fails
// one or the other.
// Tiny boxes (far in the background) are left out. Biggest first.
export function unclaimedBoxes(boxes, found, aspect = 1, o = MULTI_DEFAULTS) {
  const outline = (lm) => {
    const pts = lm.filter((p) => (p.visibility ?? 1) >= 0.5);
    return pts.length < 4 ? null : { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
  };
  const area = (q) => Math.max(1e-6, (q.x1 - q.x0) * (q.y1 - q.y0));
  const claims = (b, q) => {
    const w = Math.min(b.x1, q.x1) - Math.max(b.x0, q.x0), h = Math.min(b.y1, q.y1) - Math.max(b.y0, q.y0);
    if (w <= 0 || h <= 0) return false;
    return (w * h) / area(q) > o.claimedCover && (w * h) / area(b) > o.claimedFill;
  };
  const size = (b) => Math.max(b.y1 - b.y0, (b.x1 - b.x0) * aspect);
  const outlines = found.map(outline).filter(Boolean);
  return boxes.filter((b) => size(b) >= o.minSize && !outlines.some((q) => claims(b, q)))
    .sort((a, b) => size(b) - size(a));
}

// The picture in parts for the person finder, as shares of the frame: squares as big as the picture's short side, each half over the
// next, so everyone is whole in at least one and is seen at close to the picture's own detail. The finder shrinks whatever it's given
// to 640 pixels: a wide picture of ten people leaves each about 50 pixels tall, too small for it to find. A picture that's nearly
// square already has no parts. fine: squares half that size as well, which the finder sees at twice the picture's own size (on
// a 720p picture of 8 to 12 athletes about 100 pixels tall it found 0.6 of them a frame in the whole picture, 4.7 in the parts
// and 10.2 with the smaller ones too, 20 November 2026); many more searches, so only for a video analysed after the event.
export function finderTiles(aspect = 1, { fine = false } = {}) {
  const wide = aspect >= 1, side = wide ? 1 / aspect : aspect; // the square's size along the long side
  const spread = (size) => { const n = Math.ceil((1 - size) / (size / 2) - 1e-9); return n < 1 ? [0] : Array.from({ length: n + 1 }, (_, i) => (i * (1 - size)) / n); };
  const out = side > 0.8 ? [] : spread(side).map((at) => (wide ? { x: at, y: 0, w: side, h: 1 } : { x: 0, y: at, w: 1, h: side }));
  if (fine) for (const across of spread(0.5)) for (const along of spread(side / 2)) out.push(wide ? { x: along, y: across, w: side / 2, h: 0.5 } : { x: across, y: along, w: 0.5, h: side / 2 });
  return out;
}

// What the finder saw in several overlapping parts of the picture, as one list: a person seen in two parts is kept once (the surer
// sighting), and a box cut off by the edge of its part (part: the { x, y, w, h } it was found in) goes when a whole one covers it.
// Surest first.
export function mergeBoxes(list, o = {}) {
  const sameIou = o.sameIou ?? 0.5, cover = o.cover ?? 0.6, edge = o.edge ?? 0.012;
  const area = (b) => Math.max(1e-9, (b.x1 - b.x0) * (b.y1 - b.y0));
  const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  // cut off: touching an edge of its part that isn't the edge of the picture
  const cut = (b) => { const p = b.part; if (!p) return false;
    return (p.x > edge && b.x0 - p.x < edge) || (p.x + p.w < 1 - edge && p.x + p.w - b.x1 < edge) || (p.y > edge && b.y0 - p.y < edge) || (p.y + p.h < 1 - edge && p.y + p.h - b.y1 < edge); };
  const all = list.map((b) => ({ ...b, cut: cut(b) })).sort((a, b) => a.cut - b.cut || b.score - a.score);
  const kept = [];
  for (const b of all) {
    const dup = kept.some((k) => { const i = inter(b, k); return i / (area(b) + area(k) - i) > sameIou || (b.cut && i / area(b) > cover); });
    if (!dup) kept.push(b);
  }
  return kept.map(({ part, cut: c, ...b }) => b).sort((a, b) => b.score - a.score);
}

// The part of the frame to zoom in on for a person the finder saw: their box
// with a quarter of its size spare on each side, at least zoomMin tall.
export function boxArea(b, o = MULTI_DEFAULTS) {
  const pw = (b.x1 - b.x0) * 0.25, ph = (b.y1 - b.y0) * 0.25;
  let x0 = b.x0 - pw, x1 = b.x1 + pw, y0 = b.y0 - ph, y1 = b.y1 + ph;
  if (y1 - y0 < o.zoomMin) { const m = (y0 + y1) / 2; y0 = m - o.zoomMin / 2; y1 = m + o.zoomMin / 2; }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Several sets of results as one.
export function joinResults(list) {
  const ok = list.filter((r) => r?.landmarks?.length);
  return { landmarks: ok.flatMap((r) => r.landmarks), worldLandmarks: ok.flatMap((r) => r.worldLandmarks || r.landmarks.map(() => null)) };
}

// Results found in a zoomed part of the frame, mapped back to the whole frame.
// crop: {x, y, w, h} as shares of the frame.
export function fromCrop(res, crop) {
  if (!crop || !res) return res;
  const map = (lm) => lm.map((p) => ({ ...p, x: crop.x + p.x * crop.w, y: crop.y + p.y * crop.h }));
  return { ...res, landmarks: (res.landmarks || []).map(map) };
}


// What a person is wearing: { top, shorts }, each the [red, green] share of
// r+g+b, from the median of several points (shorts null when the thighs
// aren't seen). The top is sampled down the middle of the torso and, when both
// sides are seen, across it. sample(x, y) gives [r, g, b] 0-255 at a point in
// the frame (0-1 coordinates), or null.
export function clothesColour(lm, sample, minVis = 0.3) {
  if (!sample) return null;
  const seen = (i) => lm[i] && (lm[i].visibility ?? 1) >= minVis;
  const mid = (ids) => {
    const pts = ids.filter(seen).map((i) => lm[i]);
    return pts.length ? { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length } : null;
  };
  const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
  const balance = (pts) => {
    const px = pts.map((p) => sample(p.x, p.y)).filter(Boolean);
    if (px.length < 3) return null;
    const median = (c) => px.map((p) => p[c]).sort((a, b) => a - b)[px.length >> 1];
    const [r, g, b] = [0, 1, 2].map(median);
    const sum = r + g + b + 1;
    return [r / sum, g / sum];
  };
  const sh = mid([11, 12]), hip = mid([23, 24]);
  if (!sh || !hip) return null;
  const topPts = [0.3, 0.5, 0.7].map((k) => lerp(sh, hip, k));
  if (seen(11) && seen(12) && seen(23) && seen(24)) {
    for (const k of [0.4, 0.65]) {
      const l = lerp(lm[11], lm[23], k), r = lerp(lm[12], lm[24], k);
      topPts.push(lerp(l, r, 0.3), lerp(l, r, 0.7));
    }
  }
  const top = balance(topPts);
  if (!top) return null;
  const knee = mid([25, 26]);
  const shortsPts = knee ? [0.15, 0.3].map((k) => lerp(hip, knee, k)) : [];
  for (const [h, k] of [[23, 25], [24, 26]]) if (seen(h) && seen(k)) shortsPts.push(lerp(lm[h], lm[k], 0.25));
  return { top, shorts: balance(shortsPts) };
}
const colourDist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
// How different two sets of clothes are: the top, with the shorts counting
// half as much again when both are known.
const clothesDist = (a, b) => (a.shorts && b.shorts
  ? (colourDist(a.top, b.top) + 0.5 * colourDist(a.shorts, b.shorts)) / 1.5
  : colourDist(a.top, b.top));
// A hi-vis yellow top (officials' vests): lots of red and green, little blue.
function hiVis(k, o) {
  return ['up', 'down'].some((pos) => {
    const c = k.colours[pos];
    if (!c || c.n < 3) return false;
    const [r, g] = c.top;
    return g >= o.hiVisGreen && r >= o.hiVisRed && 1 - r - g <= o.hiVisBlue;
  });
}
const posture = (box) => (box.tilt == null ? null : box.tilt < 45 ? 'up' : 'down');
// How different person p's clothes are from what track k remembers, and
// whether that's in the same posture: { d, same }, or null if k doesn't know
// yet.
function clothesGap(p, k, o) {
  if (!p.colour) return null;
  const pos = posture(p.box);
  const known = (c) => c && c.n >= o.colourFrames;
  const same = pos ? k.colours[pos] : null, others = [k.colours.up, k.colours.down].filter((c) => c !== same && known(c));
  // The nearer of what they've looked like standing and lying decides. How a top reads depends on the light on it as much as on
  // the posture (see the top of the file), and going down or getting up it still looks like one while counting as the other.
  if (known(same)) return { d: Math.min(clothesDist(p.colour, same), ...others.map((c) => clothesDist(p.colour, c))), same: true };
  return others.length ? { d: clothesDist(p.colour, others[0]), same: false } : null;
}
// Remember what track k's person wears in this posture (a running average).
function learnClothes(k, p) {
  const pos = posture(p.box);
  if (!p.colour || !pos) return;
  const c = k.colours[pos];
  if (!c) { k.colours[pos] = { top: p.colour.top, shorts: p.colour.shorts, n: 1 }; return; }
  const ease = (v, nv) => (v && nv ? v.map((x, i) => x + (nv[i] - x) * 0.15) : v ?? nv);
  c.top = ease(c.top, p.colour.top);
  c.shorts = ease(c.shorts, p.colour.shorts);
  c.n++;
}

// Paint people over on a canvas showing part of the frame (crop, as shares
// of the frame), so a second look finds whoever they were hiding. poses are
// landmark lists in whole-frame coordinates.
const MASK_BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];
export function drawMasks(ctx, poses, crop, W, H, colour = 'rgb(128,110,90)') {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = colour;
  ctx.lineCap = 'round';
  for (const lm of poses) {
    const px = (p) => [((p.x - crop.x) / crop.w) * W, ((p.y - crop.y) / crop.h) * H];
    const ys = lm.map((p) => p.y);
    ctx.lineWidth = Math.max(4, ((Math.max(...ys) - Math.min(...ys)) / crop.h) * H * 0.22);
    ctx.beginPath();
    for (const [a, b] of MASK_BONES) { ctx.moveTo(...px(lm[a])); ctx.lineTo(...px(lm[b])); }
    ctx.stroke();
  }
  ctx.restore();
}

// Where a person is in the frame, from the points the model is sure of.
// aspect = frame width / height, so distances are the same across and down.
export function personBox(lm, aspect = 1, minVis = 0.5) {
  const pts = lm.filter((p) => (p.visibility ?? 1) >= minVis);
  if (pts.length < 4) return null;
  const xs = pts.map((p) => p.x * aspect), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  // Centre on the hips when seen: they move least through a burpee.
  const hips = [lm[23], lm[24]].filter((p) => p && (p.visibility ?? 1) >= minVis);
  const cx = hips.length ? hips.reduce((s, p) => s + p.x * aspect, 0) / hips.length : (x0 + x1) / 2;
  const cy = hips.length ? hips.reduce((s, p) => s + p.y, 0) / hips.length : (y0 + y1) / 2;
  // Torso tilt in the picture: 0 upright, 90 lying flat.
  const mid = (a, b) => (lm[a] && lm[b] && (lm[a].visibility ?? 1) >= minVis && (lm[b].visibility ?? 1) >= minVis
    ? { x: ((lm[a].x + lm[b].x) / 2) * aspect, y: (lm[a].y + lm[b].y) / 2 } : null);
  const sh = mid(11, 12), hp = mid(23, 24);
  const tilt = sh && hp ? (Math.atan2(Math.abs(sh.x - hp.x), Math.abs(sh.y - hp.y)) * 180) / Math.PI : null;
  return { cx, cy, size: Math.max(x1 - x0, y1 - y0), top: y0, bottom: y1, x: (x0 + x1) / 2 / aspect, left: x0 / aspect, right: x1 / aspect, tilt };
}

// How far apart two poses' shoulders and hips are, as a share of the bigger
// body: near 0 for one person found twice.
const TORSO = [11, 12, 23, 24];
function torsoDist(a, b, aspect) {
  const d = TORSO.map((i) => Math.hypot((a.lm[i].x - b.lm[i].x) * aspect, a.lm[i].y - b.lm[i].y)).sort((x, y) => x - y);
  return (d[1] + d[2]) / 2 / Math.max(a.box.size, b.box.size); // middle two: one bad point doesn't decide
}

export class MultiTracker {
  // make(): a new judge for one athlete. tracking: PoseFilter options.
  // metricOpts(): computeMetrics options.
  constructor({ make, tracking, metricOpts, opts = {} }) {
    this.o = { ...MULTI_DEFAULTS, ...opts };
    this.make = make;
    this.tracking = tracking;
    this.metricOpts = metricOpts;
    this.tracks = [];
    this.nextId = 1;
    this.nextLabel = 1;
    this.zoom = null;      // current region, eased towards where people are
    this.scanAt = -Infinity;
  }

  // True when it's time for a look at the whole frame for new people (only
  // needed while region() is zoomed in).
  wantsScan(t) {
    if (!this.zoom || t - this.scanAt < this.o.scanEveryMs) return false;
    this.scanAt = t;
    return true;
  }

  // The part of the frame to look at next, {x, y, w, h} as shares of the
  // frame, or null for the whole frame (nobody being tracked).
  region(t, aspect = 1) {
    const o = this.o;
    // Small people only: someone big (an official right by the camera) is
    // found anyway, and including them would undo the zoom for everyone else.
    const recent = this.tracks.filter((k) => t - k.seenAt < o.lostMs && k.scale < o.zoomBig);
    if (!recent.length) { this.zoom = null; return null; }
    const pad = Math.max(...recent.map((k) => k.scale)) * o.zoomPad;
    let x0 = Math.min(...recent.map((k) => k.box.left)) - pad / aspect, x1 = Math.max(...recent.map((k) => k.box.right)) + pad / aspect;
    let y0 = Math.min(...recent.map((k) => k.box.top)) - pad, y1 = Math.max(...recent.map((k) => k.box.bottom)) + pad;
    const grow = (a, b, min) => { const m = (a + b) / 2, half = Math.max((b - a) / 2, min / 2); return [m - half, m + half]; };
    [y0, y1] = grow(y0, y1, o.zoomMin);
    [x0, x1] = grow(x0, x1, o.zoomMin / aspect);
    const want = { x0: Math.max(0, x0), x1: Math.min(1, x1), y0: Math.max(0, y0), y1: Math.min(1, y1) };
    // Widen at once (nobody gets cut off); narrow gradually.
    const z = this.zoom ?? want;
    const ease = (cur, tgt, wider) => (wider ? tgt : cur + (tgt - cur) * 0.1);
    this.zoom = {
      x0: ease(z.x0, want.x0, want.x0 < z.x0), x1: ease(z.x1, want.x1, want.x1 > z.x1),
      y0: ease(z.y0, want.y0, want.y0 < z.y0), y1: ease(z.y1, want.y1, want.y1 > z.y1),
    };
    const r = this.zoom;
    return { x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 };
  }

  // The cones on the ground (cones.js: { id, x, y, number }, shares of the picture), in the tracker's units. Any
  // athlete without a cone yet gets the nearest free one.
  setCones(cones, aspect = 1) {
    this.cones = cones.map((c) => ({ id: c.id, cx: c.x * aspect, cy: c.y, number: c.number || null }));
    for (const a of this.athletes) {
      if (a.cone != null || a.gone || a.judge.done) continue;
      const c = this._coneFor(a); if (c) this._takeCone(a, c);
    }
  }
  // athlete k's cone, if they have one and it's still there
  coneOf(k) { return k.cone != null ? (this.cones || []).find((c) => c.id === k.cone) ?? null : null; }
  // Where athlete k does their reps: behind their cone when they have one, else their home spot.
  _anchor(k) { const c = this.coneOf(k); return c && k.coneOff ? { cx: c.cx + k.coneOff.dx, cy: c.cy + k.coneOff.dy } : k.home; }
  // The free cone nearest track k (another athlete still going holds theirs), preferring the usual side; null: none near.
  _coneFor(k) {
    const o = this.o, held = new Set(this.athletes.filter((a) => a !== k && !a.gone && !a.merged && !a.judge.done && a.cone != null).map((a) => a.cone));
    let best = null, bestD = Infinity;
    for (const c of this.cones || []) {
      if (held.has(c.id)) continue;
      let d = Math.hypot(c.cx - k.home.cx, c.cy - k.home.cy) / Math.max(k.scale, 1e-3);
      if (d > o.coneReach) continue;
      if ((o.coneSide === 'left' && c.cx > k.home.cx) || (o.coneSide === 'right' && c.cx < k.home.cx)) d += o.coneSidePenalty;
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }
  // Track k is someone walking (never an athlete: a burpee can look like it): seen lately, kept going over the last
  // second, well away from their home spot.
  _moving(k, t) {
    const o = this.o, tr = k.trail;
    if (!o.holdWalkers || k.label != null || !tr || tr.length < 3 || t - k.seenAt > o.walkMs) return false;
    const a = tr[0], b = tr[tr.length - 1], dt = b.t - a.t;
    if (dt < o.walkMs * 0.4) return false;
    const scale = Math.max(k.scale, 1e-3);
    return (Math.hypot(b.cx - a.cx, b.cy - a.cy) / scale) * (1000 / dt) >= o.walkSpeed
      && Math.hypot(k.box.cx - k.home.cx, k.box.cy - k.home.cy) / scale >= o.walkAway;
  }
  // Where track k's person should be now: where they were, plus the way they were going if they're walking.
  _predicted(k, t) {
    if (!this._moving(k, t)) return k.box;
    const tr = k.trail, a = tr[0], b = tr[tr.length - 1], ahead = Math.min(t - k.seenAt, this.o.walkMs) / (b.t - a.t);
    return { cx: k.box.cx + (b.cx - a.cx) * ahead, cy: k.box.cy + (b.cy - a.cy) * ahead };
  }
  _takeCone(k, c) { k.cone = c.id; k.coneOff = { dx: k.home.cx - c.cx, dy: k.home.cy - c.cy }; }

  // Athletes in the order they started.
  get athletes() { return this.tracks.filter((k) => k.label != null).sort((a, b) => a.label - b.label); }

  // res: PoseLandmarker result. sample(x, y): the frame's colour at a point
  // (see clothesColour), or null to match on position alone. extra: results
  // of a look at the whole frame (see wantsScan), for new people only.
  // Returns events as [{track, ev}].
  // lookAgain(k, poses): the caller's second look for missing track k, with
  // poses (whole-frame landmark lists) painted over; returns results in
  // whole-frame coordinates, or null.
  update(res, t, aspect = 1, sample = null, extra = null, lookAgain = null) {
    const o = this.o;
    const read = (r) => (r?.landmarks || []).map((lm, i) => ({ lm, wlm: r.worldLandmarks?.[i], box: personBox(lm, aspect), colour: clothesColour(lm, sample) }))
      .filter((p) => p.box && p.box.size >= o.keepSize);
    const close = (p, box, scale) => Math.hypot(p.box.cx - box.cx, p.box.cy - box.cy) < o.leftoverDist * Math.max(scale, p.box.size);
    // A leftover of person q: found right on top of them and not clearly
    // dressed differently (someone else standing that close usually is).
    const leftover = (p, q) => close(p, q.box, q.box.size) && !(p.colour && q.colour && clothesDist(p.colour, q.colour) > o.twinColour);
    // Out of sight for goneMs: finished and gone. Their count stands, but
    // nobody is matched to them or carries it on.
    for (const k of this.tracks) if (k.label != null && !k.gone && t - k.seenAt > o.goneMs) k.gone = true;
    const tracked = this.tracks.filter((k) => t - k.seenAt < o.lostMs);
    const people = read(res)
      .sort((a, b) => b.box.size - a.box.size)
      .filter((p, i, all) => !all.slice(0, i).some((q) => torsoDist(p, q, aspect) < o.sameDist));
    for (const p of read(extra)) {
      if (!tracked.some((k) => close(p, k.box, k.scale)) && !people.some((q) => close(p, q.box, q.box.size))) people.push(p);
    }

    // How well person p fits track k (lower is better), or null if p can't
    // be k's person.
    const leftView = (k) => this._leftView(k);
    // everyone walking, and where they should be now
    const walkers = this.tracks.filter((w) => !w.merged && !w.gone && this._moving(w, t)).map((w) => ({ w, at: this._predicted(w, t) }));
    for (const { w } of walkers) w.walked = true; // came walking in: not a copy of an athlete
    const fit = (p, k) => {
      if (k.gone) return null;
      const gone = t - k.seenAt;
      if (gone > o.lostMs && k.label == null) return null; // only athletes are picked up again after a gap
      // Someone who walked out of the side of the picture can only be picked
      // up again where they left.
      const reach = gone <= o.lostMs ? Math.min(o.matchDist, o.moveBase + (o.moveRate * gone) / 1000)
        : leftView(k) ? o.moveBase : o.rematchDist;
      const size = Math.max(k.scale, p.box.size);
      // After a gap, an athlete is looked for round their home spot.
      const home = k.label != null ? this._anchor(k) : k.home;
      const ref = gone > o.lostMs && k.label != null ? home : this._predicted(k, t);
      const d = Math.hypot(p.box.cx - ref.cx, p.box.cy - ref.cy) / size;
      if (d > reach) return null;
      if (gone < o.postureMs && p.box.tilt != null && k.box.tilt != null && Math.abs(p.box.tilt - k.box.tilt) > o.postureJump) return null;
      const gap = clothesGap(p, k, o);
      // An athlete followed frame to frame in matching clothes can go anywhere
      // (walking off at the end, say); picked up after losing them, or with
      // clothes that don't clearly match, only near their home spot.
      const following = gone <= o.followMs && gap && gap.same && gap.d <= o.followColour;
      if (k.label != null && !following && Math.hypot(p.box.cx - home.cx, p.box.cy - home.cy) / size > o.homeDist) return null;
      if (gap && gap.d > (gap.same ? o.colourGate : o.colourGateOther)) return null;
      return d + (gap?.d ?? 0) * o.colourWeight + (gone > o.lostMs ? 0.5 : 0) + (k.label == null && !k.walked ? 0.3 : 0);
    };

    // Someone who walked in was in front of an athlete and now steps aside: of the people on the athlete's spot, the one
    // nearest it is the athlete (they stay put, the other came and goes). Only with two or more there (one alone could
    // be either), with whoever walked in among them, and not where another athlete works close by.
    const usedP = new Set(), usedK = new Set();
    const seen = new Map();
    const going = this.tracks.filter((a) => a.label != null && !a.gone && !a.merged && !a.judge.done);
    for (const a of going) {
      if (t - a.seenAt < o.heldMinMs || t - a.seenAt > o.heldMs) continue;
      const at = this._anchor(a);
      if (going.some((b) => b !== a && Math.hypot(this._anchor(b).cx - at.cx, this._anchor(b).cy - at.cy) < 2 * o.homeDist * Math.max(a.scale, b.scale))) continue;
      if (!this.tracks.some((w) => w.walked && w.label == null && !w.merged && t - w.seenAt <= o.walkMs && Math.hypot(w.box.cx - at.cx, w.box.cy - at.cy) < 2 * o.homeDist * a.scale)) continue;
      const near = people.map((p, pi) => ({ pi, d: Math.hypot(p.box.cx - at.cx, p.box.cy - at.cy) }))
        .filter((x) => !usedP.has(x.pi) && x.d < o.homeDist * a.scale).sort((x, y) => x.d - y.d);
      if (near.length < 2 || fit(people[near[0].pi], a) == null) continue;
      usedP.add(near[0].pi); usedK.add(a); seen.set(a, people[near[0].pi]);
    }
    // Greedy matching, closest pair first.
    const pairs = [];
    for (const [pi, p] of people.entries()) {
      for (const k of this.tracks) {
        const d = fit(p, k);
        if (d != null) pairs.push({ pi, k, d });
      }
    }
    pairs.sort((a, b) => a.d - b.d);
    for (const { pi, k } of pairs) {
      if (usedP.has(pi) || usedK.has(k)) continue;
      usedP.add(pi); usedK.add(k);
      seen.set(k, people[pi]);
    }
    // Someone walking past wasn't found, but the body handed to an athlete is where they should be by now: it's
    // theirs. The athlete is in there behind them, held until they're found again.
    for (const { w, at } of walkers) {
      if (seen.has(w)) continue;
      for (const [k, p] of seen) {
        if (k.label == null || walkers.some((x) => x.w === k)) continue;
        const dk = Math.hypot(p.box.cx - k.box.cx, p.box.cy - k.box.cy), dw = Math.hypot(p.box.cx - at.cx, p.box.cy - at.cy);
        if (dw <= o.holdRatio * dk && fit(p, w) != null) { seen.delete(k); seen.set(w, p); break; }
      }
    }
    // Look again for people tracked a moment ago but not found this frame,
    // athletes first, with everyone found painted over.
    if (lookAgain) {
      const missing = tracked.filter((k) => !seen.has(k) && !k.merged && t - (k.lookAt ?? -Infinity) >= o.lookEveryMs)
        .sort((a, b) => (b.label != null) - (a.label != null) || b.seenAt - a.seenAt)
        .slice(0, o.lookAgainMax);
      for (const k of missing) {
        k.lookAt = t;
        const found = read(lookAgain(k, [...seen.values()].map((p) => p.lm)))
          // not a leftover of someone already found (painted over, but not quite all)
          .filter((p) => !people.some((q) => torsoDist(p, q, aspect) < o.sameDist || leftover(p, q)))
          .map((p) => ({ p, d: fit(p, k) }))
          .filter((x) => x.d != null)
          .sort((a, b) => a.d - b.d)[0];
        if (!found) continue;
        people.push(found.p);
        usedP.add(people.length - 1);
        seen.set(k, found.p);
      }
    }
    // A track started in the last second that nobody matched this frame,
    // sitting on top of one that was matched, is the same person tracked
    // twice: the new copy goes.
    for (const k of this.tracks) {
      if (seen.has(k) || k.label != null || t - k.bornAt > 1000) continue;
      if ([...seen.keys()].some((m) => m !== k && Math.hypot(m.box.cx - k.box.cx, m.box.cy - k.box.cy) < 0.5 * Math.max(m.scale, k.scale))) k.merged = true;
    }
    for (const [pi, p] of people.entries()) {
      if (usedP.has(pi) || p.box.size < o.minSize) continue;
      const k = { id: this.nextId++, label: null, box: p.box, scale: p.box.size, colours: {}, home: { cx: p.box.cx, cy: p.box.cy }, seenAt: t, bornAt: t, filter: new PoseFilter(this.tracking), judge: this.make(), pose: null, metrics: null, early: [] };
      this.tracks.push(k);
      seen.set(k, p);
    }

    const events = [];
    for (const k of this.tracks) {
      if (k.merged) continue;
      const p = seen.get(k);
      if (p) {
        k.scale = Math.max(p.box.size, k.scale * Math.exp(-(t - k.seenAt) / o.scaleMs));
        const ease = 1 - Math.exp(-Math.max(0, t - k.seenAt) / o.homeMs);
        k.home = { cx: k.home.cx + (p.box.cx - k.home.cx) * ease, cy: k.home.cy + (p.box.cy - k.home.cy) * ease };
        // where they are behind their cone settles slowly too
        const cone = this.coneOf(k);
        if (cone && k.coneOff) {
          const e = 1 - Math.exp(-Math.max(0, t - k.seenAt) / o.coneOffMs);
          k.coneOff = { dx: k.coneOff.dx + (k.home.cx - cone.cx - k.coneOff.dx) * e, dy: k.coneOff.dy + (k.home.cy - cone.cy - k.coneOff.dy) * e };
        }
        k.box = p.box;
        k.seenAt = t;
        (k.trail ??= []).push({ t, cx: p.box.cx, cy: p.box.cy });
        while (k.trail.length > 2 && t - k.trail[0].t > o.walkMs) k.trail.shift();
        learnClothes(k, p);
      }
      k.pose = k.filter.update(p ? { lm: p.lm, wlm: p.wlm } : null, t);
      k.metrics = k.pose ? computeMetrics(k.pose.lm, k.pose.wlm, this.metricOpts()) : null;
      const ev = k.judge.update(k.metrics, t);
      if (ev && k.label == null) {
        k.early.push(ev);
        if (ev.type !== 'rep') continue;
        // Officials wear hi-vis: someone in a hi-vis top is never counted
        // (with the camera on its side, an official standing up can look like
        // a burpee).
        if (hiVis(k, o)) { k.early = []; continue; }
        // A copy of an athlete already counted (a second look found a leftover
        // of them): right on top of them and dressed the same. Dropped.
        if (this._twinOf(k, t)) { k.merged = true; continue; }
        const lost = this._lostAthlete(k, t);
        if (lost) this._carryOn(k, lost);
        else {
          // Someone new: only by a rep done in one go, in the picture. Anyone else starts again from nothing.
          if (!this._firstRepOk(k, ev)) { k.early = []; k.judge = this.make(); continue; }
          // With cones out, only someone doing reps at a free cone is an athlete: anyone else starts again from nothing.
          if (this.cones?.length) {
            const c = this._coneFor(k);
            if (!c) { k.early = []; k.judge = this.make(); continue; }
            this._takeCone(k, c);
          }
          k.label = this.nextLabel++;
        }
        for (const e of k.early) events.push({ track: k, ev: e });
        if (ev.type === 'rep') Object.assign(ev, { count: k.judge.count, done: k.judge.done });
        k.early = [];
      } else if (ev) events.push({ track: k, ev });
    }
    this.tracks = this.tracks.filter((k) => !k.merged && (k.label != null || t - k.seenAt < o.forgetMs));
    return events;
  }

  // A first rep the judge can stand behind: quick enough from going down to the jump, and not at the very side of the picture.
  _firstRepOk(k, ev) {
    const o = this.o, d = ev.detail;
    if (d && d.downAt != null && d.endAt != null && d.endAt - d.downAt > o.firstRepMs) return false;
    if (d && d.jumpSure != null && d.jumpSure < o.firstRepFoot) return false;
    return !(k.box.x < o.firstRepEdge || k.box.x > 1 - o.firstRepEdge);
  }

  // The unfinished athlete, out of sight for a while, that new track k most
  // likely is: k turned up on their home spot, k first appeared after they went missing (someone seen
  // alongside them is someone else), clothes matching where both are known,
  // most recently seen.
  _lostAthlete(k, t) {
    const o = this.o;
    return this.athletes
      .filter((a) => !a.judge.done && t - a.seenAt > o.lostMs && !a.gone && k.bornAt >= a.seenAt - 300 && (a.reoriented || (!this._leftView(a) &&
        Math.hypot(k.box.cx - this._anchor(a).cx, k.box.cy - this._anchor(a).cy) < o.homeDist * Math.max(a.scale, k.scale))))
      .filter((a) => !['up', 'down'].some((pos) => a.colours[pos]?.n >= o.colourFrames && k.colours[pos]?.n >= o.colourFrames &&
        clothesDist(a.colours[pos], k.colours[pos]) > o.resumeColour))
      .sort((a, b) => (a.reoriented && b.reoriented ? this._likeness(k, a) - this._likeness(k, b) : b.seenAt - a.seenAt))[0] ?? null;
  }

  // After the picture turned: how unlike athlete a new track k is (clothes where known, else left-to-right place).
  _likeness(k, a) {
    const pos = ['up', 'down'].filter((p) => a.colours[p]?.n >= this.o.colourFrames && k.colours[p]?.n >= this.o.colourFrames);
    return pos.length ? pos.reduce((s, p) => s + clothesDist(a.colours[p], k.colours[p]), 0) / pos.length : Math.abs(a.box.cx - k.box.cx);
  }

  // Last seen at the side of the picture: walked out of it.
  _leftView(a) { return a.box.left < this.o.edge || a.box.right > 1 - this.o.edge; }

  // An athlete in view that new track k sits on top of, dressed the same.
  _twinOf(k, t) {
    const o = this.o;
    return this.athletes.find((a) => !a.merged && t - a.seenAt < 500 &&
      Math.hypot(a.box.cx - k.box.cx, a.box.cy - k.box.cy) < o.twinDist * Math.max(a.scale, k.scale) &&
      !['up', 'down'].some((pos) => a.colours[pos]?.n >= 3 && k.colours[pos]?.n >= 3 && clothesDist(a.colours[pos], k.colours[pos]) > o.twinColour)) ?? null;
  }

  // The picture turned (a phone rotated from portrait to landscape or back): where everyone is no longer means
  // anything. Every athlete counts as out of sight from now, without a home spot; the next person to do a rep
  // carries on the athlete whose clothes match best (or, not known, who was in the same place left to right).
  reorient(t) {
    this.zoom = null;
    for (const a of this.athletes) { a.reoriented = true; a.seenAt = Math.min(a.seenAt, t - this.o.lostMs - 1); }
    this.tracks = this.tracks.filter((k) => k.label != null);
  }

  // Track k carries on athlete a: a's label, count, no reps and history.
  _carryOn(k, a) {
    const j = k.judge, old = a.judge;
    j.count += old.count;
    j.noReps += old.noReps;
    for (const [r, n] of Object.entries(old.reasonCounts || {})) j.reasonCounts[r] = (j.reasonCounts[r] || 0) + n;
    j.done = j.count >= j.o.targetReps;
    k.label = a.label;
    k.events = a.events; // the caller's record of a's reps, if it keeps one
    if (a.bib && !k.bib) { k.bib = a.bib; k.bibConf = a.bibConf; k.bibFrom = a.bibFrom; } // and their race number, once read
    if (a.cone != null) { k.cone = a.cone; k.coneOff = a.coneOff; } // and their cone
    if (a.picSize) { k.picSize = a.picSize; k.picAt = a.picAt; } // (the review's picture of them)
    k.reported = a.reported;
    if (a.proof?.length) k.proof = [...a.proof, ...(k.proof ?? [])]; // (what hasn't reached the review yet)
    if (a.proofEvents?.length) k.proofEvents = [...a.proofEvents, ...(k.proofEvents ?? [])];
    a.merged = true;
  }

  // End of the attempt: settle any rep in progress.
  finish() {
    const events = [];
    for (const k of this.athletes) {
      const ev = k.judge.finish();
      if (ev) events.push({ track: k, ev });
    }
    return events;
  }
}
