// The obstacles of Course Run, each built to look like the real thing: timber walls with braces and the red step,
// cargo nets of knotted rope, black steel rigs with rings and a twister, ropes over a water pit, a Hercules hoist
// with its pulley and weight, the Z wall and Olympus traverses, barbed wire over mud, fire jumps, spear throws...
// buildObstacle() returns the model (local +z = the direction of travel, x across the trail), the boxes that make
// it solid, a spec saying how a runner gets through it, the lanes runners use side by side, and tick() for its
// moving parts (ropes swinging, the bell, the twister, flames, the hoist's weight).
// act(spec, u) says where a runner is and how they're posed u (0..1) of the way through: the game uses it for
// you and the crowd uses it for the other contestants, so everyone does the obstacle the same way.
/* global THREE */

const FT = 0.3048, UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const seg = (u, a, b) => clamp((u - a) / (b - a), 0, 1);
const ease = (t) => t * t * (3 - 2 * t);

// ---------------------------------------------------------------- textures (drawn once)
function rngOf(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }
function tex(N, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  draw(c.getContext('2d'), N);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 16;
  if (srgb) t.encoding = THREE.sRGBEncoding;
  return t;
}
function speckle(g, N, r, n, cols, a, s0 = 1, s1 = 2) { g.globalAlpha = a; for (let i = 0; i < n; i++) { g.fillStyle = cols[Math.floor(r() * cols.length)]; const s = s0 + r() * (s1 - s0); g.fillRect(r() * N, r() * N, s, s); } g.globalAlpha = 1; }
// wood grain running along u (the texture's x), optionally with plank seams every N/8
function grain(g, N, r, base, dark, light, planks) {
  g.fillStyle = base; g.fillRect(0, 0, N, N);
  for (let i = 0; i < 260; i++) {
    const y0 = r() * N, amp = 1 + r() * 4, f = 0.004 + r() * 0.02, ph = r() * 9;
    g.strokeStyle = r() < 0.6 ? dark : light; g.globalAlpha = 0.18 + r() * 0.3; g.lineWidth = 0.6 + r() * 1.6;
    g.beginPath(); for (let x = -4; x <= N + 4; x += 6) { const y = y0 + Math.sin(x * f + ph) * amp; if (x < 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke();
  }
  for (let i = 0; i < 7; i++) { const x = r() * N, y = r() * N; g.globalAlpha = 0.55; g.fillStyle = dark; g.beginPath(); g.ellipse(x, y, 4 + r() * 6, 2 + r() * 3, 0, 0, 7); g.fill(); g.globalAlpha = 0.25; g.strokeStyle = dark; for (let k = 1; k < 4; k++) { g.beginPath(); g.ellipse(x, y, 6 + k * 5, 3 + k * 2.5, 0, 0, 7); g.stroke(); } }
  if (planks) {
    const h = N / 8;
    for (let k = 0; k < 8; k++) {
      g.globalAlpha = 0.12 + r() * 0.16; g.fillStyle = r() < 0.5 ? '#000' : '#fff'; g.fillRect(0, k * h, N, h); // each plank a slightly different shade
      g.globalAlpha = 0.85; g.fillStyle = '#2a1c10'; g.fillRect(0, k * h, N, 2.5);                            // the gap between planks
      g.globalAlpha = 0.6; g.fillStyle = '#1a1a1a'; for (const x of [N * 0.08, N * 0.58]) { g.fillRect(x, k * h + h * 0.3, 3, 3); g.fillRect(x, k * h + h * 0.7, 3, 3); } // nails
    }
  }
  g.globalAlpha = 1;
}
let TX = null;
function textures() {
  if (TX) return TX;
  const r = rngOf(77);
  TX = {
    timber: tex(512, (g, N) => grain(g, N, r, '#a77b4f', '#6b4a2b', '#c99d6c', false)),
    planks: tex(512, (g, N) => grain(g, N, r, '#9c7247', '#5e3f22', '#c49866', true)),
    weathered: tex(512, (g, N) => grain(g, N, r, '#8a7a66', '#4f4436', '#b2a48e', true)),
    steel: tex(256, (g, N) => { g.fillStyle = '#b4b8bd'; g.fillRect(0, 0, N, N); speckle(g, N, r, 5000, ['#9aa0a6', '#c9cdd2', '#8d9298', '#d6d9dd'], 0.45); g.globalAlpha = 0.25; g.strokeStyle = '#7d8288'; for (let i = 0; i < 60; i++) { g.beginPath(); const x = r() * N, y = r() * N; g.moveTo(x, y); g.lineTo(x + 20 + r() * 40, y + (r() - 0.5) * 3); g.stroke(); } g.globalAlpha = 1; }),
    black: tex(256, (g, N) => { g.fillStyle = '#26272a'; g.fillRect(0, 0, N, N); speckle(g, N, r, 3500, ['#1d1e20', '#303236', '#3a3c40', '#5a4a3a'], 0.4); }),
    rope: tex(128, (g, N) => { g.fillStyle = '#c4ad78'; g.fillRect(0, 0, N, N); for (let i = -N; i < N * 2; i += 16) { g.fillStyle = '#9c8656'; g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 8, 0); g.lineTo(i + 8 + N * 0.6, N); g.lineTo(i + N * 0.6, N); g.fill(); g.fillStyle = '#ddc896'; g.fillRect(i + 10, 0, 2, N); } speckle(g, N, r, 600, ['#7f6c45', '#e6d6a8'], 0.4); }),
    hay: tex(256, (g, N) => { g.fillStyle = '#c9a646'; g.fillRect(0, 0, N, N); for (let i = 0; i < 2600; i++) { g.strokeStyle = ['#e2c46a', '#a88632', '#d8b85a', '#8e7028', '#efd889'][Math.floor(r() * 5)]; g.globalAlpha = 0.7; g.lineWidth = 1 + r(); g.beginPath(); const x = r() * N, y = r() * N, a = (r() - 0.5) * 0.6; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); g.stroke(); } g.globalAlpha = 1; }),
    mud: tex(512, (g, N) => {
      g.fillStyle = '#5a4430'; g.fillRect(0, 0, N, N);
      for (let i = 0; i < 400; i++) { g.fillStyle = ['#4a3726', '#6b523a', '#3b2b1d', '#73593e'][Math.floor(r() * 4)]; g.globalAlpha = 0.35; const s = 6 + r() * 40; g.beginPath(); g.ellipse(r() * N, r() * N, s, s * 0.6, r() * 3, 0, 7); g.fill(); }
      for (let i = 0; i < 90; i++) { g.strokeStyle = '#2e2116'; g.globalAlpha = 0.35; g.lineWidth = 3; g.beginPath(); const x = r() * N, y = r() * N; g.arc(x, y, 6 + r() * 14, r() * 3, r() * 3 + 2); g.stroke(); } // boot prints and ruts
      speckle(g, N, r, 1500, ['#9b8a74', '#2a1e14'], 0.5, 1, 3);
    }),
    canvas: tex(128, (g, N) => { g.fillStyle = '#2b2b2b'; g.fillRect(0, 0, N, N); g.globalAlpha = 0.35; for (let i = 0; i < N; i += 3) { g.fillStyle = i % 6 ? '#3b3b3b' : '#1e1e1e'; g.fillRect(i, 0, 1.5, N); g.fillRect(0, i, N, 1.5); } g.globalAlpha = 1; }),
    concrete: tex(256, (g, N) => { g.fillStyle = '#9a9792'; g.fillRect(0, 0, N, N); speckle(g, N, r, 9000, ['#7d7a75', '#b3b0aa', '#6b6863', '#c2bfb9'], 0.5, 1, 2.5); }),
    bark: tex(256, (g, N) => { g.fillStyle = '#5b4330'; g.fillRect(0, 0, N, N); for (let i = 0; i < 160; i++) { g.strokeStyle = r() < 0.5 ? '#3b2a1c' : '#7a5c42'; g.globalAlpha = 0.6; g.lineWidth = 2 + r() * 3; g.beginPath(); const y = r() * N; g.moveTo(0, y); for (let x = 0; x <= N; x += 16) g.lineTo(x, y + (r() - 0.5) * 6); g.stroke(); } g.globalAlpha = 1; }),
    endgrain: tex(128, (g, N) => { g.fillStyle = '#c9a571'; g.fillRect(0, 0, N, N); for (let k = 1; k < 12; k++) { g.strokeStyle = k % 2 ? '#a07c4c' : '#b48f5c'; g.lineWidth = 2; g.beginPath(); g.arc(N / 2, N / 2, k * 5.5, 0, 7); g.stroke(); } g.strokeStyle = '#4a3422'; g.lineWidth = 8; g.beginPath(); g.arc(N / 2, N / 2, N / 2 - 4, 0, 7); g.stroke(); }),
    target: tex(256, (g, N) => { g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, N, N); for (let k = 5; k > 0; k--) { g.fillStyle = k % 2 ? '#111' : '#f4f1ea'; g.beginPath(); g.arc(N / 2, N / 2, k * N / 11, 0, 7); g.fill(); } g.fillStyle = '#e2231a'; g.beginPath(); g.arc(N / 2, N / 2, N / 14, 0, 7); g.fill(); }),
    flame: tex(128, (g, N) => { const gr = g.createRadialGradient(N / 2, N * 0.7, 2, N / 2, N * 0.62, N * 0.5); gr.addColorStop(0, 'rgba(255,250,210,1)'); gr.addColorStop(0.25, 'rgba(255,190,60,0.95)'); gr.addColorStop(0.6, 'rgba(240,80,10,0.55)'); gr.addColorStop(1, 'rgba(120,20,0,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(N / 2, 0); g.quadraticCurveTo(N * 0.95, N * 0.6, N / 2, N); g.quadraticCurveTo(N * 0.05, N * 0.6, N / 2, 0); g.fill(); }),
    smoke: tex(64, (g, N) => { const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2); gr.addColorStop(0, 'rgba(90,90,90,0.5)'); gr.addColorStop(1, 'rgba(90,90,90,0)'); g.fillStyle = gr; g.fillRect(0, 0, N, N); }),
    words: tex(512, (g, N) => {
      g.fillStyle = '#0b0b0b'; g.fillRect(0, 0, N, N); g.fillStyle = '#e2231a'; g.fillRect(0, 0, N, 64);
      g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.fillText('MEMORY', N / 2, 46);
      g.font = 'bold 26px sans-serif'; const W = ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET'];
      W.forEach((w, i) => { g.textAlign = 'left'; g.fillText(String(i), 40, 110 + i * 40); g.fillText(w, 90, 110 + i * 40); g.fillText(String(100 + ((i * 397) % 900)) + '-' + (1000 + ((i * 7919) % 9000)), 290, 110 + i * 40); });
    }),
  };
  return TX;
}

// ---------------------------------------------------------------- materials
let MT = null;
function mats() {
  if (MT) return MT;
  const X = textures(), S = (o) => new THREE.MeshStandardMaterial(o);
  MT = {
    timber: S({ map: X.timber, roughness: 0.82 }),
    planks: S({ map: X.planks, roughness: 0.85 }),
    weathered: S({ map: X.weathered, roughness: 0.9 }),
    steel: S({ map: X.steel, metalness: 0.75, roughness: 0.38 }),
    black: S({ map: X.black, metalness: 0.35, roughness: 0.5 }),
    red: S({ color: 0xc9201a, roughness: 0.45, metalness: 0.1 }),
    yellow: S({ color: 0xf2b705, roughness: 0.5 }),
    white: S({ color: 0xeeeeea, roughness: 0.55 }),
    rope: S({ map: X.rope, roughness: 0.95 }),
    webbing: S({ color: 0xe8c21c, roughness: 0.8 }),
    chain: S({ color: 0x8a8d92, metalness: 0.85, roughness: 0.32 }),
    wire: S({ color: 0x9da2a8, metalness: 0.9, roughness: 0.3 }),
    hay: S({ map: X.hay, roughness: 1 }),
    mud: S({ map: X.mud, color: 0x8a7560, roughness: 0.62, metalness: 0, envMapIntensity: 0.35, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }),
    water: S({ color: 0x3a3424, roughness: 0.12, metalness: 0, envMapIntensity: 0.5, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    rubber: S({ color: 0x1b1b1b, roughness: 0.92 }),
    mat: S({ color: 0x1d3f8a, roughness: 0.75 }),
    canvas: S({ map: X.canvas, roughness: 0.95 }),
    concrete: S({ map: X.concrete, roughness: 0.92 }),
    bucket: S({ color: 0x1e1e1e, roughness: 0.55 }),
    gravel: S({ map: X.concrete, color: 0xb9ac94, roughness: 1 }),
    bark: S({ map: X.bark, roughness: 0.97 }),
    endgrain: S({ map: X.endgrain, roughness: 0.9 }),
    charred: S({ color: 0x1f1813, roughness: 0.97, emissive: 0x3a0e00, emissiveIntensity: 0.6 }),
    target: S({ map: X.target, roughness: 0.8 }),
    words: S({ map: X.words, roughness: 0.6 }),
    holds: [0xe2231a, 0xf2b705, 0x2f8f3a, 0x1d4fa8, 0xff6a13, 0x7a2fa8].map((c) => S({ color: c, roughness: 0.75 })),
    hole: S({ color: 0x0c0c0c, roughness: 1 }),
    flame: new THREE.MeshBasicMaterial({ map: X.flame, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false }),
    smoke: new THREE.MeshBasicMaterial({ map: X.smoke, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    brass: S({ color: 0xc8a24a, metalness: 0.9, roughness: 0.28 }),
  };
  return MT;
}

// UVs in metres, laid on each face along its longer side (so wood grain runs the length of a plank or post)
function metricUV(g, scale = 1.2) {
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  g.computeBoundingBox(); const s = g.boundingBox.getSize(new THREE.Vector3());
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let a, b, la, lb;
    if (ax >= ay && ax >= az) { a = p.getZ(i); b = p.getY(i); la = s.z; lb = s.y; } else if (ay >= az) { a = p.getX(i); b = p.getZ(i); la = s.x; lb = s.z; } else { a = p.getX(i); b = p.getY(i); la = s.x; lb = s.y; }
    if (lb > la) [a, b] = [b, a];
    uv.setXY(i, a / scale, b / scale);
  }
  return g;
}

// ---------------------------------------------------------------- a kit for building one obstacle
class Kit {
  constructor() { this.g = new THREE.Group(); this.col = []; this.dyn = []; this.net = 0.3; }
  add(geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, parent = this.g) { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); parent.add(o); return o; }
  box(w, h, d, m, x, y, z, rx = 0, ry = 0, rz = 0, parent) { return this.add(metricUV(new THREE.BoxGeometry(w, h, d)), m, x, y, z, rx, ry, rz, parent); }
  // a square post from below the ground up to h
  post(x, z, h, m, s = 0.16) { return this.box(s, h + 0.8, s, m, x, (h - 0.8) / 2, z); }
  cyl(r, h, m, x, y, z, rx = 0, ry = 0, rz = 0, segs = 14, parent) { const g = new THREE.CylinderGeometry(r, r, h, segs); return this.add(g, m, x, y, z, rx, ry, rz, parent); }
  // a round bar (or a square beam) from a to b
  pipe(a, b, r, m, segs = 10, square = false, parent) {
    const d = b.clone().sub(a), L = d.length();
    const geo = square ? metricUV(new THREE.BoxGeometry(r * 2, L, r * 2)) : new THREE.CylinderGeometry(r, r, L, segs, 1, segs <= 4);
    const o = new THREE.Mesh(geo, m); o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(UP, d.normalize());
    (parent || this.g).add(o); return o;
  }
  beam(a, b, s, m, parent) { return this.pipe(a, b, s / 2, m, 4, true, parent); }
  // a rope from a to b, sagging in the middle
  rope(a, b, sag = 0.1, r = 0.016, m = mats().rope, parent) {
    const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= sag * 2;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b), L = a.distanceTo(b);
    const geo = new THREE.TubeGeometry(curve, Math.max(4, Math.ceil(L * 3)), r, 6, false);
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L / 0.12, uv.getY(i));
    return this.add(geo, m, 0, 0, 0, 0, 0, 0, parent);
  }
  // a knotted rope net between four corners (bottom left/right, top left/right), bulging along `out`
  netQuad(p00, p10, p01, p11, sag = 0.08, out = V(0, 0, 0), parent) {
    const w = p00.distanceTo(p10), h = p00.distanceTo(p01), nu = Math.max(2, Math.round(w / this.net)), nv = Math.max(2, Math.round(h / this.net));
    const P = (i, j) => {
      const u = i / nu, v = j / nv, a = p00.clone().lerp(p10, u), b = p01.clone().lerp(p11, u);
      return a.lerp(b, v).addScaledVector(out, sag * Math.sin(Math.PI * u) * Math.sin(Math.PI * v));
    };
    const m = mats().rope;
    for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) this.pipe(P(i, j), P(i + 1, j), 0.013, m, 4, false, parent);
    for (let i = 0; i <= nu; i++) for (let j = 0; j < nv; j++) this.pipe(P(i, j), P(i, j + 1), 0.013, m, 4, false, parent);
  }
  collide(x, z, hx, hz) { this.col.push({ x, z, hx, hz }); }
  // something that moves: kept out of the merge
  keep(o) { o.userData.keep = true; o.traverse((c) => { c.castShadow = true; }); return o; }
  // join everything that doesn't move into one mesh per material (a few draw calls per obstacle instead of hundreds)
  finish() {
    const g = this.g; g.updateMatrixWorld(true);
    const skip = new Set(); g.traverse((o) => { if (o.userData.keep) o.traverse((c) => skip.add(c)); });
    const buckets = new Map(), done = [];
    g.traverse((o) => { if (!o.isMesh || skip.has(o)) return; let a = buckets.get(o.material); if (!a) buckets.set(o.material, a = []); a.push(o); done.push(o); });
    for (const o of done) o.parent.remove(o);
    for (const [m, list] of buckets) {
      let n = 0; const geos = list.map((o) => { const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld); n += geo.attributes.position.count; return geo; });
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
      let k = 0;
      for (const geo of geos) { const c = geo.attributes.position.count; pos.set(geo.attributes.position.array, k * 3); nor.set(geo.attributes.normal.array, k * 3); if (geo.attributes.uv) uv.set(geo.attributes.uv.array, k * 2); k += c; geo.dispose(); }
      for (const o of list) o.geometry.dispose();
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      out.computeBoundingSphere();
      const mesh = new THREE.Mesh(out, m);
      const flat = m === MT.mud || m === MT.water || m === MT.flame || m === MT.smoke;
      mesh.castShadow = !flat; mesh.receiveShadow = m !== MT.flame && m !== MT.smoke;
      g.add(mesh);
    }
    g.traverse((o) => { if (o.isMesh && skip.has(o)) { o.castShadow = o.material !== MT.flame && o.material !== MT.smoke; o.receiveShadow = true; } });
  }
}

