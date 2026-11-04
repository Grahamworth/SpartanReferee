// The 2D course map: shaded terrain, forests, lakes, roads and buildings from the course pack, the course with its
// obstacles and water stations, pan and zoom (drag, pinch, wheel), tap to pick a point on the course, and a
// simulation that runs the whole course at a realistic pace with a race clock.
import { sampleLine, pointAt, obstacleKind } from './course-world.js?v=2';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// a fit amateur's pace on a slope (m/s), and how long each kind of obstacle takes (s): the same as the game's race clock
export const realPace = (g) => 2.9 * clamp(Math.exp(-3.5 * Math.abs(g + 0.05)) / Math.exp(-0.175), 0.2, 1.15);
export const OB_TIME = { climb: 25, hurdle: 12, rig: 60, carry: 300, crawl: 150, balance: 40, hoist: 60, aim: 30, bell: 25, memoryBoard: 15, memoryTest: 15 };
const OB_COL = { climb: '#e2231a', rig: '#e2231a', carry: '#f2b705', crawl: '#f2b705', balance: '#3fb8c6', aim: '#3fb8c6', hoist: '#e2231a', hurdle: '#ffffff', bell: '#ffffff', memoryBoard: '#c86ad9', memoryTest: '#c86ad9' };

// The shaded relief as a small image, one pixel per terrain cell (drawn smoothed and scaled up).
function reliefImage(T) {
  const { nI, nJ, S, dx, dz } = T, c = document.createElement('canvas');
  c.width = nJ; c.height = nI;
  const g = c.getContext('2d'), img = g.createImageData(nJ, nI);
  for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
    const k = i * nJ + j, h = S[k];
    const hx = (S[i * nJ + Math.min(nJ - 1, j + 1)] - S[i * nJ + Math.max(0, j - 1)]) / (2 * dx), hz = (S[Math.min(nI - 1, i + 1) * nJ + j] - S[Math.max(0, i - 1) * nJ + j]) / (2 * dz);
    // light from the north-west
    const n = Math.hypot(hx, hz, 1), shade = clamp(0.62 + (-hx * 0.6 + hz * 0.6) / n * 0.9 + 0.3 / n, 0.25, 1.25), steep = Math.hypot(hx, hz);
    let r = 150, gg = 184, b = 112;
    if (T.forest[k]) { r = 84; gg = 128; b = 70; }
    if (h > 1800) { const t = clamp((h - 1800) / 400, 0, 1); r += 35 * t; gg += 10 * t; b += 30 * t; }
    if (steep > 0.75) { const t = clamp((steep - 0.75) / 0.5, 0, 1); r += (165 - r) * t; gg += (160 - gg) * t; b += (150 - b) * t; }
    const o = ((nI - 1 - i) * nJ + j) * 4; // row 0 is the north edge
    img.data[o] = clamp(r * shade, 0, 255); img.data[o + 1] = clamp(gg * shade, 0, 255); img.data[o + 2] = clamp(b * shade, 0, 255); img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

export function makeMap(canvas, pack, T, course, { onTap, interactive = true, cs: given } = {}) {
  const cs = given || sampleLine(T, course.line, 4), total = cs[cs.length - 1].d;
  const relief = reliefImage(T);
  const toXZ = T.toXZ;
  const roads = pack.map.roads.map(([major, line]) => [major, line.map(([la, lo]) => toXZ(la, lo))]);
  const buildings = pack.map.buildings.map(([la, lo, wx, wy]) => { const [x, z] = toXZ(la, lo); return [x, z, wx, wy]; });
  const water = (pack.map.water || []).map((p) => (p[0] && Array.isArray(p[0][0]) ? p[0] : p)).filter((r) => r && r.length > 2 && Array.isArray(r[0])).map((r) => r.map(([la, lo]) => toXZ(la, lo)));
  const rivers = (pack.map.rivers || []).map(([w, line]) => [w, line.map(([la, lo]) => toXZ(la, lo))]);
  const obs = course.obstacles.map((o, k) => { const p = pointAt(cs, o.at); return { ...o, k, kind: obstacleKind(o.name), x: p.x, z: p.z }; });
  const water2 = course.water.map((w) => { const p = pointAt(cs, w.at); return { ...w, x: p.x, z: p.z }; });
  const loops = Object.entries(pack.penaltyLoops || {}).filter(([n]) => course.obstacles.some((o) => o.penalty === n)).map(([, line]) => line.map(([la, lo]) => toXZ(la, lo)));

  // view: centre (x, z) in metres and scale in pixels per metre; starts fitted to the course
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of cs) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const view = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, s: 1 };
  let W = 0, H = 0, dpr = 1, dirty = true;
  const M = { cs, total, obs, water: water2, view, marker: null, runner: null, follow: false, highlight: -1 };
  function fit() {
    const pad = 40;
    view.s = Math.min((W - pad * 2) / Math.max(200, maxX - minX), (H - pad * 2) / Math.max(200, maxZ - minZ));
    view.x = (minX + maxX) / 2; view.z = (minZ + maxZ) / 2; dirty = true;
  }
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    const r = canvas.getBoundingClientRect(); W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    if (!M.fitted && W > 0) { fit(); M.fitted = true; }
    dirty = true;
  }
  const sx = (x) => (x - view.x) * view.s + W / 2, sy = (z) => (z - view.z) * view.s + H / 2;
  const wx = (px) => (px - W / 2) / view.s + view.x, wz = (py) => (py - H / 2) / view.s + view.z;
  M.toScreen = (x, z) => [sx(x), sy(z)];

  function draw() {
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#20301c'; g.fillRect(0, 0, W, H);
    // relief: the image covers the terrain grid's extent
    g.imageSmoothingEnabled = true;
    g.drawImage(relief, sx(T.minX - T.dx / 2), sy(T.minZ - T.dz / 2), (T.maxX - T.minX + T.dx) * view.s, (T.maxZ - T.minZ + T.dz) * view.s);
    const vis = (x, z, m = 50) => { const X = sx(x), Y = sy(z); return X > -m && X < W + m && Y > -m && Y < H + m; };
    g.fillStyle = '#4f8fc0';
    for (const r of water) { g.beginPath(); r.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z)))); g.fill(); }
    g.strokeStyle = '#4f8fc0'; g.lineCap = 'round';
    for (const [w, line] of rivers) { g.lineWidth = Math.max(1, (w || 4) * view.s); g.beginPath(); line.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z)))); g.stroke(); }
    // roads and buildings once zoomed in enough to see them
    if (view.s > 0.12) {
      for (const [major, line] of roads) {
        if (!line.some(([x, z]) => vis(x, z, 200))) continue;
        g.strokeStyle = major ? '#f4f0e6' : 'rgba(240,228,200,0.75)'; g.lineWidth = Math.max(major ? 1.4 : 0.8, (major ? 6 : 3.5) * view.s);
        g.beginPath(); line.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z)))); g.stroke();
      }
    }
    if (view.s > 0.25) {
      g.fillStyle = '#8a7d70';
      for (const [x, z, a, b] of buildings) if (vis(x, z)) g.fillRect(sx(x - a / 2), sy(z - b / 2), Math.max(1.5, a * view.s), Math.max(1.5, b * view.s));
    }
    // penalty loops (dashed) and the course
    g.setLineDash([6, 5]); g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2;
    for (const L of loops) { g.beginPath(); L.forEach(([x, z], i) => (i ? g.lineTo(sx(x), sy(z)) : g.moveTo(sx(x), sy(z)))); g.stroke(); }
    g.setLineDash([]);
    const line = (from, to, col, w) => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); let first = true; for (let i = 0; i < cs.length; i += 2) { const p = cs[i]; if (p.d < from || p.d > to) continue; if (first) { g.moveTo(sx(p.x), sy(p.z)); first = false; } else g.lineTo(sx(p.x), sy(p.z)); } g.stroke(); };
    g.lineJoin = 'round'; g.lineCap = 'round';
    line(0, total, '#0b0b0b', 6); line(0, total, '#e2231a', 3.5);
    if (M.runner) line(0, M.runner.d, '#ffffff', 3.5);
    // kilometre ticks
    g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const step = view.s > 0.35 ? 1000 : view.s > 0.12 ? 2000 : 5000;
    for (let d = step; d < total; d += step) { const p = pointAt(cs, d); if (!vis(p.x, p.z)) continue; g.fillStyle = '#0b0b0b'; g.fillRect(sx(p.x) - 13, sy(p.z) - 8, 26, 16); g.fillStyle = '#fff'; g.fillText(d / 1000 + 'k', sx(p.x), sy(p.z)); }
    // water stations and obstacles (numbered when zoomed in)
    for (const w of water2) { if (!vis(w.x, w.z)) continue; g.fillStyle = '#1d6fb8'; g.beginPath(); g.arc(sx(w.x), sy(w.z), 6, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = 'bold 9px system-ui'; g.fillText('💧', sx(w.x), sy(w.z) + 1); }
    const big = view.s > 0.2;
    for (const o of obs) {
      if (!vis(o.x, o.z)) continue;
      const X = sx(o.x), Y = sy(o.z), done = M.runner && o.at < M.runner.d, hi = o.k === M.highlight;
      g.fillStyle = done ? '#777' : OB_COL[o.kind] || '#fff'; g.strokeStyle = '#0b0b0b'; g.lineWidth = 2;
      g.beginPath(); g.rect(X - (big || hi ? 8 : 4), Y - (big || hi ? 8 : 4), big || hi ? 16 : 8, big || hi ? 16 : 8); g.fill(); g.stroke();
      if (big || hi) { g.fillStyle = g.fillStyle === '#ffffff' || OB_COL[o.kind] === '#ffffff' || OB_COL[o.kind] === '#f2b705' ? '#0b0b0b' : '#fff'; g.font = 'bold 10px system-ui'; g.fillText(String(o.k + 1), X, Y + 0.5); }
      if (hi || (view.s > 0.6)) { g.font = 'bold 12px system-ui'; g.textAlign = 'left'; const t = o.name.replace(/\s*\(.*?\)\s*/g, ' ').trim(); const w = g.measureText(t).width; g.fillStyle = 'rgba(11,11,11,0.8)'; g.fillRect(X + 11, Y - 9, w + 8, 18); g.fillStyle = '#fff'; g.fillText(t, X + 15, Y); g.textAlign = 'center'; }
    }
    // start and finish
    const flag = (p, txt, col) => { g.fillStyle = col; g.beginPath(); g.arc(sx(p.x), sy(p.z), 9, 0, 7); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke(); g.fillStyle = '#fff'; g.font = 'bold 9px system-ui'; g.fillText(txt, sx(p.x), sy(p.z) + 0.5); };
    flag(cs[cs.length - 1], 'FIN', '#0b0b0b'); flag(cs[0], 'GO', '#e2231a');
    // a chosen start point, and the simulated runner
    if (M.marker) { const p = pointAt(cs, M.marker); const X = sx(p.x), Y = sy(p.z); g.fillStyle = '#facc15'; g.strokeStyle = '#0b0b0b'; g.lineWidth = 2; g.beginPath(); g.moveTo(X, Y); g.lineTo(X - 9, Y - 20); g.lineTo(X + 9, Y - 20); g.closePath(); g.fill(); g.stroke(); g.beginPath(); g.arc(X, Y - 22, 9, 0, 7); g.fill(); g.stroke(); }
    if (M.player) { // you: an arrow pointing the way you face
      const P = M.player, X = sx(P.x), Y = sy(P.z);
      g.save(); g.translate(X, Y); g.rotate(Math.PI - P.h); g.fillStyle = '#fff'; g.strokeStyle = '#0b0b0b'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
    if (M.runner) { const p = pointAt(cs, M.runner.d); g.fillStyle = '#fff'; g.strokeStyle = '#e2231a'; g.lineWidth = 3; g.beginPath(); g.arc(sx(p.x), sy(p.z), 8, 0, 7); g.fill(); g.stroke(); }
    // scale bar
    const m = [50, 100, 200, 500, 1000, 2000, 5000].find((v) => v * view.s > 70) || 5000;
    g.fillStyle = 'rgba(11,11,11,0.7)'; g.fillRect(8, H - 26, m * view.s + 16, 18); g.fillStyle = '#fff'; g.fillRect(16, H - 15, m * view.s, 3);
    g.font = '10px system-ui'; g.textAlign = 'left'; g.fillText(m >= 1000 ? m / 1000 + ' km' : m + ' m', 18, H - 20);
    dirty = false;
  }

  // pan, pinch and wheel; a tap picks the nearest point on the course
  const ptrs = new Map(); let moved = 0, pinch = null;
  canvas.style.touchAction = 'none';
  if (interactive) canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY }); moved = 0; M.follow = false; });
  if (interactive) canvas.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId); if (!p) return;
    if (ptrs.size === 1) { view.x -= (e.offsetX - p.x) / view.s; view.z -= (e.offsetY - p.y) / view.s; moved += Math.abs(e.offsetX - p.x) + Math.abs(e.offsetY - p.y); }
    p.x = e.offsetX; p.y = e.offsetY;
    if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      if (pinch) zoomAt(cx, cy, d / pinch); pinch = d; moved += 10;
    }
    dirty = true;
  });
  const up = (e) => {
    const p = ptrs.get(e.pointerId); ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null;
    if (p && moved < 8 && ptrs.size === 0 && onTap) {
      const x = wx(e.offsetX), z = wz(e.offsetY); let best = null, bd = Infinity;
      for (const q of cs) { const dd = Math.hypot(q.x - x, q.z - z); if (dd < bd) { bd = dd; best = q; } }
      if (best && bd * view.s < 40) onTap(best.d); else onTap(null);
    }
  };
  if (interactive) { canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up); }
  function zoomAt(px, py, k) {
    const x = wx(px), z = wz(py);
    view.s = clamp(view.s * k, 0.02, 6);
    view.x = x - (px - W / 2) / view.s; view.z = z - (py - H / 2) / view.s; dirty = true;
  }
  if (interactive) canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  M.zoom = (k) => zoomAt(W / 2, H / 2, k);
  M.fit = fit;
  M.centreOn = (d, s) => { const p = pointAt(cs, d); view.x = p.x; view.z = p.z; if (s) view.s = s; dirty = true; };
  M.redraw = () => { dirty = true; };
  M.resize = resize;
  let raf = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (M.follow && M.player) { view.x += (M.player.x - view.x) * 0.3; view.z += (M.player.z - view.z) * 0.3; dirty = true; }
    else if (M.follow && M.runner) { const p = pointAt(cs, M.runner.d); view.x += (p.x - view.x) * 0.15; view.z += (p.z - view.z) * 0.15; dirty = true; }
    if (dirty && W) draw();
  };
  M.start = () => { resize(); cancelAnimationFrame(raf); raf = requestAnimationFrame(loop); };
  M.stop = () => cancelAnimationFrame(raf);
  addEventListener('resize', () => { if (canvas.isConnected) resize(); });
  return M;
}