// ---------------------------------------------------------------- the pieces many obstacles share
const W = 4.6; // across the trail
function flagPole(k, x, z, red) {
  const M = mats();
  k.cyl(0.03, 3.4, M.steel, x, 1.3, z, 0, 0, 0, 8);
  const f = new THREE.Group(); f.position.set(x, 2.75, z);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6, 8, 1), red ? M.red : M.black); cloth.material = cloth.material.clone(); cloth.material.side = THREE.DoubleSide;
  cloth.position.x = 0.47; f.add(cloth); k.g.add(k.keep(f));
  const base = cloth.geometry.attributes.position.array.slice(), ph = Math.random() * 6;
  k.dyn.push((dt, t) => { const p = cloth.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x0 = base[i * 3] + 0.45; p.setZ(i, Math.sin(t * 5 + x0 * 5 + ph) * 0.07 * x0); } p.needsUpdate = true; cloth.geometry.computeVertexNormals(); });
}
function mudPit(k, w, l, z = 0, wet = false) { const g = new THREE.PlaneGeometry(w, l); g.rotateX(-Math.PI / 2); const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 3, uv.getY(i) * l / 3); k.add(g, wet ? mats().water : mats().mud, 0, wet ? 0.07 : 0.05, z); }
function bell(k, x, y, z, big = false) {
  const M = mats(), s = big ? 2.2 : 1, b = new THREE.Group(); b.position.set(x, y, z);
  const pts = []; for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2((0.05 + 0.1 * t * t + 0.04 * t) * s, -t * 0.22 * s)); }
  const shell = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), M.brass); shell.material = M.brass; b.add(shell);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.05 * s, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), M.brass); b.add(cap);
  const clap = new THREE.Mesh(new THREE.SphereGeometry(0.025 * s, 8, 6), M.black); clap.position.y = -0.2 * s; b.add(clap);
  k.g.add(k.keep(b)); shell.material.side = THREE.DoubleSide;
  b.userData.swing = 0;
  k.dyn.push((dt) => { b.userData.swing *= Math.exp(-dt * 1.2); b.rotation.x = Math.sin(performance.now() / 160) * b.userData.swing * 0.5; });
  (k.bells || (k.bells = [])).push(b);
  return b;
}
// a straight run of a chain of links
function chain(k, a, b, r = 0.035) {
  const M = mats(), d = b.clone().sub(a), L = d.length(), n = Math.max(2, Math.floor(L / (r * 2.6))), geo = new THREE.TorusGeometry(r, r * 0.28, 5, 10);
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), d.clone().normalize());
  for (let i = 0; i < n; i++) { const o = new THREE.Mesh(geo, M.chain); o.position.copy(a).addScaledVector(d, (i + 0.5) / n); o.quaternion.copy(q); o.rotateY(i % 2 ? Math.PI / 2 : 0); o.scale.set(1, 1.45, 1); k.g.add(o); }
}
function hayBale(k, x, y, z, w = 1.0, h = 0.45, d = 0.5, ry = 0) {
  const M = mats(), b = k.box(w, h, d, M.hay, x, y + h / 2, z, 0, ry, 0);
  for (const s of [-0.28, 0.28]) k.box(0.02, h + 0.01, d + 0.01, M.rope, x + Math.cos(ry) * w * s, y + h / 2, z - Math.sin(ry) * w * s, 0, ry, 0); // the twine
  return b;
}
function log(k, x, y, z, len, r, ry = 0, rz = Math.PI / 2, charred = false) {
  const M = mats(), g = new THREE.CylinderGeometry(r, r * 1.05, len, 12, 1, false);
  const o = k.add(g, charred ? M.charred : M.bark, x, y, z, 0, ry, rz);
  if (!charred) for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.CircleGeometry(r * 0.98, 12), M.endgrain); c.position.set(0, s * (len / 2 + 0.002), 0); c.rotation.x = -s * Math.PI / 2; o.add(c); }
  return o;
}

// ---------------------------------------------------------------- walls
function wall(k, H, { inverted = false, hanging = false, kids = false } = {}) {
  const M = mats(), postH = hanging ? H + 1.2 : H + 0.35, t = 0.09;
  for (const s of [-1, 1]) {
    k.post(s * (W / 2 + 0.1), 0, postH, M.timber, 0.2);
    // braces out to the side of the climbing lane, both ways
    for (const z of [-1, 1]) k.beam(V(s * (W / 2 + 0.1), postH * 0.62, 0), V(s * (W / 2 + 0.1), -0.1, z * Math.max(1, H * 0.45)), 0.12, M.timber);
  }
  if (hanging) {
    // the wall hangs from a beam on chains, the bottom well off the ground
    const top = H + 1.1, bottom = 0.75;
    k.box(W + 0.5, 0.22, 0.22, M.timber, 0, top, 0);
    const p = new THREE.Group(); k.g.add(p);
    k.box(W - 0.1, H + 0.3 - bottom, t, M.planks, 0, bottom + (H + 0.3 - bottom) / 2, 0, 0, 0, 0, p);
    for (const x of [-1.6, 1.6]) chain(k, V(x, top - 0.1, 0), V(x, H + 0.3, 0));
    k.box(W - 0.1, 0.12, 0.16, M.timber, 0, H + 0.36, 0, 0, 0, 0, p);
  } else if (inverted) {
    // leaning back over you
    const lean = 0.32, p = new THREE.Group(); p.rotation.x = -lean; k.g.add(p);
    k.box(W - 0.1, H, t, M.planks, 0, H / 2, 0, 0, 0, 0, p);
    k.box(W - 0.1, 0.12, 0.2, M.timber, 0, H, 0.02, 0, 0, 0, p);
    for (const x of [-1.6, 0, 1.6]) k.beam(V(x, 0, 0.6), V(x, H * Math.cos(lean) * 0.9, -H * Math.sin(lean) * 0.9 + 0.05), 0.1, M.timber); // the props behind it
  } else {
    k.box(W - 0.1, H, t, M.planks, 0, H / 2, 0);
    k.box(W - 0.1, 0.12, 0.2, M.timber, 0, H + 0.06, 0);                 // the cap you grab
    for (const s of [-1, 1]) k.box(W - 0.1, 0.12, 0.05, M.timber, 0, H * 0.33, s * (t / 2 + 0.025)); // the rails
    if (H > 6.5 * FT && !kids) k.box(0.55, 0.09, 0.22, M.red, -1.1, 0.62, -0.15);  // the red step (for women)
  }
  k.collide(0, 0, W / 2 + 0.25, 0.25);
  return { shape: 'wall', H, lanes: [-1.6, -0.5, 0.6, 1.6], dur: 3.2 + H * 0.2, from: -2.5, to: 4.5 };
}
function slipWall(k, H) {
  const M = mats(), D = H * 0.95, top = new THREE.Group(); k.g.add(top);
  const ang = Math.atan2(H, D), len = Math.hypot(H, D);
  k.box(W - 0.2, len, 0.08, M.planks, 0, H / 2, -D / 2, Math.PI / 2 - ang, 0, 0);
  for (const s of [-1, 1]) { k.post(s * W / 2, 0, H + 0.9, M.timber, 0.18); k.post(s * W / 2, 1.3, H, M.timber, 0.16); k.beam(V(s * W / 2, -0.2, -D), V(s * W / 2, H, -0.05), 0.16, M.timber); }
  k.box(W, 0.08, 1.3, M.planks, 0, H, 0.65);                                         // the platform
  k.box(W + 0.2, 0.12, 0.12, M.timber, 0, H + 0.9, 0);                                // the rail the ropes hang from
  for (const x of [-1.5, -0.5, 0.5, 1.5]) {
    const a = V(x, H + 0.85, 0.05), b = V(x, 0.05, -D - 0.3);
    k.rope(a, V(x, H + 0.08, -0.05), 0.02, 0.019); k.rope(V(x, H + 0.04, -0.07), b, 0.01, 0.019);
  }
  for (let y = 0.35; y < H; y += 0.42) k.box(W - 0.4, 0.08, 0.12, M.timber, 0, y, 1.3 + (H - y) * 0.15); // a ladder down the back
  mudPit(k, W + 0.6, 2.4, -D - 1.1);
  k.collide(0, (1.3 - D) / 2, W / 2 + 0.2, (D + 1.6) / 2);
  return { shape: 'slip', H, D, lanes: [-1.5, -0.5, 0.5, 1.5], dur: 4.4, from: -D - 2, to: 4 };
}
function stairway(k, H) {
  const M = mats(), n = 5, step = H / n;
  for (let i = 0; i < n; i++) {
    const y = (i + 1) * step, z = -2 + i * 0.5;
    k.box(W, step, 0.06, M.planks, 0, y - step / 2, z - 0.25);             // the riser
    k.box(W, 0.07, 0.5, M.planks, 0, y, z);                                  // the tread
  }
  for (const s of [-1, 1]) { k.post(s * (W / 2 + 0.1), 0.35, H + 0.4, M.timber, 0.2); k.post(s * (W / 2 + 0.1), -2.3, step + 0.3, M.timber, 0.16); k.beam(V(s * (W / 2 + 0.1), step, -2.3), V(s * (W / 2 + 0.1), H, 0.35), 0.16, M.timber); }
  k.box(W, H, 0.09, M.planks, 0, H / 2, 0.55);                                // the drop down the back
  k.collide(0, -0.9, W / 2 + 0.25, 1.6);
  return { shape: 'stair', H, lanes: [-1.5, -0.5, 0.5, 1.5], dur: 4, from: -3, to: 4.5 };
}