/** Runs the course at a fit amateur's pace: obstacles and water stops take their real time. */
export function makeSim(M) {
  const S = { d: 0, t: 0, wait: 0, at: null, playing: false, speed: 60, nextOb: 0, nextW: 0, done: false };
  S.reset = (d = 0) => { S.d = d; S.t = 0; S.wait = 0; S.at = null; S.done = false; S.nextOb = M.obs.findIndex((o) => o.at >= d); if (S.nextOb < 0) S.nextOb = M.obs.length; S.nextW = M.water.findIndex((w) => w.at >= d); if (S.nextW < 0) S.nextW = M.water.length; };
  S.step = (dt) => {
    if (!S.playing || S.done) return;
    let left = dt * S.speed; // race seconds to spend this frame
    while (left > 0 && !S.done) {
      if (S.wait > 0) { const w = Math.min(S.wait, left); S.wait -= w; S.t += w; left -= w; if (S.wait <= 0) S.at = null; continue; }
      const o = M.obs[S.nextOb], wtr = M.water[S.nextW];
      const stopAt = Math.min(o ? o.at : Infinity, wtr ? wtr.at : Infinity, M.total);
      const a = pointAt(M.cs, S.d), b = pointAt(M.cs, Math.min(M.total, S.d + 5));
      const v = realPace((b.y - a.y) / 5), need = (stopAt - S.d) / v;
      if (need > left) { S.d += v * left; S.t += left; left = 0; break; }
      S.d = stopAt; S.t += need; left -= need;
      if (o && stopAt === o.at) { S.wait = OB_TIME[o.kind] || 20; S.at = o; S.nextOb++; }
      else if (wtr && stopAt === wtr.at) { S.wait = 20; S.at = { name: 'Water station', water: true }; S.nextW++; }
      else S.done = true;
    }
  };
  return S;
}