// ---------------------------------------------------------------- frames and nets
function aFrame(k, H, { ladder = false, steel = false } = {}) {
  const M = mats(), D = H * 0.62, fm = steel ? M.black : M.timber, s2 = steel ? 0.1 : 0.18;
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + 0.15);
    k.beam(V(x, -0.3, -D - 0.2), V(x, H + 0.15, 0), s2, fm); k.beam(V(x, -0.3, D + 0.2), V(x, H + 0.15, 0), s2, fm);
    k.beam(V(x, H * 0.35, -D * 0.65), V(x, H * 0.35, D * 0.65), s2 * 0.8, fm);
  }
  k.box(W + 0.6, s2, s2, fm, 0, H + 0.1, 0);
  if (ladder) {
    for (const z of [-1, 1]) for (let y = 0.4; y < H; y += 0.45) { const zz = z * D * (1 - y / H); k.pipe(V(-W / 2, y, zz), V(W / 2, y, zz), 0.03, M.steel, 10); }
  } else {
    for (const z of [-1, 1]) k.netQuad(V(-W / 2 + 0.1, 0.05, z * D), V(W / 2 - 0.1, 0.05, z * D), V(-W / 2 + 0.1, H, z * 0.05), V(W / 2 - 0.1, H, z * 0.05), 0.12, V(0, -0.4, z * 0.6).normalize().negate());
    for (const z of [-1, 1]) k.pipe(V(-W / 2, 0.05, z * D), V(W / 2, 0.05, z * D), 0.03, M.steel, 8);
  }
  k.collide(0, 0, W / 2 + 0.3, D + 0.2);
  return { shape: 'frame', H, D1: D, D2: D, lanes: [-1.5, -0.5, 0.5, 1.5], dur: 2.6 + H * 0.45, from: -D - 1.5, to: D + 3 };
}
function verticalNet(k, H) {
  const M = mats(), D = 0.55;
  for (const s of [-1, 1]) { const x = s * (W / 2 + 0.25); k.post(x, -0.9, H + 0.3, M.black, 0.14); k.post(x, 0.9, H + 0.3, M.black, 0.14); k.box(0.12, 0.12, 1.9, M.black, x, H + 0.25, 0); k.beam(V(x, H * 0.5, -0.9), V(x, -0.1, -2.2), 0.1, M.black); k.beam(V(x, H * 0.5, 0.9), V(x, -0.1, 2.2), 0.1, M.black); }
  k.pipe(V(-W / 2 - 0.3, H, 0), V(W / 2 + 0.3, H, 0), 0.07, M.steel, 12);      // the top bar
  for (const z of [-1, 1]) { k.netQuad(V(-W / 2, 0.1, z * D), V(W / 2, 0.1, z * D), V(-W / 2, H - 0.05, z * 0.08), V(W / 2, H - 0.05, z * 0.08), 0.1, V(0, 0, z)); k.pipe(V(-W / 2, 0.1, z * D), V(W / 2, 0.1, z * D), 0.035, M.steel, 8); }
  k.box(W + 1, 0.25, 3.4, M.mat, 0, 0.12, 0);                                  // crash mats
  k.collide(0, 0, W / 2 + 0.4, 1.0);
  return { shape: 'frame', H, D1: 1.2, D2: 1.2, lanes: [-1.5, -0.5, 0.5, 1.5], dur: 3 + H * 0.5, from: -2.5, to: 3.5 };
}
function cascadeNet(k, H) {
  const M = mats(), D = H * 1.15;
  for (const s of [-1, 1]) { const x = s * (W / 2 + 0.2); k.post(x, 0, H + 0.3, M.black, 0.14); k.post(x, 0.7, H + 0.3, M.black, 0.14); k.beam(V(x, -0.2, -D), V(x, H, 0), 0.12, M.black); k.beam(V(x, H * 0.5, 0.7), V(x, -0.1, 2), 0.1, M.black); }
  k.box(W + 0.4, 0.06, 0.7, M.planks, 0, H, 0.35);
  k.netQuad(V(-W / 2, 0.05, -D), V(W / 2, 0.05, -D), V(-W / 2, H, -0.02), V(W / 2, H, -0.02), 0.35, V(0, -1, 0.3).normalize());  // the sloping net up
  k.netQuad(V(-W / 2, 0.1, 0.75), V(W / 2, 0.1, 0.75), V(-W / 2, H, 0.72), V(W / 2, H, 0.72), 0.06, V(0, 0, 1));                 // straight down the back
  k.collide(0, (0.8 - D) / 2, W / 2 + 0.3, (D + 0.9) / 2);
  return { shape: 'frame', H, D1: D, D2: 0.8, lanes: [-1.5, -0.5, 0.5, 1.5], dur: 3.4 + H * 0.4, from: -D - 1.5, to: 3 };
}
function bender(k, H) {
  const M = mats(), lean = 0.9; // the top hangs 0.9 m back over you
  for (const s of [-1, 1]) {
    const x = s * (W / 2 + 0.1);
    k.pipe(V(x, -0.3, 0.2), V(x, H + 0.2, -lean), 0.06, M.black, 10); k.pipe(V(x, -0.3, 1.6), V(x, H + 0.2, -lean), 0.06, M.black, 10);
  }
  for (let y = 0.9; y <= H; y += 0.62) { const z = 0.2 - (lean + 0.2) * (y / H); k.pipe(V(-W / 2, y, z), V(W / 2, y, z), 0.035, M.steel, 10); }
  for (let y = 0.5; y < H; y += 0.5) { const z = 1.6 - (1.6 + lean) * (y / H); k.pipe(V(-W / 2, y, z), V(W / 2, y, z), 0.025, M.black, 8); }   // the ladder down the back
  k.collide(0, 0.5, W / 2 + 0.2, 1.1);
  return { shape: 'frame', H, D1: 0.8, D2: 1.6, lanes: [-1.5, -0.5, 0.5, 1.5], dur: 3.4 + H * 0.4, from: -2.3, to: 3.5 };
}
function ropeClimb(k, H, kids) {
  const M = mats(), top = H + 0.6, xs = kids ? [-1, 1] : [-1.5, 0, 1.5];
  for (const s of [-1, 1]) { const x = s * (W / 2 + 0.2); k.post(x, 0, top, M.black, 0.18); k.beam(V(x, top * 0.55, 0), V(x, -0.1, -1.8), 0.12, M.black); k.beam(V(x, top * 0.55, 0), V(x, -0.1, 1.8), 0.12, M.black); }
  k.box(W + 0.8, 0.2, 0.2, M.black, 0, top, 0);
  for (const x of xs) {
    const g = new THREE.Group(); g.position.set(x, top - 0.1, 0);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, top - 0.25, 8), M.rope); r.position.y = -(top - 0.25) / 2; g.add(r);
    for (let y = 1.0; y < top - 0.5; y += 1.1) { const kn = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), M.rope); kn.position.y = -(top - 0.1) + y; kn.scale.y = 1.3; g.add(kn); }
    k.g.add(k.keep(g)); const ph = Math.random() * 6;
    k.dyn.push((dt, t) => { g.rotation.x = Math.sin(t * 0.9 + ph) * 0.03; g.rotation.z = Math.sin(t * 0.7 + ph * 2) * 0.02; });
    k.box(0.04, 0.04, 0.5, M.steel, x + 0.25, top - 0.1, 0.15); bell(k, x + 0.25, top - 0.15, 0.38);
  }
  mudPit(k, W + 0.6, 3.2, 0, !kids);
  k.collide(-W / 2 - 0.2, 0, 0.2, 0.3); k.collide(W / 2 + 0.2, 0, 0.2, 0.3);
  return { shape: 'rope', H, lanes: xs, dur: 3.6 + H * 0.4, from: -1.8, to: 4 };
}
function ladderTilt(k, H) {
  // a big ladder hung from a gantry on chains, swinging as you climb: up one side, over the top, down the other
  const M = mats(), top = H + 0.9;
  for (const s of [-1, 1]) { const x = s * (W / 2 + 0.4); k.post(x, 0, top, M.black, 0.16); k.beam(V(x, top * 0.5, 0), V(x, -0.1, -1.8), 0.1, M.black); k.beam(V(x, top * 0.5, 0), V(x, -0.1, 1.8), 0.1, M.black); }
  k.box(W + 1.2, 0.16, 0.16, M.black, 0, top, 0);
  const lad = new THREE.Group(); lad.position.y = top; k.g.add(k.keep(lad));
  for (const s of [-1, 1]) chain(k, V(s * 1.8, top, 0), V(s * 1.8, H + 0.1, 0));
  const L = new THREE.Group(); L.position.y = -(top - H); lad.add(L);
  for (const s of [-1, 1]) { const rail = new THREE.Mesh(metricUV(new THREE.BoxGeometry(0.1, H - 0.4, 0.14)), M.timber); rail.position.set(s * (W / 2 - 0.3), -(H - 0.4) / 2, 0); L.add(rail); }
  for (let y = -0.2; y > -(H - 0.4); y -= 0.42) { const rung = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, W - 0.6, 10), M.timber); rung.rotation.z = Math.PI / 2; rung.position.y = y; L.add(rung); }
  lad.rotation.x = 0.18;
  k.dyn.push((dt, t) => { lad.rotation.x = 0.18 + Math.sin(t * 0.8) * 0.04; });
  k.collide(-W / 2 - 0.4, 0, 0.2, 0.3); k.collide(W / 2 + 0.4, 0, 0.2, 0.3);
  return { shape: 'frame', H: H - 0.3, D1: 0.6, D2: 0.6, lanes: [-1.2, 0, 1.2], dur: 3.4 + H * 0.4, from: -2, to: 3 };
}

// ---------------------------------------------------------------- rigs (black steel, things to swing on)
function rigFrame(k, L, H) {
  const M = mats(), n = Math.max(2, Math.round(L / 3));
  for (let i = 0; i <= n; i++) {
    const z = -L / 2 + (i * L) / n;
    for (const s of [-1, 1]) { k.post(s * 1.1, z, H + 0.25, M.black, 0.12); if (i === 0 || i === n) k.beam(V(s * 1.1, H * 0.6, z), V(s * 1.1, -0.1, z + (i ? 1.3 : -1.3)), 0.09, M.black); }
    k.box(2.4, 0.1, 0.1, M.black, 0, H + 0.25, z);
  }
  for (const s of [-1, 1]) k.box(0.1, 0.1, L, M.black, s * 1.1, H + 0.25, 0);
  k.box(1.6, 0.35, 0.5, M.timber, 0, 0.17, -L / 2 - 0.6);                    // the step up to the first grip
  for (const s of [-1, 1]) k.collide(s * 1.1, 0, 0.15, L / 2 + 0.2);
}
function monkeyBars(k, L, H) {
  const M = mats(); rigFrame(k, L, H + 0.35);
  const y = (z) => H + 0.35 * Math.cos(Math.PI * z / L);                      // up then down
  for (const s of [-0.45, 0.45]) for (let z = -L / 2; z < L / 2 - 0.1; z += 0.5) k.pipe(V(s, y(z), z), V(s, y(z + 0.5), z + 0.5), 0.04, M.steel, 8);
  for (let z = -L / 2 + 0.25; z < L / 2; z += 0.4) k.pipe(V(-0.45, y(z), z), V(0.45, y(z), z), 0.022, M.steel, 10);
  for (let z = -L / 2; z <= L / 2; z += L / 2) for (const s of [-0.45, 0.45]) k.pipe(V(s, y(z), z), V(s * 2.44, H + 0.6, z), 0.03, M.black, 6);
  return { shape: 'rig', hang: H + 0.2, L, lanes: [0], dur: 1.5 + L * 0.5, from: -L / 2 - 1.5, to: L / 2 + 2 };
}
function rings(k, L, H, mix) {
  const M = mats(); rigFrame(k, L, H + 0.8);
  const n = Math.round(L / 0.85);
  for (let i = 0; i < n; i++) {
    const z = -L / 2 + 0.5 + i * (L - 1) / (n - 1), kind = mix[i % mix.length], g = new THREE.Group();
    g.position.set(0, H + 1.0, z); k.g.add(k.keep(g));
    if (kind === 'twister') continue;
    const len = kind === 'pipe' ? 0.55 : 0.7;
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, len, 5), kind === 'chainbar' ? M.chain : M.rope); strap.position.y = -len / 2; g.add(strap);
    if (kind === 'ring') { const r = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.022, 8, 18), M.yellow); r.position.y = -len - 0.1; g.add(r); }
    else if (kind === 'pipe') { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.45, 10), M.red); p.position.y = -len - 0.22; g.add(p); }
    else { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 10), M.steel); b.rotation.z = Math.PI / 2; b.position.y = -len; g.add(b); }
    const ph = i * 0.9;
    k.dyn.push((dt, t) => { g.rotation.x = Math.sin(t * 1.6 + ph) * 0.06; });
  }
  if (mix.includes('twister')) {
    // the twister: a turning tube along the second half with handles in a spiral
    const T = new THREE.Group(); T.position.set(0, H + 0.6, L / 4); k.g.add(k.keep(T));
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, L / 2 - 0.4, 14), M.steel); tube.rotation.x = Math.PI / 2; T.add(tube);
    for (let i = 0; i < 10; i++) { const a = i * 0.9, z = -L / 4 + 0.4 + i * (L / 2 - 0.8) / 9; const h = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 8), M.yellow); h.position.set(Math.cos(a) * 0.2, Math.sin(a) * 0.2, z); h.rotation.z = a + Math.PI / 2; T.add(h); }
    k.pipe(V(0, H + 0.6, 0.1), V(0, H + 1.05, 0.1), 0.04, M.black); k.pipe(V(0, H + 0.6, L / 2 - 0.1), V(0, H + 1.05, L / 2 - 0.1), 0.04, M.black);
    k.dyn.push((dt, t) => { T.rotation.z = t * 0.25; });
  }
  return { shape: 'rig', hang: H + 0.15, L, lanes: [0], dur: 1.5 + L * 0.5, from: -L / 2 - 1.5, to: L / 2 + 2 };
}
function apeHanger(k) {
  const M = mats(), L = 6, H = 3.3;
  rigFrame(k, L, H + 0.3);
  for (let z = -L / 2 + 0.6; z < L / 2; z += 0.45) k.pipe(V(-0.45, H + 0.2, z), V(0.45, H + 0.2, z), 0.022, M.steel, 10);
  for (const s of [-0.45, 0.45]) k.pipe(V(s, H + 0.2, -L / 2 + 0.4), V(s, H + 0.2, L / 2), 0.04, M.steel, 8);
  k.rope(V(0, H + 0.5, -L / 2 + 0.3), V(0, 0.2, -L / 2 + 0.3), 0, 0.022);          // up the rope to the bars
  mudPit(k, 3, L + 1, 0, true);
  return { shape: 'rig', hang: H + 0.05, L, lanes: [0], dur: 2 + L * 0.55, from: -L / 2 - 1.5, to: L / 2 + 2, climbIn: true };
}
function tyrolean(k) {
  const M = mats(), L = 12, y0 = 2.5, y1 = 2.2;
  for (const [z, y] of [[-L / 2, y0], [L / 2, y1]]) {
    for (const s of [-1, 1]) k.beam(V(s * 0.8, -0.3, z), V(0, y + 0.4, z), 0.2, M.timber);
    k.box(0.3, 0.3, 0.3, M.timber, 0, y + 0.3, z);
    k.beam(V(0, y + 0.3, z), V(0, -0.2, z + Math.sign(z) * 2.4), 0.14, M.timber);
  }
  k.rope(V(0, y0 + 0.2, -L / 2), V(0, y1 + 0.2, L / 2), 0.3, 0.024);
  bell(k, 0.25, y1 + 0.75, L / 2 - 0.3);
  mudPit(k, 3.6, L - 1.5, 0, true);
  for (const z of [-L / 2, L / 2]) { k.collide(0, z, 0.9, 0.3); }
  return { shape: 'tyrolean', y0: y0 + 0.2, y1: y1 + 0.2, sag: 0.3, L, lanes: [0], dur: 2.5 + L * 0.45, from: -L / 2 - 1.5, to: L / 2 + 2 };
}

// ---------------------------------------------------------------- traverses
function zWall(k) {
  // three panels in a zig-zag along the trail; you go sideways across their face on blocks, then ring the bell
  const M = mats(), H = 2.4, P = 3.0, a = 0.42, x0 = 1.0;
  const panels = [[-P * Math.cos(a) * 1, -a], [0, a], [P * Math.cos(a), -a]];
  for (const [zc, ry] of panels) {
    const g = new THREE.Group(); g.position.set(x0, 0, zc); g.rotation.y = ry; k.g.add(g);
    k.box(0.08, H, P, M.planks, 0, H / 2 + 0.1, 0, 0, 0, 0, g);
    for (const z of [-P / 2, P / 2]) k.box(0.16, H + 0.7, 0.16, M.timber, 0.12, (H + 0.7) / 2 - 0.4, z, 0, 0, 0, g);
    k.box(0.06, 0.12, P, M.timber, 0.06, H + 0.16, 0, 0, 0, 0, g);
    const rr = rngOf(Math.round(zc * 10 + 99));
    for (let i = 0; i < 9; i++) { const hz = -P / 2 + 0.25 + rr() * (P - 0.5); k.box(0.07, 0.07, 0.14, M.holds[Math.floor(rr() * 6)], -0.07, 1.6 + rr() * 0.6, hz, 0, 0, rr() * 0.6, g); }   // hand holds
    for (let i = 0; i < 6; i++) { const hz = -P / 2 + 0.25 + rr() * (P - 0.5); k.box(0.1, 0.06, 0.18, M.timber, -0.08, 0.35 + rr() * 0.25, hz, 0, 0, 0, g); }             // foot blocks
    k.collide(x0, zc, 0.6, P / 2 * Math.cos(a) + 0.1);
  }
  const end = P * Math.cos(a) * 1.5 + 0.3;
  k.post(x0 - 0.6, end, 2.8, M.black, 0.1); k.box(0.5, 0.06, 0.06, M.steel, x0 - 0.85, 2.7, end); bell(k, x0 - 1.05, 2.65, end);
  const L = P * Math.cos(a) * 3;
  return { shape: 'traverse', L, lat: x0 - 0.5, face: Math.PI / 2, up: 0.35, zig: { a, P, x0 }, lanes: [x0 - 0.5], dur: 2 + L * 0.55, from: -L / 2 - 1.5, to: L / 2 + 2.5 };
}
function olympus(k) {
  // a long wall leaning away from you: holes, chains and climbing holds to get sideways across without touching the ground
  const M = mats(), H = 2.6, L = 7, lean = 0.3, x0 = 1.2, g = new THREE.Group();
  g.position.set(x0, 0, 0); g.rotation.z = -lean; k.g.add(g);
  k.box(0.1, H, L, M.planks, 0, H / 2, 0, 0, 0, 0, g);
  const rr = rngOf(5);
  for (let i = 0; i < 14; i++) { const z = -L / 2 + 0.4 + i * (L - 0.8) / 13, y = 0.9 + (i % 3) * 0.5; const h = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), M.hole); h.position.set(-0.052, y, z); h.rotation.y = -Math.PI / 2; g.add(h); }
  for (let i = 0; i < 6; i++) { const z = -L / 2 + 0.8 + i * (L - 1.6) / 5; chain(k, V(x0 - Math.sin(lean) * H - 0.05, H * Math.cos(lean), z), V(x0 - Math.sin(lean) * 1.3 - 0.06, 1.3 * Math.cos(lean), z), 0.03); }
  for (let i = 0; i < 12; i++) k.box(0.08, 0.08, 0.14, M.holds[Math.floor(rr() * 6)], -0.08, 0.8 + rr() * 1.4, -L / 2 + 0.3 + rr() * (L - 0.6), 0, 0, 0, g);
  for (const z of [-L / 2, 0, L / 2]) k.beam(V(x0 + 0.1, -0.2, z), V(x0 + 1.1, H * 0.9, z), 0.14, M.timber);  // the props behind
  k.collide(x0 + 0.4, 0, 0.6, L / 2 + 0.1);
  return { shape: 'traverse', L, lat: x0 - 0.75, face: Math.PI / 2, up: 0.4, lanes: [x0 - 0.75], dur: 2 + L * 0.55, from: -L / 2 - 1.5, to: L / 2 + 2 };
}
function spider(k) {
  const M = mats(), L = 4, H = 1.9;
  for (const s of [-1, 1]) { k.box(0.08, H, L, M.planks, s * 0.58, H / 2, 0); for (const z of [-L / 2, 0, L / 2]) { k.post(s * 0.72, z, H + 0.2, M.timber, 0.14); k.beam(V(s * 0.72, H * 0.7, z), V(s * 1.6, -0.1, z), 0.1, M.timber); } }
  for (const s of [-1, 1]) k.collide(s * 0.62, 0, 0.12, L / 2);
  return { shape: 'spider', L, up: 0.7, lanes: [0], dur: 4, from: -L / 2 - 1.5, to: L / 2 + 2 };
}

// ---------------------------------------------------------------- strength
function hoist(k, kids) {
  const M = mats(), top = kids ? 3.2 : 5, xs = kids ? [-0.8, 0.8] : [-1.4, 0, 1.4], wy = [];
  for (const s of [-1, 1]) { const x = s * (W / 2 + 0.2); k.post(x, 0.6, top, M.black, 0.16); k.beam(V(x, top * 0.5, 0.6), V(x, -0.1, 2.2), 0.1, M.black); k.beam(V(x, top * 0.5, 0.6), V(x, -0.1, -0.8), 0.1, M.black); }
  k.box(W + 0.8, 0.18, 0.18, M.black, 0, top, 0.6);
  k.box(W, 0.9, 0.08, M.planks, 0, 0.45, 0); for (const x of [-W / 2, 0, W / 2]) k.post(x, 0, 0.95, M.timber, 0.12);   // the barrier you mustn't climb
  for (const x of xs) {
    const pul = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.035, 8, 16), M.steel); pul.position.set(x, top - 0.25, 0.6); pul.rotation.y = Math.PI / 2; k.g.add(pul);
    const wgt = new THREE.Group(); wgt.position.set(x, 0.3, 0.6); k.g.add(k.keep(wgt));
    const bag = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.55, 14), M.canvas); wgt.add(bag);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.02, 6, 16), M.red); strap.rotation.x = Math.PI / 2; wgt.add(strap);
    const up = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 1, 6), M.rope); wgt.add(up); // its rope up to the pulley (stretched as it rises)
    k.rope(V(x, top - 0.25, 0.48), V(x, 1.0, -1.1), 0.25, 0.016);                // the rope down to you
    wy.push({ wgt, up, top: top - 0.37 });
  }
  const st = { u: 0 };
  const place = () => { wy.forEach((w, i) => { const y = 0.3 + (i === Math.floor(wy.length / 2) || wy.length === 2 && i === 0 ? st.u : 0) * (w.top - 1.0); w.wgt.position.y = y; const L = Math.max(0.05, w.top - y - 0.28); w.up.scale.y = L; w.up.position.y = 0.28 + L / 2; }); };
  place();
  k.dyn.push((dt) => place());
  k.collide(0, 0.3, W / 2 + 0.3, 0.6);
  return { shape: 'hoist', lanes: kids ? [-0.8] : [0], state: st, dur: 3.2, from: -1.6, to: 4.5 };
}
function carryPile(k, name) {
  const M = mats(), n = name.toUpperCase(), rr = rngOf(n.length * 31);
  const pad = new THREE.PlaneGeometry(W, 3); pad.rotateX(-Math.PI / 2); k.add(pad, M.mud, 0, 0.04, 0);
  if (/LOG/.test(n)) { for (let i = 0; i < 9; i++) log(k, -1.4 + (i % 3) * 1.4, 0.16 + Math.floor(i / 3) * 0.28, -0.3 + (rr() - 0.5) * 0.2, 1.2, 0.13 + rr() * 0.03, 0, Math.PI / 2); }
  else if (/BUCKET/.test(n)) {
    const mound = new THREE.ConeGeometry(1.3, 0.8, 18, 1, false); k.add(mound, M.gravel, -1, 0.4, 0);
    for (let i = 0; i < 8; i++) { const x = 0.4 + (i % 4) * 0.5, z = i < 4 ? -0.4 : 0.4; k.add(new THREE.CylinderGeometry(0.17, 0.14, 0.36, 14), M.bucket, x, 0.18, z); const h = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.008, 4, 12, Math.PI), M.steel); h.position.set(x, 0.36, z); k.g.add(h); }
  } else if (/ATLAS/.test(n)) { for (let i = 0; i < 3; i++) { const x = -1.4 + i * 1.4; k.add(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20), M.rubber, x, 0.02, 0); k.add(new THREE.SphereGeometry(i === 1 ? 0.26 : 0.22, 22, 16), M.concrete, x, i === 1 ? 0.28 : 0.24, 0); } }
  else if (/CHAIN/.test(n)) { for (let c = 0; c < 4; c++) { const z = -0.6 + c * 0.4; chain(k, V(-1.6, 0.04, z), V(1.6, 0.04, z + (rr() - 0.5) * 0.3), 0.045); } }
  else if (/PLATE/.test(n)) { for (let i = 0; i < 3; i++) { const x = -1.4 + i * 1.4; k.add(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 22), M.steel, x, 0.03, 0); k.add(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 10), M.black, x, 0.1, 0); k.rope(V(x, 0.12, 0), V(x, 0.05, -2.2), 0.02, 0.015); } }
  else if (/TIRE/.test(n)) { for (let i = 0; i < 3; i++) { const x = -1.4 + i * 1.4; k.add(new THREE.TorusGeometry(0.32, 0.12, 10, 20), M.rubber, x, 0.12, 0, Math.PI / 2); k.rope(V(x, 0.15, -0.3), V(x, 0.05, -2.2), 0.02, 0.015); } }
  else { // sandbags on a pallet
    k.box(1.4, 0.12, 1.1, M.timber, -0.8, 0.06, 0);
    for (let i = 0; i < 6; i++) { const b = k.add(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 18), M.canvas, -1.1 + (i % 2) * 0.6, 0.2 + Math.floor(i / 2) * 0.16, 0); b.scale.set(1, 1, 0.7); k.box(0.62, 0.025, 0.08, M.red, b.position.x, b.position.y + 0.08, 0); }
    for (let i = 0; i < 4; i++) { const b = k.add(new THREE.CylinderGeometry(0.3, 0.3, 0.16, 18), M.canvas, 0.8 + (i % 2) * 0.7, 0.08, i < 2 ? -0.4 : 0.4); b.scale.set(1, 1, 0.7); }
  }
  flagPole(k, -W / 2 - 0.4, 0, true); flagPole(k, W / 2 + 0.4, 0, false);
  return { shape: 'carry', lanes: [-1.4, 0, 1.4], dur: 5, from: -2, to: 7 };
}

// ---------------------------------------------------------------- crawls, balance, jumps
function barbedWire(k, L) {
  const M = mats();
  mudPit(k, W + 0.4, L + 1);
  const rows = Math.round(L / 1.6);
  for (let i = 0; i <= rows; i++) { const z = -L / 2 + i * (L / rows); for (const x of [-W / 2, -W / 6, W / 6, W / 2]) k.post(x, z, 0.62, M.weathered, 0.08); }
  for (let i = 0; i <= rows; i++) { const z = -L / 2 + i * (L / rows); k.pipe(V(-W / 2, 0.6, z), V(W / 2, 0.6, z), 0.004, M.wire, 4); }
  for (const x of [-W / 2, -W / 3, -W / 6, 0, W / 6, W / 3, W / 2]) {
    k.pipe(V(x, 0.6, -L / 2), V(x, 0.6, L / 2), 0.004, M.wire, 4);
    for (let z = -L / 2 + 0.15; z < L / 2; z += 0.3) { k.pipe(V(x - 0.03, 0.58, z - 0.02), V(x + 0.03, 0.62, z + 0.02), 0.003, M.wire, 3); k.pipe(V(x + 0.03, 0.58, z - 0.02), V(x - 0.03, 0.62, z + 0.02), 0.003, M.wire, 3); }
  }
  for (const s of [-1, 1]) k.collide(s * (W / 2 + 0.05), 0, 0.1, L / 2);
  return { shape: 'crawl', L, lanes: [-1.4, -0.4, 0.6, 1.5], dur: 2 + L * 0.35, from: -L / 2 - 1.5, to: L / 2 + 2 };
}
function crawlNet(k, L) {
  const M = mats(); mudPit(k, W, L + 1);
  for (let z = -L / 2; z <= L / 2; z += L / 3) for (const x of [-W / 2, 0, W / 2]) k.post(x, z, 0.5, M.timber, 0.06);
  const old = k.net; k.net = 0.25;
  k.netQuad(V(-W / 2, 0.5, -L / 2), V(W / 2, 0.5, -L / 2), V(-W / 2, 0.5, L / 2), V(W / 2, 0.5, L / 2), 0.12, V(0, -1, 0));
  k.net = old;
  return { shape: 'crawl', L, lanes: [-1.2, 0, 1.2], dur: 2 + L * 0.35, from: -L / 2 - 1.5, to: L / 2 + 2 };
}
function balanceBeams(k, kids) {
  const M = mats(), n = 4, segL = 2.2, h = kids ? 0.3 : 0.45, zig = [];
  for (let i = 0; i < n; i++) {
    const z0 = -n * segL / 2 + i * segL, x0 = (i % 2 ? 0.35 : -0.35), x1 = (i % 2 ? -0.35 : 0.35);
    k.beam(V(x0, h, z0), V(x1, h, z0 + segL), 0.11, M.timber);
    log(k, x0, h / 2 - 0.05, z0, 0.6, h / 2, 0, Math.PI / 2);
    zig.push([z0, x0, z0 + segL, x1]);
  }
  log(k, zig[n - 1][3], h / 2 - 0.05, n * segL / 2, 0.6, h / 2, 0, Math.PI / 2);
  return { shape: 'balance', up: h + 0.06, zig, L: n * segL, lanes: [0], dur: 1.5 + n * segL * 0.4, from: -n * segL / 2 - 1.5, to: n * segL / 2 + 2 };
}
function slackline(k) {
  const M = mats(), L = 9, h = 0.55;
  for (const z of [-L / 2, L / 2]) { for (const s of [-1, 1]) k.beam(V(s * 0.6, -0.3, z), V(0, 1.1, z), 0.14, M.timber); for (const s of [-1, 1]) k.beam(V(s * 1.6, -0.3, z), V(s * 1.6, 2.3, z), 0.12, M.timber); k.box(3.3, 0.12, 0.12, M.timber, 0, 2.3, z); }
  const strap = k.rope(V(0, h + 0.15, -L / 2), V(0, h + 0.15, L / 2), 0.1, 0.012, M.webbing); strap.scale.x = 3; // flat webbing
  k.rope(V(0, 2.25, -L / 2), V(0, 2.25, L / 2), 0.08, 0.016);                       // a hand line overhead
  mudPit(k, 2.4, L - 1);
  return { shape: 'balance', up: h, L, lanes: [0], dur: 1.5 + L * 0.45, from: -L / 2 - 1.5, to: L / 2 + 2 };
}
function hurdles(k, name, kids) {
  const M = mats(), n = name.toUpperCase(), seq = [];
  if (/FIRE/.test(n)) {
    for (const z of [-1.5, 1.5]) {
      for (let i = 0; i < 5; i++) log(k, -1.8 + i * 0.9, 0.12, z + (i % 2 ? 0.08 : -0.08), 0.85, 0.11, Math.PI / 2 + (i % 2 ? 0.3 : -0.3), Math.PI / 2, true);
      for (let i = 0; i < 9; i++) {
        const f = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 1.25), M.flame); f.position.set(-2 + i * 0.5, 0.45, z); k.g.add(k.keep(f));
        const ph = Math.random() * 6, f2 = f.clone(); f2.rotation.y = Math.PI / 2; f2.position.x += 0.1; k.g.add(k.keep(f2));
        k.dyn.push((dt, t, cam) => { const s = 0.75 + 0.35 * Math.abs(Math.sin(t * 9 + ph)) + 0.15 * Math.sin(t * 23 + ph * 3); f.scale.set(1, s, 1); f.position.y = 0.2 + 0.62 * s; f2.scale.copy(f.scale); f2.position.y = f.position.y; if (cam) f.rotation.y = Math.atan2(cam.x - f.getWorldPosition(_w).x, cam.z - _w.z) - k.g.rotation.y; });
      }
      for (let i = 0; i < 4; i++) {
        const s = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), M.smoke); k.g.add(k.keep(s)); const ph = i / 4, x = -1.5 + i;
        k.dyn.push((dt, t) => { const q = (t * 0.25 + ph) % 1; s.position.set(x + q * 0.6, 0.9 + q * 3.5, z); s.scale.setScalar(0.6 + q * 2.2); s.material.opacity = 1; s.visible = true; s.rotation.z = q * 2; });
      }
      seq.push({ z, type: 'jump', h: 0.95 });
    }
    return { shape: 'hurdles', seq, lanes: [-1, 0, 1], dur: 2.4, from: -4, to: 4.5 };
  }
  if (/HAYS/.test(n)) {
    for (let i = 0; i < 4; i++) { hayBale(k, -1.5 + i, 0, 0, 0.95, 0.4, 0.5); if (i % 2 === 0) hayBale(k, -1 + i, 0.4, 0, 0.95, 0.4, 0.5); }
    k.collide(0, 0, 2.1, 0.3);
    return { shape: 'hurdles', seq: [{ z: 0, type: 'jump', h: 0.85 }], lanes: [-1, 0, 1], dur: 2, from: -3, to: 3.5 };
  }
  if (/OUOU|OUT/.test(n)) {
    // over, under, through: a low wall to go over, a high board to go under, a wall with a window to go through
    const plan = /OUOU/.test(n) ? ['over', 'under', 'over', 'under'] : ['over', 'under', 'through'];
    plan.forEach((t, i) => {
      const z = -2.4 + i * 1.9;
      for (const s of [-1, 1]) k.post(s * (W / 2 - 0.1), z, 2.3, M.timber, 0.16);
      if (t === 'over') k.box(W - 0.3, 1.05, 0.07, M.planks, 0, 0.525, z);
      else if (t === 'under') { k.box(W - 0.3, 1.2, 0.07, M.planks, 0, 1.0 + 0.6, z); k.box(W + 0.2, 0.14, 0.14, M.timber, 0, 2.27, z); }
      else { k.box(W - 0.3, 0.6, 0.07, M.planks, 0, 0.3, z); k.box(W - 0.3, 0.75, 0.07, M.planks, 0, 1.85, z); for (const x of [-1.85, -0.5, 0.5, 1.85]) k.box(x === -1.85 || x === 1.85 ? 0.6 : 0.6, 0.85, 0.07, M.planks, x, 1.025, z); } // windows between
      seq.push({ z, type: t, h: t === 'through' ? 0.62 : 1.05 });
    });
    k.collide(-W / 2 + 0.1, 0, 0.15, 3); k.collide(W / 2 - 0.1, 0, 0.15, 3);
    return { shape: 'hurdles', seq, lanes: [-1.15, 0, 1.15], dur: 1.4 + plan.length * 0.9, from: -4.2, to: seq[seq.length - 1].z + 3.5 };
  }
  // hurdles: heavy timber hurdles you vault
  const h = kids ? 0.7 : 1.15;
  for (const z of [-3, 0, 3]) { for (const s of [-1, 1]) k.post(s * (W / 2 - 0.1), z, h, M.timber, 0.16); k.box(W - 0.2, 0.2, 0.2, M.timber, 0, h - 0.1, z); k.box(W - 0.2, 0.12, 0.08, M.timber, 0, h * 0.45, z); seq.push({ z, type: 'jump', h: h + 0.05 }); }
  return { shape: 'hurdles', seq, lanes: [-1.4, 0, 1.4], dur: 2.6, from: -4.5, to: 5 };
}

// ---------------------------------------------------------------- throwing, memory, the bell
function spearThrow(k, laser, kids) {
  const M = mats(), xs = [-1.6, 0, 1.6], dist = kids ? 4 : 8;
  k.box(W + 1.2, 0.06, 0.06, M.rope, 0, 0.9, -0.4); for (const x of [-W / 2 - 0.6, 0, W / 2 + 0.6]) k.post(x, -0.4, 0.95, M.timber, 0.08); // the throwing line
  for (const x of xs) {
    if (laser) {
      k.box(0.9, 0.05, 0.5, M.timber, x, 1.0, -0.8); k.post(x, -0.8, 0.98, M.black, 0.08);
      k.box(0.18, 0.1, 0.04, M.black, x, 1.08, -0.75);
      for (let i = 0; i < 5; i++) { const t = k.add(new THREE.CircleGeometry(0.12, 20), M.target, x - 0.5 + i * 0.25, 1.4, dist - 0.06, 0, Math.PI); }
      k.box(1.4, 1.2, 0.06, M.white, x, 1.3, dist); k.post(x - 0.6, dist + 0.04, 1.9, M.black, 0.06); k.post(x + 0.6, dist + 0.04, 1.9, M.black, 0.06);
    } else if (kids) {
      k.cyl(0.03, 1.6, M.steel, x, 0.8, dist, 0, 0, 0, 8); const hoop = k.add(new THREE.TorusGeometry(0.3, 0.03, 8, 20), M.red, x, 1.6, dist - 0.05);
      k.add(new THREE.CylinderGeometry(0.17, 0.14, 0.3, 14), M.bucket, x + 0.4, 0.15, -0.8); for (let i = 0; i < 3; i++) k.add(new THREE.SphereGeometry(0.08, 10, 8), M.yellow, x + 0.3 + i * 0.12, 0.3, -0.8);
    } else {
      // a hay bale target on a stand, the spear on a rope
      hayBale(k, x, 1.0, dist, 0.6, 0.9, 0.5, 0); k.box(0.8, 0.06, 0.6, M.timber, x, 0.98, dist); for (const s of [-1, 1]) k.post(x + s * 0.35, dist, 1, M.timber, 0.08);
      const fig = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.7), M.target); fig.position.set(x, 1.5, dist - 0.26); fig.rotation.y = Math.PI; k.g.add(fig);
      k.box(0.7, 0.9, 0.06, M.timber, x + 0.5, 0.6, -0.9);                                  // the rack
      const sp = new THREE.Group(); sp.position.set(x + 0.5, 1.15, -0.85); sp.rotation.x = 0.2; k.g.add(sp);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 1.7, 8), M.timber); shaft.position.y = 0; sp.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.18, 8), M.steel); tip.position.y = 0.93; sp.add(tip);
      k.rope(V(x + 0.5, 0.4, -0.86), V(x, 0.05, -0.2), 0.05, 0.008);
    }
  }
  return { shape: 'aim', lanes: [0], target: dist, dur: 2.4, from: -0.9, to: 4 };
}
function memoryBoard(k, test) {
  const M = mats();
  for (const s of [-1, 1]) k.post(s * 1.45, 0, 2.7, M.timber, 0.15);
  const b = k.add(new THREE.PlaneGeometry(2.6, 2.0), test ? M.white : M.words, 0, 1.75, -0.03, 0, Math.PI);
  k.box(2.7, 2.1, 0.05, M.planks, 0, 1.75, 0.01);
  if (test) { k.box(2.4, 0.4, 0.04, M.red, 0, 2.5, -0.05); }
  k.collide(0, 0, 1.6, 0.2);
  return { shape: 'through', lanes: [0], dur: 1, from: -2, to: 3 };
}
function iconicBell(k) {
  const M = mats(), H = 4.2;
  for (const s of [-1, 1]) { k.post(s * 2.6, 0, H, M.black, 0.3); k.box(0.5, 0.5, 0.5, M.concrete, s * 2.6, 0.2, 0); }
  k.box(5.8, 0.35, 0.35, M.black, 0, H, 0); k.box(5.8, 0.06, 0.37, M.red, 0, H - 0.12, 0);
  bell(k, 0, H - 0.25, 0, true);
  k.rope(V(0.1, H - 0.7, 0), V(0.3, 1.4, -0.4), 0.05, 0.014);
  for (const [x, z, r] of [[-3.4, -1, 1], [3.4, -1, 0], [-3.4, 1, 0], [3.4, 1, 1]]) flagPole(k, x, z, r);
  k.collide(-2.6, 0, 0.3, 0.3); k.collide(2.6, 0, 0.3, 0.3);
  return { shape: 'bell', lanes: [0], dur: 2.4, from: -1.5, to: 4 };
}

const _w = new THREE.Vector3();

/** Builds one obstacle from its name (and kind, from obstacleKind in course-world). */
export function buildObstacle(name, kind, { kids = false, low = false } = {}) {
  const k = new Kit(), n = name.toUpperCase();
  if (low) k.net = 0.45;
  const ft = (x) => (kids ? Math.min(x, 5) * 0.8 : x) * FT;
  let spec;
  if (kind === 'climb') {
    const m = n.match(/\b([6-9])\s*WALL|WALL\s*([6-9])|^([6-9])WALL/);
    const wallFt = m ? +(m[1] || m[2] || m[3]) : 0;
    if (/Z WALL/.test(n)) spec = zWall(k);
    else if (/OLYMPUS/.test(n)) spec = olympus(k);
    else if (/SPIDER/.test(n)) spec = spider(k);
    else if (/INVERTED/.test(n)) spec = wall(k, ft(7), { inverted: true, kids });
    else if (/HANGING/.test(n)) spec = wall(k, ft(7), { hanging: true, kids });
    else if (/SLIP/.test(n)) spec = slipWall(k, kids ? 1.5 : 2.3);
    else if (/STAIRWAY/.test(n)) spec = stairway(k, kids ? 1.6 : 2.6);
    else if (/BENDER/.test(n)) spec = bender(k, 4.3);
    else if (/TILTING|LADDER/.test(n)) spec = ladderTilt(k, 4.2);
    else if (/VERTICAL CARGO|CLIMBING NET/.test(n)) spec = verticalNet(k, /CLIMBING/.test(n) ? 4 : 4.8);
    else if (/CASCADE/.test(n)) spec = cascadeNet(k, 3.4);
    else if (/A FRAME/.test(n)) spec = aFrame(k, kids ? 2 : /SMALL/.test(n) ? 2.7 : 4);
    else if (/ROPE/.test(n)) spec = ropeClimb(k, kids ? 3 : 4.6, kids);
    else spec = wall(k, ft(wallFt || (kids ? 4 : 6)), { kids });
    if (/^STAIRWAY$|^SLIP WALL$|^A FRAME$|^WALL$/.test(n) && kids) spec.kids = true;
  } else if (kind === 'rig') {
    if (/TYROLEAN/.test(n)) spec = tyrolean(k);
    else if (/APE/.test(n)) spec = apeHanger(k);
    else if (/MONKEY/.test(n)) spec = monkeyBars(k, 7, 2.3);
    else if (/BENDER/.test(n)) spec = bender(k, 4.3);
    else if (/SPIDER/.test(n)) spec = spider(k);
    else if (/MULTIRING|TWISTER/.test(n)) spec = rings(k, 10, 2.1, ['ring', 'ring', 'pipe', 'ring', 'ring', 'twister', 'twister', 'twister', 'twister', 'twister', 'twister']);
    else if (/HYDRA/.test(n)) spec = rings(k, 9, 2.1, ['pipe', 'ring', 'chainbar', 'pipe', 'ring', 'chainbar']);
    else spec = rings(k, 8, 2.1, ['chainbar', 'ring', 'chainbar', 'pipe']); // Armer and the rest
  } else if (kind === 'hoist') spec = hoist(k, kids || /\bHH\b/.test(n));
  else if (kind === 'carry') spec = carryPile(k, name);
  else if (kind === 'crawl') spec = /NET/.test(n) ? crawlNet(k, 6) : barbedWire(k, 10);
  else if (kind === 'balance') spec = /SLACK/.test(n) ? slackline(k) : balanceBeams(k, kids || /BEAM/.test(n));
  else if (kind === 'aim') spec = spearThrow(k, /LASER/.test(n), /BALL/.test(n));
  else if (kind === 'hurdle') spec = hurdles(k, name, kids);
  else if (kind === 'bell') spec = iconicBell(k);
  else spec = memoryBoard(k, kind === 'memoryTest');
  k.finish();
  // the trampled ground around it
  const half = Math.max(W / 2 + 1.2, ...k.col.map((c) => Math.abs(c.x) + c.hx + 0.8)), len = Math.max(4, ...k.col.map((c) => Math.abs(c.z) + c.hz + 1.5), (spec.L || 0) / 2 + 2);
  const t0 = performance.now() / 1000;
  return {
    group: k.g, colliders: k.col, spec, half, len, bells: k.bells || [],
    tick(dt, cam) { const t = performance.now() / 1000 - t0; for (const f of k.dyn) f(dt, t, cam); },
  };
}

/**
 * Where a runner is u (0..1) of the way through an obstacle: along (m from its centre, along the course), lat
 * (m across), up (m above the ground), face (turn from the course direction) and pose.
 */
export function act(spec, u, lane = 0) {
  let along = spec.from + (spec.to - spec.from) * u, up = 0, lat = lane, pose = null, face = 0;
  switch (spec.shape) {
    case 'wall': {
      const H = spec.H, reach = Math.max(0, H - 1.15);
      if (u < 0.12) along = spec.from + (-0.35 - spec.from) * ease(seg(u, 0, 0.12));
      else if (u < 0.48) { along = -0.35; up = reach * ease(seg(u, 0.12, 0.48)); pose = 'climb'; }
      else if (u < 0.6) { const o = seg(u, 0.48, 0.6); along = -0.35 + 0.7 * o; up = reach + 0.55 * Math.sin(o * Math.PI); pose = 'climb'; }
      else if (u < 0.72) { const d = seg(u, 0.6, 0.72); along = 0.35 + 0.3 * d; up = reach * (1 - d * d); pose = 'jump'; }
      else along = 0.65 + (spec.to - 0.65) * seg(u, 0.72, 1);
      break;
    }
    case 'slip': {
      const D = spec.D;
      if (u < 0.1) along = spec.from + (-D - 0.3 - spec.from) * seg(u, 0, 0.1);
      else if (u < 0.55) { const c = ease(seg(u, 0.1, 0.55)); along = -D - 0.3 + (D + 0.2) * c; up = spec.H * c; pose = 'climb'; face = 0; }
      else if (u < 0.65) { along = -0.1 + 1.2 * seg(u, 0.55, 0.65); up = spec.H; }
      else if (u < 0.85) { const d = seg(u, 0.65, 0.85); along = 1.1 + 0.4 * d; up = spec.H * (1 - d); pose = 'climb'; face = Math.PI; }
      else along = 1.5 + (spec.to - 1.5) * seg(u, 0.85, 1);
      break;
    }
    case 'stair': {
      if (u < 0.1) along = spec.from + (-2.3 - spec.from) * seg(u, 0, 0.1);
      else if (u < 0.6) { const c = seg(u, 0.1, 0.6), s = c * 5; along = -2.3 + 2.5 * c; up = (Math.floor(s) + ease(s % 1)) * spec.H / 5; pose = 'climb'; }
      else if (u < 0.72) { const d = seg(u, 0.6, 0.72); along = 0.2 + 0.8 * d; up = spec.H * (1 - d * d); pose = 'jump'; }
      else along = 1 + (spec.to - 1) * seg(u, 0.72, 1);
      break;
    }
    case 'frame': {
      const { H, D1, D2 } = spec;
      if (u < 0.08) along = spec.from + (-D1 - spec.from) * seg(u, 0, 0.08);
      else if (u < 0.85) {
        const c = seg(u, 0.08, 0.85);
        along = -D1 + (D1 + D2) * c;
        up = along < 0 ? H * (1 + along / D1) : H * (1 - along / D2);
        up = Math.max(0, up - (along < 0 ? 0.25 : 0.25)); pose = 'climb'; face = along > 0.1 ? Math.PI : 0;
        along += along < 0 ? -0.35 : 0.35; // on the outside of the net, not in it
      } else along = D2 + 0.35 + (spec.to - D2 - 0.35) * seg(u, 0.85, 1);
      break;
    }
    case 'rope': {
      const top = spec.H - 0.4;
      along = -0.25;
      if (u < 0.08) along = spec.from + (-0.25 - spec.from) * seg(u, 0, 0.08);
      else if (u < 0.55) { up = top * ease(seg(u, 0.08, 0.55)); pose = 'hang'; }
      else if (u < 0.65) { up = top; pose = 'hang'; }
      else if (u < 0.85) { up = top * (1 - ease(seg(u, 0.65, 0.85))); pose = 'hang'; }
      else along = -0.25 + (spec.to + 0.25) * seg(u, 0.85, 1);
      break;
    }
    case 'traverse': {
      const L = spec.L, s0 = 0.12, s1 = 0.9;
      if (u < s0) { const a = seg(u, 0, s0); along = spec.from + (-L / 2 - spec.from) * a; lat = lane * a; }
      else if (u < s1) {
        const c = seg(u, s0, s1); along = -L / 2 + L * c; up = spec.up; pose = 'climb'; face = spec.face; lat = spec.lat;
        if (spec.zig) { // follow the zig-zag of the panels
          const { a, P, x0 } = spec.zig, segL = P * Math.cos(a), z = along + L / 2, i = Math.min(2, Math.floor(z / segL)), f = z / segL - i;
          const off = (i % 2 ? 1 : -1) * Math.sin(a) * P * (f - 0.5); lat = x0 - 0.5 + off; face = Math.PI / 2 + (i % 2 ? a : -a);
        }
      } else { const a = seg(u, s1, 1); along = L / 2 + (spec.to - L / 2) * a; lat = spec.lat * (1 - a); }
      break;
    }
    case 'spider': {
      if (u < 0.1) along = spec.from + (-spec.L / 2 - spec.from) * seg(u, 0, 0.1);
      else if (u < 0.9) { along = -spec.L / 2 + spec.L * seg(u, 0.1, 0.9); up = spec.up * Math.min(1, seg(u, 0.1, 0.2) * 3, (0.9 - u) * 10); pose = 'climb'; lat = 0; }
      else along = spec.L / 2 + (spec.to - spec.L / 2) * seg(u, 0.9, 1);
      break;
    }
    case 'rig': case 'tyrolean': {
      const L = spec.L, s0 = 0.1, s1 = 0.9;
      const hangAt = (z) => (spec.shape === 'rig' ? spec.hang - 1.7 : (spec.y0 + (spec.y1 - spec.y0) * (z / L + 0.5) - spec.sag * 4 * (0.25 - (z / L) * (z / L))) - 1.75);
      if (u < s0) { const a = seg(u, 0, s0); along = spec.from + (-L / 2 + 0.3 - spec.from) * a; up = a > 0.6 ? hangAt(-L / 2 + 0.3) * seg(a, 0.6, 1) : 0; pose = a > 0.6 ? 'hang' : null; }
      else if (u < s1) { along = -L / 2 + 0.3 + (L - 0.6) * seg(u, s0, s1); up = hangAt(along); pose = 'hang'; }
      else { const a = seg(u, s1, 1); along = L / 2 - 0.3 + (spec.to - L / 2 + 0.3) * a; up = a < 0.3 ? hangAt(L / 2 - 0.3) * (1 - a / 0.3) : 0; pose = a < 0.3 ? 'jump' : null; }
      lat = spec.shape === 'tyrolean' ? 0 : lane;
      break;
    }
    case 'hoist': along = u < 0.8 ? -1.6 : -1.6 + (spec.to + 1.6) * seg(u, 0.8, 1); pose = u < 0.8 ? 'climb' : null; if (u < 0.8) up = -0.4; break;
    case 'carry': pose = u > 0.08 && u < 0.95 ? 'carry' : null; break;
    case 'crawl': {
      const L = spec.L;
      if (u > 0.08 && u < 0.92) pose = 'crawl';
      along = u < 0.08 ? spec.from + (-L / 2 - 0.5 - spec.from) * seg(u, 0, 0.08) : u < 0.92 ? -L / 2 - 0.5 + (L + 1) * seg(u, 0.08, 0.92) : L / 2 + 0.5 + (spec.to - L / 2 - 0.5) * seg(u, 0.92, 1);
      break;
    }
    case 'balance': {
      const L = spec.L;
      if (u > 0.08 && u < 0.92) {
        along = -L / 2 + L * seg(u, 0.08, 0.92); up = spec.up; pose = 'balance'; lat = 0;
        if (spec.zig) for (const [z0, x0, z1, x1] of spec.zig) if (along >= z0 && along <= z1) lat = x0 + (x1 - x0) * (along - z0) / (z1 - z0);
      } else along = u < 0.08 ? spec.from + (-L / 2 - spec.from) * seg(u, 0, 0.08) : L / 2 + (spec.to - L / 2) * seg(u, 0.92, 1);
      break;
    }
    case 'hurdles': {
      for (const it of spec.seq) {
        const d = along - it.z;
        if (it.type === 'under') { if (Math.abs(d) < 0.8) { pose = 'crawl'; } }
        else if (Math.abs(d) < 0.75) { const b = Math.cos((d / 0.75) * Math.PI / 2); up = Math.max(up, (it.h + 0.05) * b); pose = it.type === 'jump' ? 'jump' : 'climb'; }
      }
      break;
    }
    case 'aim': pose = u < 0.35 ? 'throw' : null; along = u < 0.35 ? spec.from : spec.from + (spec.to - spec.from) * seg(u, 0.35, 1); break;
    case 'bell': up = u < 0.5 ? 0.9 * Math.sin(seg(u, 0, 0.5) * Math.PI) : 0; pose = u < 0.5 ? 'jump' : null; along = u < 0.5 ? -0.3 : -0.3 + (spec.to + 0.3) * seg(u, 0.5, 1); break;
    default: break;
  }
  return { along, up, lat, pose, face };
}
