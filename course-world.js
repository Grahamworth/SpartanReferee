// The course game's world: terrain, forests, buildings, roads, lakes and lifts
// from the course pack (Copernicus heights + OpenStreetMap), and the course
// itself (trail, tape, obstacles, arches, water stations, marshals).
// three.js r128 is loaded globally (vendor/three.min.js).
/* global THREE */
import { buildObstacle } from './course-obstacles.js?v=2';

export const M_LAT = 111320;
export const TRAIL_W = 4.2; // the running lane between the tapes (m)
const RAD = Math.PI / 180;

export function decodeHeights(b64) {
  const bin = atob(b64), n = bin.length >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v > 32767) v -= 65536; out[i] = v; }
  return out;
}

// Small seeded random numbers, so the forests look the same every time.
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

function pip(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Joins geometries (non-indexed, with colours) into one.
function merge(parts) {
  const geos = parts.map(([g, color]) => {
    const n = g.index ? g.toNonIndexed() : g;
    const c = new THREE.Color(color), cnt = n.attributes.position.count, col = new Float32Array(cnt * 3);
    for (let i = 0; i < cnt; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return n;
  });
  const total = geos.reduce((a, g) => a + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3), uvs = geos.every((g) => g.attributes.uv) ? new Float32Array(total * 2) : null;
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); col.set(g.attributes.color.array, o * 3);
    if (uvs) uvs.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uvs) out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return out;
}
const at = (g, x, y, z, ry = 0) => { if (ry) g.rotateY(ry); g.translate(x, y, z); return g; };

// ---------------------------------------------------------------- terrain
/** The terrain grid in local metres (x east, z south). hAt() reads exactly the surface that is drawn. */
export function makeTerrain(pack) {
  const lat0 = pack.lat0, lon0 = pack.lon0, kx = M_LAT * Math.cos(lat0 * RAD);
  const T = pack.terrain, nI = T.nLat, nJ = T.nLon, H = decodeHeights(T.h);
  const x0 = (T.bbox[1] - lon0) * kx, z0 = -(T.bbox[0] - lat0) * M_LAT, dx = T.dLon * kx, dz = T.dLat * M_LAT;
  const toXZ = (la, lo) => [(lo - lon0) * kx, -(la - lat0) * M_LAT];
  const forests = pack.map.forests.map((f) => f.map(([la, lo]) => toXZ(la, lo)));
  const fbox = forests.map((f) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, z] of f) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); } return [a, b, c, d]; });
  const inForest = (x, z) => forests.some((f, k) => { const b = fbox[k]; return x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3] && pip(x, z, f); });
  // The heights are a surface model: forests stand 10 m or so above the ground. Take the canopy off.
  const forest = new Uint8Array(nI * nJ);
  for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) if (inForest(x0 + j * dx, z0 - i * dz)) forest[i * nJ + j] = 1;
  const G = new Float32Array(H.length);
  for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
    // the canopy fades at the forest edge (neighbours count), then a gentle 3x3 smooth
    let f = 0, c = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nI && b < nJ) { f += forest[a * nJ + b]; c++; } }
    G[i * nJ + j] = H[i * nJ + j] - 10 * (f / c);
  }
  const S = new Float32Array(G.length);
  for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
    let sum = 0, c = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < nI && b < nJ) { const w = di === 0 && dj === 0 ? 4 : di === 0 || dj === 0 ? 2 : 1; sum += G[a * nJ + b] * w; c += w; } }
    S[i * nJ + j] = sum / c;
  }
  const hAt = (x, z) => {
    const fj = Math.max(0, Math.min(nJ - 1.0001, (x - x0) / dx)), fi = Math.max(0, Math.min(nI - 1.0001, (z0 - z) / dz));
    const j = Math.floor(fj), i = Math.floor(fi), u = fj - j, v = fi - i;
    const a = S[i * nJ + j], b = S[i * nJ + j + 1], c = S[(i + 1) * nJ + j], d = S[(i + 1) * nJ + j + 1];
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
  };
  return { lat0, lon0, kx, toXZ, hAt, S, forest, nI, nJ, x0, z0, dx, dz, forests, fbox, inForest, minX: x0, maxX: x0 + (nJ - 1) * dx, minZ: z0 - (nI - 1) * dz, maxZ: z0 };
}

// ---------------------------------------------------------------- textures (drawn on canvases: no image files)
function canvasTex(N, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  draw(c.getContext('2d'), N);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (srgb) t.encoding = THREE.sRGBEncoding;
  return t;
}
// soft blotches at several sizes (wraps at the edges)
function blotches(g, N, r, n, size, colours, alpha) {
  for (let i = 0; i < n; i++) {
    const x = r() * N, y = r() * N, s = size * (0.4 + r());
    g.fillStyle = colours[Math.floor(r() * colours.length)]; g.globalAlpha = alpha;
    for (const [ox, oy] of [[0, 0], [N, 0], [-N, 0], [0, N], [0, -N]]) { g.beginPath(); g.ellipse(x + ox, y + oy, s, s * (0.5 + r() * 0.5), r() * 3, 0, 7); g.fill(); }
  }
  g.globalAlpha = 1;
}
let TEX = null;
export function textures() {
  if (TEX) return TEX;
  const r = rng(21);
  TEX = {
    // meadow: mixed greens with blades and the odd flower
    grass: canvasTex(512, (g, N) => {
      g.fillStyle = '#6d8f45'; g.fillRect(0, 0, N, N);
      blotches(g, N, r, 220, 26, ['#5f8239', '#7a9b4d', '#68883f', '#839f55', '#587a34'], 0.35);
      for (let i = 0; i < 9000; i++) { const x = r() * N, y = r() * N, l = 3 + r() * 6; g.strokeStyle = ['#4e7030', '#86a85a', '#5d8038', '#9bb86a', '#41622a'][Math.floor(r() * 5)]; g.globalAlpha = 0.55; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - l); g.stroke(); }
      for (let i = 0; i < 140; i++) { g.fillStyle = ['#f4f1e4', '#f2d541', '#c86ad9', '#ffffff'][Math.floor(r() * 4)]; g.globalAlpha = 0.9; g.fillRect(r() * N, r() * N, 2, 2); }
      g.globalAlpha = 1;
    }),
    // rock: grey with cracks and lichen
    rock: canvasTex(512, (g, N) => {
      g.fillStyle = '#7d7a73'; g.fillRect(0, 0, N, N);
      blotches(g, N, r, 300, 30, ['#6c6962', '#8f8b83', '#77746c', '#9a968d', '#5f5c56'], 0.45);
      for (let i = 0; i < 160; i++) { let x = r() * N, y = r() * N; g.strokeStyle = 'rgba(40,38,35,0.55)'; g.lineWidth = 1 + r(); g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 30; y += r() * 18; g.lineTo(x, y); } g.stroke(); }
      blotches(g, N, r, 60, 6, ['#a3a36b', '#8e9a5a'], 0.35);
    }),
    // the trail: packed dirt with stones
    dirt: canvasTex(256, (g, N) => {
      g.fillStyle = '#9b7b55'; g.fillRect(0, 0, N, N);
      blotches(g, N, r, 160, 14, ['#8a6c48', '#a98a62', '#7d6142', '#b39470'], 0.4);
      for (let i = 0; i < 700; i++) { g.fillStyle = ['#c9bba5', '#7a6a58', '#5e5040', '#d8ccb8'][Math.floor(r() * 4)]; g.globalAlpha = 0.8; const s = 1 + r() * 2.5; g.beginPath(); g.ellipse(r() * N, r() * N, s, s * 0.7, r() * 3, 0, 7); g.fill(); }
      g.globalAlpha = 1;
    }),
    // tarmac and gravel tracks (tinted by the road colour)
    road: canvasTex(256, (g, N) => {
      g.fillStyle = '#bcbcbc'; g.fillRect(0, 0, N, N);
      for (let i = 0; i < 9000; i++) { const v = 150 + Math.floor(r() * 100); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * N, r() * N, 1.5, 1.5); }
    }),
  };
  return TEX;
}
// Blends meadow and rock by slope, with large-scale variation so the grass doesn't repeat (world-space texturing).
function terrainMaterial(lowPower) {
  const T = textures();
  const m = new (lowPower ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial)({ vertexColors: true, map: T.grass, ...(lowPower ? {} : { roughness: 0.97, metalness: 0 }) });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rockMap = { value: T.rock };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWP = position; vWN = normal;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D rockMap; varying vec3 vWP; varying vec3 vWN;')
      .replace('#include <map_fragment>', `
        vec2 wuv = vWP.xz;
        // (sampled by hand, so decoded from sRGB by hand too)
        vec3 g1 = mapTexelToLinear(texture2D(map, wuv / 7.0)).rgb, g2 = mapTexelToLinear(texture2D(map, wuv / 31.0 + 0.37)).rgb, g3 = mapTexelToLinear(texture2D(map, wuv / 173.0 + 0.71)).rgb;
        vec3 grass = g1 * 0.55 + g2 * 0.3 + g3 * 0.15;
        vec3 rock = mapTexelToLinear(texture2D(rockMap, vec2(vWP.x + vWP.z, vWP.y) / 9.0)).rgb * 0.6 + mapTexelToLinear(texture2D(rockMap, wuv / 23.0)).rgb * 0.4;
        float steep = smoothstep(0.84, 0.66, normalize(vWN).y);
        vec3 tex = mix(grass / vec3(0.15, 0.25, 0.065), rock / vec3(0.19, 0.18, 0.165), steep); // each texture over its own average (linear)
        diffuseColor.rgb *= tex;`);
  };
  return m;
}

function terrainMesh(T, lowPower) {
  const { nI, nJ, S, x0, z0, dx, dz } = T, n = nI * nJ;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2), r = rng(3);
  for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
    const k = i * nJ + j, x = x0 + j * dx, z = z0 - i * dz, h = S[k];
    pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z; uv[k * 2] = x / 9; uv[k * 2 + 1] = z / 9;
  }
  const idx = new Uint32Array((nI - 1) * (nJ - 1) * 6);
  let o = 0;
  for (let i = 0; i < nI - 1; i++) for (let j = 0; j < nJ - 1; j++) {
    const a = i * nJ + j, b = a + 1, c = a + nJ, d = c + 1;
    idx[o++] = a; idx[o++] = b; idx[o++] = c; idx[o++] = b; idx[o++] = d; idx[o++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  // Tints over the textures: meadow, darker forest floor, drier grass up high, rock on the steep faces (blended in the shader).
  const nor = g.attributes.normal.array, c = new THREE.Color();
  for (let k = 0; k < n; k++) {
    const h = S[k], noise = (r() - 0.5) * 0.06;
    if (T.forest[k]) c.setRGB(0.2 + noise, 0.3 + noise, 0.14);
    else c.setRGB(0.39 + noise + Math.max(0, h - 1700) * 0.00012, 0.52 + noise - Math.max(0, h - 1800) * 0.0001, 0.24);
    if (nor[k * 3 + 1] < 0.84) c.lerp(new THREE.Color(0.47, 0.46, 0.43), Math.min(1, (0.84 - nor[k * 3 + 1]) / 0.18));
    c.convertSRGBToLinear();
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(g, terrainMaterial(lowPower));
  m.receiveShadow = true;
  return m;
}

// The mountains around, from the coarse 250 m grid: sunk under the detailed terrain where they overlap.
function farMesh(pack, T) {
  const F = pack.far, H = decodeHeights(F.h), nI = F.nLat, nJ = F.nLon;
  const pos = [], col = [], idx = [], c = new THREE.Color();
  for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
    const [x, z] = T.toXZ(F.bbox[0] + i * F.dLat, F.bbox[1] + j * F.dLon);
    let h = H[i * nJ + j];
    const inside = x > T.minX + 60 && x < T.maxX - 60 && z > T.minZ + 60 && z < T.maxZ - 60;
    if (inside) h -= 80;
    pos.push(x, h, z);
    const snow = Math.max(0, Math.min(1, (h - 2500) / 400));
    c.setRGB(0.3, 0.42, 0.24).lerp(new THREE.Color(0.55, 0.53, 0.5), Math.min(1, Math.max(0, (h - 1900) / 500))).lerp(new THREE.Color(0.95, 0.96, 0.98), snow);
    c.convertSRGBToLinear(); col.push(c.r, c.g, c.b);
  }
  for (let i = 0; i < nI - 1; i++) for (let j = 0; j < nJ - 1; j++) {
    const a = i * nJ + j, b = a + 1, cc = a + nJ, d = cc + 1;
    idx.push(a, b, cc, b, d, cc);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.frustumCulled = false;
  return m;
}


// ---------------------------------------------------------------- rivers
const riverWidth = (w) => Math.max(4, Math.min(14, w || 5));
/** Lowers the terrain along each river so the water sits in a channel below the ground (except where the course crosses). */
function carveRivers(T, pack, course) {
  const rivers = (pack.map.rivers || []).map(([w, line]) => ({ w: riverWidth(w), pts: resample(T, line.map(([la, lo]) => T.toXZ(la, lo)), 8) }));
  if (!rivers.length) return;
  const CELL = 30, hash = new Map(), key = (x, z) => Math.floor(x / CELL) + ':' + Math.floor(z / CELL);
  for (const rv of rivers) for (const p of rv.pts) { const k = key(p.x, p.z); let a = hash.get(k); if (!a) hash.set(k, a = []); a.push([p.x, p.z, rv.w]); }
  const near = new Map(); // the course, so its crossings stay level (bridges)
  for (const [la, lo] of course.line) { const [x, z] = T.toXZ(la, lo); near.set(key(x, z), true); }
  const courseXZ = course.line.map(([la, lo]) => T.toXZ(la, lo));
  const distCourse = (x, z) => { let d = Infinity; for (const [cx, cz] of courseXZ) { const dd = (cx - x) ** 2 + (cz - z) ** 2; if (dd < d) d = dd; } return Math.sqrt(d); };
  const { nI, nJ, S, x0, z0, dx, dz } = T;
  for (let i = 0; i < nI; i++) for (let j = 0; j < nJ; j++) {
    const x = x0 + j * dx, z = z0 - i * dz;
    let best = Infinity, bw = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = hash.get(Math.floor(x / CELL + a) + ':' + Math.floor(z / CELL + b)); if (!list) continue;
      for (const [px, pz, w] of list) { const d = Math.hypot(px - x, pz - z); if (d < best) { best = d; bw = w; } }
    }
    const R = bw / 2 + 22;
    if (best >= R) continue;
    let keep = 1;
    if (near.has(key(x, z)) || near.has(key(x + CELL, z)) || near.has(key(x - CELL, z)) || near.has(key(x, z + CELL)) || near.has(key(x, z - CELL))) {
      const dc = distCourse(x, z); if (dc < 26) keep = Math.max(0, (dc - 12) / 14); // ease back to level at the crossing
    }
    const t = best / R;
    S[i * nJ + j] -= 2.2 * (1 - t * t) * keep;
  }
}

// ---------------------------------------------------------------- collision
/** A spatial hash of things you can run into: trees, buildings, lift pylons. */
export function makeObstacles() {
  const CELL = 20, cells = new Map();
  const key = (i, j) => i * 100003 + j;
  return {
    add(x, z, o) { const k = key(Math.floor(x / CELL), Math.floor(z / CELL)); let a = cells.get(k); if (!a) cells.set(k, a = []); o.x = x; o.z = z; a.push(o); },
    near(x, z, fn) {
      const i0 = Math.floor(x / CELL), j0 = Math.floor(z / CELL);
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) { const a = cells.get(key(i, j)); if (a) for (const o of a) fn(o); }
    },
  };
}

// Splits instances into tiles so each can be culled on its own (an InstancedMesh is otherwise one big always-drawn object).
function tiledInstances(scene, geo, mat, items, tile, maxD, setup) {
  const groups = new Map();
  for (const it of items) { const k = Math.floor(it.x / tile) + ':' + Math.floor(it.z / tile); let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(it); }
  const meshes = [], m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (const list of groups.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    let cx = 0, cz = 0, cy = 0;
    list.forEach((it, i) => {
      q.setFromAxisAngle(up, it.ry || 0); s.set(it.sx, it.sy, it.sz); p.set(it.x, it.y, it.z);
      m4.compose(p, q, s); mesh.setMatrixAt(i, m4);
      if (it.color !== undefined) { col.set(it.color); mesh.setColorAt(i, col); }
      it.mesh = mesh; it.i = i; cx += it.x; cz += it.z; cy += it.y;
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    const c = new THREE.Vector3(cx / list.length, cy / list.length, cz / list.length);
    let r = 0; for (const it of list) r = Math.max(r, Math.hypot(it.x - c.x, it.y - c.y, it.z - c.z) + 15 * Math.max(it.sx, it.sy, it.sz));
    // the geometry is shared, so its bounding sphere says nothing about this tile: the game culls tiles itself (cullThings)
    mesh.frustumCulled = false;
    mesh.userData = { sphere: new THREE.Sphere(c, r), maxD };
    if (setup) setup(mesh);
    scene.add(mesh);
    meshes.push(mesh);
  }
  return meshes;
}

// ---------------------------------------------------------------- the course
/** A course resampled every few metres: points with x, y, z, distance along, heading. */
export function sampleLine(T, line, step = 4) {
  const xz = line.map(([la, lo]) => T.toXZ(la, lo)), out = [];
  let d = 0;
  for (let i = 0; i < xz.length - 1; i++) {
    const [ax, az] = xz[i], [bx, bz] = xz[i + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.01) continue;
    const n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      out.push({ x, z, y: T.hAt(x, z), d: d + L * t });
    }
    d += L;
  }
  const [lx, lz] = xz[xz.length - 1];
  out.push({ x: lx, z: lz, y: T.hAt(lx, lz), d });
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 2)], b = out[Math.min(out.length - 1, i + 2)];
    out[i].h = Math.atan2(b.x - a.x, b.z - a.z);
  }
  return out;
}
export function pointAt(P, d) {
  let lo = 0, hi = P.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P[m].d <= d) lo = m; else hi = m; }
  const a = P[lo], b = P[hi], t = b.d > a.d ? Math.max(0, Math.min(1, (d - a.d) / (b.d - a.d))) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, h: a.h, i: lo };
}

// A flat strip draped over the terrain along a line of points.
function ribbon(T, pts, width, lift, color, mat) {
  const pos = [], idx = [], uv = [];
  let along = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
    let tx = q.x - o.x, tz = q.z - o.z; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    const nx = tz * width / 2, nz = -tx * width / 2;
    if (i) along += Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
    pos.push(p.x + nx, T.hAt(p.x + nx, p.z + nz) + lift, p.z + nz, p.x - nx, T.hAt(p.x - nx, p.z - nz) + lift, p.z - nz);
    uv.push(0, along / 3, width / 3, along / 3);
    // wind each quad so it faces up (a back face would be lit from below and look black)
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  }
  for (let k = 0; k < idx.length; k += 3) {
    const [i0, i1, i2] = [idx[k] * 3, idx[k + 1] * 3, idx[k + 2] * 3];
    const ux = pos[i1] - pos[i0], uz = pos[i1 + 2] - pos[i0 + 2], vx = pos[i2] - pos[i0], vz = pos[i2 + 2] - pos[i0 + 2];
    if (uz * vx - ux * vz < 0) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat || new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  m.receiveShadow = true;
  return m;
}
function resample(T, xz, step) {
  const out = [];
  for (let i = 0; i < xz.length - 1; i++) {
    const [ax, az] = xz[i], [bx, bz] = xz[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push({ x: ax + (bx - ax) * k / n, z: az + (bz - az) * k / n });
  }
  out.push({ x: xz[xz.length - 1][0], z: xz[xz.length - 1][1] });
  return out;
}
// Several strips in one mesh (roads).
function ribbons(T, lines, lift) {
  const meshes = lines.map(([pts, w, color]) => [ribbon(T, pts, w, lift, color), color]);
  if (!meshes.length) return null;
  const g = merge(meshes.map(([m, color]) => [m.geometry, color]));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, map: textures().road, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  m.receiveShadow = true;
  return m;
}

// A sign with text, drawn on a canvas.
export function textSprite(text, { bg = '#0b0b0b', fg = '#ffffff', size = 1, accent = '#e2231a' } = {}) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = 'bold 44px system-ui, sans-serif';
  const w = Math.min(1024, Math.ceil(g.measureText(text).width) + 40);
  c.width = w; c.height = 64;
  g.fillStyle = bg; g.fillRect(0, 0, w, 64); g.fillStyle = accent; g.fillRect(0, 58, w, 6);
  g.font = 'bold 44px system-ui, sans-serif'; g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, 20, 31);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, toneMapped: false }));
  s.scale.set((w / 64) * size, size, 1);
  return s;
}
function textPlane(text, w, h, { bg = '#0b0b0b', fg = '#ffffff', accent = '#e2231a' } = {}) {
  const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); g.fillStyle = accent; g.fillRect(0, c.height - 10, c.width, 10);
  let fs = Math.round(c.height * 0.55); g.font = `bold ${fs}px system-ui, sans-serif`;
  while (g.measureText(text).width > c.width - 30 && fs > 12) { fs -= 2; g.font = `bold ${fs}px system-ui, sans-serif`; }
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, c.width / 2, c.height / 2 - 4);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, toneMapped: false }));
}

// ---------------------------------------------------------------- obstacles
// What kind of obstacle a name is, which decides its model and its challenge.
export function obstacleKind(name) {
  const n = name.toUpperCase();
  if (/MEMORY ?BOARD/.test(n)) return 'memoryBoard';
  if (/MEMORY ?TEST/.test(n)) return 'memoryTest';
  if (/SPEAR|LASER|BALL THROW/.test(n)) return 'aim';
  if (/SANDBAG|BUCKET|LOG CARRY|CHAIN|ATLAS|PLATE DRAG|TIRE DRAG/.test(n)) return 'carry';
  if (/BARBER|BARB|CRAWL/.test(n)) return 'crawl';
  if (/BALANCE|SLACKLINE/.test(n)) return 'balance';
  if (/HERCULE|HOIST|\bHH\b/.test(n)) return 'hoist';
  if (/MONKEY|APE HANGER|MULTIRING|HYDRA|BENDER|TYROLEAN|ARMER|TWISTER|SPIDER/.test(n)) return 'rig';
  if (/BELL|ICONIC/.test(n)) return 'bell';
  if (/HURDLE|FIRE JUMP|HAYS JUMP|OUOU|OUT\b|^OUT$/.test(n)) return 'hurdle';
  return 'climb'; // walls, A-frames, nets, ladders, stairway, rope climb, slip wall, Olympus, vertical cargo
}
export function wallHeight(name) {
  const m = name.match(/\b([6-9])\s*(?:WALL)|WALL\s*([6-9])|^([6-9])WALL|\b([6-9]) Wall/i);
  const ft = m ? +(m[1] || m[2] || m[3] || m[4]) : /INVERTED|HANGING|Z WALL|OLYMPUS|SLIP/i.test(name) ? 7 : /ROPE|CARGO|NET|LADDER|A FRAME/i.test(name) ? 8 : 6;
  return ft * 0.3048;
}

const MAT = {};
function mats() {
  if (MAT.wood) return MAT;
  MAT.wood = new THREE.MeshLambertMaterial({ color: 0x9a6b3f });
  MAT.dark = new THREE.MeshLambertMaterial({ color: 0x1c1c1c });
  MAT.red = new THREE.MeshLambertMaterial({ color: 0xe2231a });
  MAT.metal = new THREE.MeshLambertMaterial({ color: 0x8a8f96 });
  MAT.white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
  MAT.rope = new THREE.MeshLambertMaterial({ color: 0xc9b27a });
  MAT.sand = new THREE.MeshLambertMaterial({ color: 0x6b5a3a });
  MAT.mat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
  MAT.water = new THREE.MeshLambertMaterial({ color: 0x2f6f9f });
  MAT.fire = new THREE.MeshBasicMaterial({ color: 0xff7a1a });
  MAT.hivis = new THREE.MeshLambertMaterial({ color: 0xd8f000 });
  MAT.skin = new THREE.MeshLambertMaterial({ color: 0xd9a77e });
  return MAT;
}
function box(w, h, d, m, x = 0, y = 0, z = 0) { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = true; b.receiveShadow = true; return b; }
function cyl(r, h, m, x = 0, y = 0, z = 0) { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 8), m); c.position.set(x, y, z); c.castShadow = true; return c; }
function flag(g, x, z, color) { g.add(cyl(0.04, 3, MAT.metal, x, 1.5, z)); const f = box(0.02, 0.6, 0.9, color === 'red' ? MAT.red : MAT.dark, x, 2.65, z + 0.45); f.castShadow = false; g.add(f); }

// The trail up close: a finely divided strip with two worn ruts and a slight crown, puddles where it dips, packed
// dirt at two scales so it never repeats, fading into the grass at its edges.
function trailMesh(T, cs) {
  const half = TRAIL_W / 2 + 0.9, NX = 10, step = 1.25, pos = [], uv = [], edge = [], idx = [];
  const L = cs[cs.length - 1].d;
  let row = 0;
  for (let d = 0; d <= L; d += step, row++) {
    const p = pointAt(cs, d), nx = Math.cos(p.h), nz = -Math.sin(p.h);
    for (let i = 0; i <= NX; i++) {
      const lat = -half + (2 * half * i) / NX, x = p.x + nx * lat, z = p.z + nz * lat, a = Math.abs(lat);
      const rut = -0.035 * Math.exp(-(((a - 0.75) / 0.28) ** 2)), crown = 0.015 * Math.max(0, 1 - a / 1.5);
      pos.push(x, T.hAt(x, z) + 0.16 + rut + crown, z); uv.push(x / 2.6, z / 2.6);
      edge.push(clampN((half - a) / 1.3, 0, 1));
      if (i && row) { const b = (row - 1) * (NX + 1) + i - 1; idx.push(b, b + NX + 1, b + 1, b + 1, b + NX + 1, b + NX + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx); g.computeVertexNormals();
  let up = 0; for (let k = 1; k < g.attributes.normal.count; k += 97) up += g.attributes.normal.getY(k);
  if (up < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  const m = new THREE.MeshStandardMaterial({ map: textures().dirt, color: 0xa48a6a, roughness: 0.92, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float edge; varying float vEdge; varying vec3 vWP2;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = edge; vWP2 = position;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying float vEdge; varying vec3 vWP2;
      float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `
        vec3 t1 = mapTexelToLinear(texture2D(map, vUv)).rgb, t2 = mapTexelToLinear(texture2D(map, vUv * 0.21 + 0.3)).rgb;
        vec3 dirt = (t1 * 0.65 + t2 * 0.35) / vec3(0.29, 0.2, 0.1);
        float wet = smoothstep(0.62, 0.72, vnoise(vWP2.xz * 0.18) * 0.7 + vnoise(vWP2.xz * 0.9) * 0.3) * smoothstep(0.3, 0.8, vEdge);
        diffuseColor.rgb *= mix(dirt, dirt * vec3(0.42, 0.36, 0.3), wet);
        diffuseColor.a *= smoothstep(0.0, 1.0, vEdge + (vnoise(vWP2.xz * 1.7) - 0.5) * 0.9 + (vnoise(vWP2.xz * 6.0) - 0.5) * 0.3);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.08, wet);');
  };
  const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.renderOrder = 1;
  return mesh;
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
// Close-up trees: a spruce of drooping tiers of branches, and a broadleaf of several lumpy clumps of leaves.
function jitter(g, amt, seed) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = Math.sin(x * 12.9 + y * 7.3 + z * 9.1 + seed) * 43758.5; p.setXYZ(i, x + ((n % 1) - 0.5) * amt, y + (((n * 1.7) % 1) - 0.5) * amt, z + (((n * 2.3) % 1) - 0.5) * amt); }
  return g;
}
function coniferNear() {
  const parts = [[at(new THREE.CylinderGeometry(0.12, 0.3, 5.5, 8), 0, 2.75, 0), 0x4a3324]];
  for (let k = 0; k < 6; k++) {
    const r = 2.1 - k * 0.3, h = 2.0 - k * 0.12, c = new THREE.ConeGeometry(r, h, 14, 2, true);
    // the bottom of each tier droops and frays
    const p = c.attributes.position; for (let i = 0; i < p.count; i++) if (p.getY(i) < -h / 2 + 0.01) { const a = Math.atan2(p.getZ(i), p.getX(i)); p.setY(i, p.getY(i) - 0.25 - 0.2 * Math.abs(Math.sin(a * 5))); p.setX(i, p.getX(i) * (0.85 + 0.25 * Math.abs(Math.sin(a * 7)))); p.setZ(i, p.getZ(i) * (0.85 + 0.25 * Math.abs(Math.sin(a * 7)))); }
    parts.push([at(jitter(c, 0.12, k), 0, 1.6 + k * 0.85 + h / 2, 0, k * 0.7), [0x223f22, 0x284826, 0x2c5029, 0x2f552b, 0x335c2e, 0x37622f][k]]);
  }
  return merge(parts);
}
function broadNear() {
  const parts = [[at(new THREE.CylinderGeometry(0.14, 0.3, 3.4, 8), 0, 1.7, 0), 0x4e3a2a], [at(new THREE.CylinderGeometry(0.06, 0.1, 1.6, 6).rotateZ(0.7), 0.6, 3.2, 0), 0x4e3a2a]];
  for (const [x, y, z, s, c] of [[0, 4.3, 0, 1.7, 0x3c7432], [0.9, 3.7, 0.4, 1.2, 0x447d38], [-0.8, 3.8, -0.3, 1.25, 0x386d2f], [0.2, 5.2, -0.2, 1.1, 0x4a8640], [-0.2, 3.5, 0.9, 1.0, 0x417a36]]) {
    parts.push([at(jitter(new THREE.IcosahedronGeometry(s, 1), s * 0.35, x * 10 + y), x, y, z), c]);
  }
  return merge(parts);
}
let NEAR_TREE = null;
const nearTreeMat = () => NEAR_TREE || (NEAR_TREE = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, flatShading: false }));
// Stones: a scatter along the trail's edges and the odd one on it.
function stones(scene, T, cs, r) {
  const geo = new THREE.IcosahedronGeometry(1, 1), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.75 + 0.5 * Math.abs(Math.sin(p.getX(i) * 7.1 + p.getY(i) * 3.3 + p.getZ(i) * 5.7)); p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.6, p.getZ(i) * k); }
  geo.computeVertexNormals();
  const items = [], L = cs[cs.length - 1].d;
  for (let d = 2; d < L; d += 0.9) {
    const q = pointAt(cs, d), nx = Math.cos(q.h), nz = -Math.sin(q.h);
    for (let n = 0; n < 2; n++) {
      const onIt = r() < 0.15, lat = onIt ? (r() - 0.5) * TRAIL_W * 0.8 : (r() < 0.5 ? -1 : 1) * (TRAIL_W / 2 + 0.1 + r() * 1.4), s = onIt ? 0.02 + r() * 0.04 : 0.04 + r() * r() * 0.22;
      const x = q.x + nx * lat, z = q.z + nz * lat, g = 0.45 + r() * 0.25;
      items.push({ x, y: T.hAt(x, z) + 0.12, z, sx: s * (0.8 + r() * 0.6), sy: s, sz: s * (0.8 + r() * 0.6), ry: r() * 6.3, color: new THREE.Color(g, g * 0.97, g * 0.92).getHex() });
    }
  }
  return tiledInstances(scene, geo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), items, 120, 140, (m) => { m.castShadow = true; m.receiveShadow = true; });
}

// Bare, trodden ground under an obstacle: a patch that follows the slope and fades out at its edges.
let PAD_MAT = null;
function padMesh(T, p, hw, hl) {
  if (!PAD_MAT) {
    PAD_MAT = new THREE.MeshStandardMaterial({ map: textures().dirt, color: 0x8f7658, roughness: 0.75, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    PAD_MAT.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float edge; varying float vEdge;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = edge;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vEdge;').replace('#include <alphamap_fragment>', '#include <alphamap_fragment>\ndiffuseColor.a *= smoothstep(0.0, 0.6, vEdge);');
    };
  }
  const c = Math.cos(p.h), s = Math.sin(p.h), nx = Math.ceil(hw * 2 / 0.7), nz = Math.ceil(hl * 2 / 0.7), pos = [], uv = [], edge = [], idx = [];
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const lx = -hw + (2 * hw * i) / nx, lz = -hl + (2 * hl * j) / nz, x = p.x + lx * c + lz * s, z = p.z - lx * s + lz * c;
    pos.push(x, T.hAt(x, z) + 0.06, z); uv.push(x / 3, z / 3);
    edge.push(Math.min(1 - Math.abs(lx) / hw, 1 - Math.abs(lz) / hl) * 3);
    if (i && j) { const a = (j - 1) * (nx + 1) + i - 1, b = a + 1, d = a + nx + 1, e = d + 1; idx.push(a, d, b, b, d, e); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('edge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx); g.computeVertexNormals();
  // (wound to face up)
  if (g.attributes.normal.getY(0) < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
  const m = new THREE.Mesh(g, PAD_MAT); m.receiveShadow = true; m.renderOrder = 1;
  return m;
}

/** A model of an obstacle, built across the trail (local +z = the direction of travel), with its banner beside it. */
export function obstacleModel(name, kind, opts = {}) {
  const M = mats(), B = buildObstacle(name, kind, opts), g = B.group;
  // the obstacle's banner beside the trail, on two posts, readable from both ways
  const bx = Math.max(B.half, TRAIL_W / 2 + 1) + 1.9, banner = textPlane(name.replace(/\s*\(.*?\)\s*/g, ' ').trim().toUpperCase(), 3.2, 0.6);
  banner.material.side = THREE.FrontSide; banner.position.set(bx, 2.1, -B.len + 0.96); banner.rotation.y = Math.PI;
  const back = banner.clone(); back.position.z = -B.len + 1.04; back.rotation.y = 0;
  g.add(banner, back, box(0.08, 2.4, 0.08, M.dark, bx - 1.55, 1.2, -B.len + 1), box(0.08, 2.4, 0.08, M.dark, bx + 1.55, 1.2, -B.len + 1));
  return B;
}
// A simple standing person (marshals, volunteers).
function personGeo(top) { // (simple stand-in figure)
  return merge([
    [at(new THREE.CylinderGeometry(0.16, 0.12, 0.85, 6), 0, 0.42, 0), 0x1d2a44],
    [at(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 6), 0, 1.15, 0), top],
    [at(new THREE.SphereGeometry(0.13, 8, 6), 0, 1.6, 0), 0xd9a77e],
  ]);
}


// ---------------------------------------------------------------- buildings
// Chalet walls drawn in the shader from the world position: wooden boards (darker walls) or rendered
// plaster (pale ones), with windows, frames and shutters on every floor; the instance colour tints them.
function instancedWorld(sh) {
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wpos = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        wpos = instanceMatrix * wpos; vWN = normalize(mat3(instanceMatrix) * normal);
      #else
        vWN = normal;
      #endif
      vWP = (modelMatrix * wpos).xyz;`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWP; varying vec3 vWN;');
}
function wallMaterial(lowPower) {
  const m = new (lowPower ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial)({ color: 0xffffff, ...(lowPower ? {} : { roughness: 0.85 }) });
  m.onBeforeCompile = (sh) => {
    instancedWorld(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 n = normalize(vWN);
      if (abs(n.y) < 0.5) {
        float u = abs(n.x) > 0.5 ? vWP.z : vWP.x, v = vWP.y;
        float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
        // boards on wooden walls, a faint mottle on plaster
        float board = lum < 0.45 ? 0.82 + 0.18 * smoothstep(0.0, 0.06, fract(v / 0.21)) * smoothstep(1.0, 0.94, fract(v / 0.21)) : 0.95 + 0.05 * fract(sin(dot(floor(vec2(u, v) * 4.0), vec2(12.9, 78.2))) * 43758.5);
        diffuseColor.rgb *= board;
        // windows: one per bay on each floor, with a frame and shutters
        float fx = fract(u / 2.8), fy = fract(v / 2.9);
        float win = step(0.34, fx) * step(fx, 0.66) * step(0.3, fy) * step(fy, 0.78);
        float frame = step(0.31, fx) * step(fx, 0.69) * step(0.27, fy) * step(fy, 0.81) - win;
        float shut = (step(0.2, fx) * step(fx, 0.3) + step(0.7, fx) * step(fx, 0.8)) * step(0.3, fy) * step(fy, 0.78);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.92, 0.88), frame);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.32, 0.2, 0.11), shut * 0.9);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.07, 0.09) + 0.12 * fy, win);
      }`);
  };
  m.customProgramCacheKey = () => 'wall' + lowPower;
  return m;
}
function roofMaterial(lowPower) {
  const m = new (lowPower ? THREE.MeshLambertMaterial : THREE.MeshStandardMaterial)({ color: 0xffffff, side: THREE.DoubleSide, ...(lowPower ? {} : { roughness: 0.8 }) });
  m.onBeforeCompile = (sh) => {
    instancedWorld(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      // rows of tiles or slates, each a slightly different shade
      float row = floor(vWP.y / 0.22), col = floor((vWP.x + vWP.z + row * 0.17) / 0.35);
      float shade = 0.82 + 0.18 * fract(sin(row * 12.9 + col * 78.2) * 43758.5);
      float gap = smoothstep(0.0, 0.12, fract(vWP.y / 0.22));
      diffuseColor.rgb *= shade * (0.75 + 0.25 * gap);`);
  };
  m.customProgramCacheKey = () => 'roof' + lowPower;
  return m;
}

// ---------------------------------------------------------------- the whole world
export function buildWorld(scene, pack, T, course, quality) {
  mats();
  const obstacles = makeObstacles(), things = [], r = rng(11);
  carveRivers(T, pack, course);
  scene.add(terrainMesh(T, quality === 'low'));
  scene.add(farMesh(pack, T));
  const cs = sampleLine(T, course.line, 4);

  // Cells near the course: the trail must stay clear of trees, and trees only grow where you can see them.
  const NEAR_CELL = 50, nearCell = new Set(), onTrail = new Set(), onCourse = new Set(), closeCell = new Set();
  const ck = (x, z, c) => Math.floor(x / c) + ':' + Math.floor(z / c);
  for (const p of cs) {
    for (let a = -14; a <= 14; a++) for (let b = -14; b <= 14; b++) nearCell.add(ck(p.x + a * NEAR_CELL, p.z + b * NEAR_CELL, NEAR_CELL));
    for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) closeCell.add(ck(p.x + a * 30, p.z + b * 30, 30));
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { onTrail.add(ck(p.x + a * 3, p.z + b * 3, 4)); onCourse.add(ck(p.x + a * 3, p.z + b * 3, 4)); }
  }
  const toXZ = T.toXZ;
  const onTrailOnly = (x, z) => onCourse.has(ck(x, z, 4));

  // Roads first, so the trees keep off them.
  const roadLines = [];
  for (const [major, line] of pack.map.roads) {
    const pts = resample(T, line.map(([la, lo]) => toXZ(la, lo)), 8);
    if (pts.length > 1) roadLines.push([pts, major ? 5.5 : 3.2, major ? 0x5d5f63 : 0xa89a82]);
    for (const p of pts) onTrail.add(ck(p.x, p.z, 4));
  }
  const roads = ribbons(T, roadLines, 0.12);
  if (roads) scene.add(roads);
  // rivers: water down in the channel, with muddy, stony banks either side
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x3f7fa8, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.9, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const bankMat = new THREE.MeshLambertMaterial({ map: textures().dirt, color: 0x9a8a72, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  for (const [w, line] of pack.map.rivers || []) {
    const pts = resample(T, line.map(([la, lo]) => toXZ(la, lo)), 6);
    if (pts.length < 2) continue;
    const width = riverWidth(w);
    // (where the course runs along the bank, the water and mud dip under the trail so you never run on the river)
    for (const m of [ribbon(T, pts, width + 5, 0.12, 0, bankMat), ribbon(T, pts, width, 0.3, 0, waterMat)]) {
      const p = m.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) if (onTrailOnly(p.getX(i), p.getZ(i))) p.setY(i, p.getY(i) - 1.5);
      p.needsUpdate = true; scene.add(m);
    }
  }
  for (const poly of pack.map.water || []) {
    const ring = poly[0] || poly; if (!ring || ring.length < 3 || !Array.isArray(ring[0])) continue;
    const xz = ring.map(([la, lo]) => toXZ(la, lo));
    let hmin = Infinity; for (const [x, z] of xz) hmin = Math.min(hmin, T.hAt(x, z));
    const shape = new THREE.Shape(xz.map(([x, z]) => new THREE.Vector2(x, -z)));
    const g = new THREE.ShapeGeometry(shape); g.rotateX(-Math.PI / 2); g.translate(0, hmin + 0.4, 0);
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: 0x3a7ca8, transparent: true, opacity: 0.92 })));
  }

  // Trees: dense near the course, sparser further out, never on the trail or a road.
  const conifer = merge([[at(new THREE.CylinderGeometry(0.18, 0.25, 2.2, 5), 0, 1.1, 0), 0x5a3d26], [at(new THREE.ConeGeometry(1.9, 4.6, 7), 0, 3.6, 0), 0x2a5a2c], [at(new THREE.ConeGeometry(1.4, 3.4, 7), 0, 5.6, 0), 0x2f6532]]);
  const broad = merge([[at(new THREE.CylinderGeometry(0.2, 0.28, 2.6, 5), 0, 1.3, 0), 0x5a3d26], [at(new THREE.IcosahedronGeometry(2.2, 0), 0, 4, 0), 0x3f7a35]]);
  const trees = { c: [], b: [] }, maxTrees = quality === 'low' ? 12000 : 26000;
  let count = 0;
  // two passes: every forest near the course first, then a thinner scatter further out with what's left of the budget
  for (const pass of ['near', 'far']) T.forests.forEach((f, k) => {
    const [a, b, c, d] = T.fbox[k], step = pass === 'near' ? 9 : 22;
    for (let x = a; x <= c && count < maxTrees; x += step) for (let z = b; z <= d && count < maxTrees; z += step) {
      const jx = x + (r() - 0.5) * step * 0.9, jz = z + (r() - 0.5) * step * 0.9;
      const near = nearCell.has(ck(jx, jz, NEAR_CELL));
      if ((pass === 'near') !== near) continue;
      if (onTrail.has(ck(jx, jz, 4)) || !pip(jx, jz, f)) continue;
      const s = (0.75 + r() * 0.6) * (pass === 'far' ? 1.3 : 1), y = T.hAt(jx, jz) - 0.2, isB = r() < 0.18;
      const item = { x: jx, y, z: jz, sx: s, sy: s * (0.9 + r() * 0.3), sz: s, ry: r() * 6.28, color: new THREE.Color().setHSL(0.27 + r() * 0.06, 0.35 + r() * 0.2, 0.75 + r() * 0.25).getHex() };
      (isB ? trees.b : trees.c).push(item);
      if (quality !== 'low' && closeCell.has(ck(jx, jz, 30))) item.close = true;
      if (near) obstacles.add(jx, jz, { t: 'tree', r: 0.35 * s, item }); // (item gets its mesh and index once instanced: the camera ghosts trees in the way)
      count++;
    }
  });
  const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const treeMeshes = [
    ...tiledInstances(scene, conifer, treeMat, trees.c.filter((t) => !t.close), 500, 2600, (m) => { m.castShadow = true; }),
    ...tiledInstances(scene, broad, treeMat, trees.b.filter((t) => !t.close), 500, 2600, (m) => { m.castShadow = true; }),
    // the trees beside the trail: full, layered and shaded close up, the simple ones when seen from far off
    ...tiledInstances(scene, conifer, treeMat, trees.c.filter((t) => t.close), 150, 2600, (m) => { m.castShadow = true; m.userData.lod = 'far'; }),
    ...tiledInstances(scene, broad, treeMat, trees.b.filter((t) => t.close), 150, 2600, (m) => { m.castShadow = true; m.userData.lod = 'far'; }),
    ...tiledInstances(scene, coniferNear(), nearTreeMat(), trees.c.filter((t) => t.close), 150, 2600, (m) => { m.castShadow = true; m.receiveShadow = true; m.userData.lod = 'near'; }),
    ...tiledInstances(scene, broadNear(), nearTreeMat(), trees.b.filter((t) => t.close), 150, 2600, (m) => { m.castShadow = true; m.receiveShadow = true; m.userData.lod = 'near'; }),
  ];
  things.push(...treeMeshes);

  // Buildings: chalets with pitched roofs (OSM footprints are given as width x depth).
  const walls = [], roofs = [], churchSpires = [];
  for (const [la, lo, wx, wy, h, , church] of pack.map.buildings) {
    const [x, z] = toXZ(la, lo);
    // OSM footprints are drawn as boxes, which can cover the course where it squeezes between houses
    let crosses = false;
    for (let ax = -wx / 2; ax <= wx / 2 && !crosses; ax += 3) for (let az = -wy / 2; az <= wy / 2 && !crosses; az += 3) if (onCourse.has(ck(x + ax, z + az, 4))) crosses = true;
    if (crosses) continue; // the course runs here: leave the building out so the way is always open
    const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => T.hAt(x + a * wx / 2, z + b * wy / 2));
    const base = Math.min(...corners) - 0.5, top = Math.max(...corners), wallH = Math.max(3, h * 0.7) + (top - base);
    const roofH = Math.min(wx, wy) * 0.38, along = wx >= wy;
    walls.push({ x, y: base, z, sx: wx, sy: wallH, sz: wy, color: [0xe8e0d0, 0xb88a5a, 0x9c6b3e, 0xf0ece4][Math.floor(r() * 4)] });
    roofs.push({ x, y: base + wallH, z, sx: along ? wx + 0.8 : wy + 0.8, sy: roofH, sz: along ? wy + 0.8 : wx + 0.8, ry: along ? 0 : Math.PI / 2, color: [0x3b3b3b, 0x5a4636, 0x4a4a52][Math.floor(r() * 3)] });
    if (church) churchSpires.push({ x: x + wx * 0.35, y: base, z, sx: 3, sy: h * 1.6 + 8, sz: 3 });
    obstacles.add(x, z, { t: 'box', hx: wx / 2 + 0.3, hz: wy / 2 + 0.3 });
  }
  const unitBox = new THREE.BoxGeometry(1, 1, 1); unitBox.translate(0, 0.5, 0);
  const prism = new THREE.BufferGeometry();
  { // a gable roof 1 x 1 x 1, ridge along x
    const v = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, 0.5];
    const f = [0, 3, 1, 1, 3, 2, 4, 5, 3, 5, 2, 3, 0, 4, 3, 1, 2, 5];
    const pos = []; for (const i of f) pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
    prism.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); prism.computeVertexNormals();
  }
  const wm = wallMaterial(quality === 'low'), rm = roofMaterial(quality === 'low');
  things.push(...tiledInstances(scene, unitBox, wm, walls, 500, 3500, (m) => { m.castShadow = true; m.receiveShadow = true; }));
  things.push(...tiledInstances(scene, prism, rm, roofs, 500, 3500, (m) => { m.castShadow = true; }));
  if (churchSpires.length) things.push(...tiledInstances(scene, unitBox, new THREE.MeshLambertMaterial({ color: 0xd8d2c4 }), churchSpires, 1000, 5000));

  // Lift pylons and stations.
  // (none on the course: a lift station or pylon whose footprint touches it is left out)
  const clear = (x, z, h) => { for (let a = -h; a <= h; a += 3) for (let b = -h; b <= h; b += 3) if (onCourse.has(ck(x + a, z + b, 4))) return false; return true; };
  const pyl = pack.map.pylons.map(([la, lo]) => toXZ(la, lo)).filter(([x, z]) => clear(x, z, 1)).map(([x, z]) => { obstacles.add(x, z, { t: 'post', r: 0.8 }); return { x, y: T.hAt(x, z), z, sx: 0.9, sy: 14, sz: 0.9 }; });
  things.push(...tiledInstances(scene, unitBox, new THREE.MeshLambertMaterial({ color: 0x9aa0a6 }), pyl, 1000, 4000, (m) => { m.castShadow = true; }));
  const st = pack.map.stations.map(([la, lo]) => toXZ(la, lo)).filter(([x, z]) => clear(x, z, 6)).map(([x, z]) => { obstacles.add(x, z, { t: 'box', hx: 6, hz: 6 }); return { x, y: T.hAt(x, z) - 1, z, sx: 11, sy: 7, sz: 11 }; });
  things.push(...tiledInstances(scene, unitBox, new THREE.MeshLambertMaterial({ color: 0x6d737a }), st, 1000, 4000, (m) => { m.castShadow = true; }));

  // ---- the course: a dirt trail, red-and-white tape either side, kilometre boards
  const trailMat = new THREE.MeshLambertMaterial({ map: textures().dirt, color: 0xd8c2a0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  scene.add(quality === 'low' ? ribbon(T, cs, TRAIL_W, 0.18, 0, trailMat) : trailMesh(T, cs));
  if (quality !== 'low') things.push(...stones(scene, T, cs, r));
  const posts = [], tapeL = [], tapeR = [];
  for (let d = 0, k = 0; d < cs[cs.length - 1].d; d += 12, k++) {
    const p = pointAt(cs, d), nx = Math.cos(p.h), nz = -Math.sin(p.h);
    for (const s of [-1, 1]) {
      const x = p.x + nx * (TRAIL_W / 2 + 0.6) * s, z = p.z + nz * (TRAIL_W / 2 + 0.6) * s, y = T.hAt(x, z);
      posts.push({ x, y, z, sx: 0.06, sy: 1.1, sz: 0.06, color: k % 2 ? 0xe2231a : 0xffffff });
      (s < 0 ? tapeL : tapeR).push(new THREE.Vector3(x, y + 0.95, z));
    }
  }
  things.push(...tiledInstances(scene, unitBox, new THREE.MeshLambertMaterial({ color: 0xffffff }), posts, 400, 900));
  const tapePos = [];
  for (const side of [tapeL, tapeR]) for (let i = 1; i < side.length; i++) if (side[i].distanceTo(side[i - 1]) < 30) tapePos.push(side[i - 1].x, side[i - 1].y, side[i - 1].z, side[i].x, side[i].y, side[i].z);
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(tapePos, 3));
  scene.add(new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: 0xe2231a })));
  for (let km = 1; km * 1000 < cs[cs.length - 1].d; km++) {
    const p = pointAt(cs, km * 1000), nx = Math.cos(p.h), nz = -Math.sin(p.h);
    const s = textSprite(km + ' KM', { size: 1.1 }); s.position.set(p.x + nx * 3.2, T.hAt(p.x + nx * 3.2, p.z + nz * 3.2) + 2.2, p.z + nz * 3.2); scene.add(s);
  }

  // ---- obstacles on the trail
  const obs = course.obstacles.map((o, k) => {
    const kind = obstacleKind(o.name), p = pointAt(cs, o.at);
    const B = obstacleModel(o.name, kind, { kids: !!course.kids, low: quality === 'low' }), m = B.group;
    m.position.set(p.x, T.hAt(p.x, p.z), p.z); m.rotation.y = p.h;
    scene.add(m);
    // solid: its frames, posts and walls, as boxes turned to the course
    const c = Math.cos(p.h), s = Math.sin(p.h);
    for (const b of B.colliders) obstacles.add(p.x + b.x * c + b.z * s, p.z - b.x * s + b.z * c, { t: 'obox', hx: b.hx, hz: b.hz, c, s });
    // the ground worn bare and muddy around it, following the slope
    scene.add(padMesh(T, p, B.half + 0.8, B.len + 1));
    m.updateMatrixWorld(true);
    m.userData = { sphere: new THREE.Sphere(new THREE.Vector3(p.x, m.position.y + 2, p.z), Math.hypot(B.half, B.len) + 4), maxD: 900 };
    things.push(m);
    return { ...o, k, kind, x: p.x, z: p.z, y: m.position.y, h: p.h, model: m, spec: B.spec, tick: B.tick, bells: B.bells };
  });

  // ---- penalty loops (drawn as a lighter trail) and the burpee areas
  const loops = {};
  for (const [name, line] of Object.entries(pack.penaltyLoops || {})) {
    if (!course.obstacles.some((o) => o.penalty === name)) continue;
    const P = sampleLine(T, line, 4);
    loops[name] = P;
    scene.add(ribbon(T, P, 2.6, 0.16, 0, trailMat));
  }
  // burpee stations: where the course passes a burpee area (then the burpees owed for missed obstacles are done)
  const burpeeStations = [];
  for (const poly of pack.burpeeAreas || []) {
    const xz = poly.map(([la, lo]) => toXZ(la, lo)), cx = xz.reduce((a, p) => a + p[0], 0) / xz.length, cz = xz.reduce((a, p) => a + p[1], 0) / xz.length;
    let last = -1e9;
    for (const p of cs) if (Math.hypot(p.x - cx, p.z - cz) < 40 && p.d - last > 300) { burpeeStations.push({ at: p.d, x: p.x, z: p.z }); last = p.d; }
  }
  burpeeStations.sort((a, b) => a.at - b.at);
  for (const poly of pack.burpeeAreas || []) {
    const xz = poly.map(([la, lo]) => toXZ(la, lo));
    const pts = resample(T, xz, 3);
    scene.add(ribbon(T, pts, 0.6, 0.2, 0xe2231a));
    const cx = xz.reduce((a, p) => a + p[0], 0) / xz.length, cz = xz.reduce((a, p) => a + p[1], 0) / xz.length;
    const s = textSprite('BURPEES', { size: 1 }); s.position.set(cx, T.hAt(cx, cz) + 2.5, cz); scene.add(s);
  }

  // ---- start / finish arches, water stations, medical tents, timing mats, marshals, landmarks
  const arch = (x, z, h, label) => {
    const g = new THREE.Group(), y = T.hAt(x, z);
    g.add(box(0.6, 5, 0.6, MAT.dark, -3.6, 2.5, 0), box(0.6, 5, 0.6, MAT.dark, 3.6, 2.5, 0), box(7.8, 1.2, 0.6, MAT.red, 0, 5.3, 0));
    // a banner on each face, each readable from its own side
    const t = textPlane(label, 7, 1.1, { bg: '#e2231a', accent: '#0b0b0b' }); t.material.side = THREE.FrontSide; t.position.set(0, 5.3, 0.31); g.add(t);
    const t2 = t.clone(); t2.position.z = -0.31; t2.rotation.y = Math.PI; g.add(t2);
    g.position.set(x, y, z); g.rotation.y = h; scene.add(g);
  };
  const first = cs[0], last = cs[cs.length - 1];
  arch(first.x, first.z, first.h, 'START');
  if (Math.hypot(last.x - first.x, last.z - first.z) > 8) arch(last.x, last.z, last.h, 'FINISH');
  else { const p = pointAt(cs, last.d - 15); arch(p.x, p.z, p.h, 'FINISH'); }
  const water = course.water.map((w) => {
    const p = pointAt(cs, w.at), nx = Math.cos(p.h), nz = -Math.sin(p.h), x = p.x + nx * 4, z = p.z + nz * 4, y = T.hAt(x, z);
    const g = new THREE.Group();
    g.add(box(2.4, 0.08, 0.8, MAT.white, 0, 0.9, 0), box(0.08, 0.9, 0.08, MAT.metal, -1.1, 0.45, 0), box(0.08, 0.9, 0.08, MAT.metal, 1.1, 0.45, 0));
    for (let k = 0; k < 6; k++) g.add(cyl(0.04, 0.1, new THREE.MeshLambertMaterial({ color: 0x4aa3e0 }), -0.9 + k * 0.36, 0.99, 0));
    const tent = new THREE.Mesh(new THREE.ConeGeometry(2.4, 1.2, 4), MAT.red); tent.position.y = 3; tent.rotation.y = Math.PI / 4; g.add(tent);
    for (const [a, b] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) g.add(box(0.06, 2.4, 0.06, MAT.metal, a, 1.2, b));
    const s = textSprite('WATER', { size: 0.9, bg: '#1d6fb8' }); s.position.y = 4.2; g.add(s);
    g.position.set(x, y, z); g.rotation.y = p.h; scene.add(g);
    return { ...w, x: p.x, z: p.z };
  });
  const sc = pack.scenery || {};
  for (const [la, lo] of sc.medical || []) {
    const [x, z] = toXZ(la, lo), g = new THREE.Group();
    g.add(box(3, 2.2, 3, MAT.white, 0, 1.1, 0)); const c1 = box(1.2, 0.3, 0.02, MAT.red, 0, 1.6, 1.51), c2 = box(0.3, 1.2, 0.02, MAT.red, 0, 1.6, 1.51); g.add(c1, c2);
    g.position.set(x + 6, T.hAt(x + 6, z), z); scene.add(g);
  }
  // ---- where officials stand (every obstacle, the marshal points) and where crowds gather (in town, at the start and finish)
  const officials = [];
  for (const o of obs) for (const side of [1, -1]) {
    if (side < 0 && r() < 0.5) continue;
    const back = pointAt(cs, o.at - 3), nx = Math.cos(back.h) * side, nz = -Math.sin(back.h) * side, x = back.x + nx * (TRAIL_W / 2 + 2.2), z = back.z + nz * (TRAIL_W / 2 + 2.2);
    officials.push({ x, y: T.hAt(x, z), z, face: back.h - (Math.PI / 2) * side, kind: 'official' });
  }
  for (const [la, lo] of sc.marshals || []) {
    const [mx, mz] = toXZ(la, lo); let best = null, bd = 60;
    for (let i = 0; i < cs.length; i += 3) { const d = Math.hypot(cs[i].x - mx, cs[i].z - mz); if (d < bd) { bd = d; best = cs[i]; } }
    if (!best) continue;
    const nx = Math.cos(best.h), nz = -Math.sin(best.h), x = best.x + nx * (TRAIL_W / 2 + 1.8), z = best.z + nz * (TRAIL_W / 2 + 1.8);
    officials.push({ x, y: T.hAt(x, z), z, face: best.h - Math.PI / 2, kind: 'official' });
  }
  const bcount = new Map(), bk = (x, z) => Math.floor(x / 60) + ':' + Math.floor(z / 60);
  for (const w of walls) bcount.set(bk(w.x, w.z), (bcount.get(bk(w.x, w.z)) || 0) + 1);
  const town = (x, z) => { let n = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) n += bcount.get(bk(x + a * 60, z + b * 60)) || 0; return n; };
  const spectators = [], total = cs[cs.length - 1].d;
  for (let d = 4; d < total - 2; d += 2.4) {
    const p = pointAt(cs, d), busy = d < 140 || d > total - 160 || town(p.x, p.z) >= 14;
    if (!busy || obs.some((o) => Math.abs(o.at - d) < 14)) continue;
    for (const side of [1, -1]) {
      if (r() < 0.35) continue;
      const off = TRAIL_W / 2 + 1.4 + r() * 1.6, nx = Math.cos(p.h) * side, nz = -Math.sin(p.h) * side, x = p.x + nx * off, z = p.z + nz * off;
      let inside = false; obstacles.near(x, z, (o) => { if (o.t === 'box' && Math.abs(x - o.x) < o.hx && Math.abs(z - o.z) < o.hz) inside = true; });
      if (!inside) spectators.push({ x, y: T.hAt(x, z), z, face: p.h - (Math.PI / 2) * side + (r() - 0.5) * 0.6, kind: 'spectator' });
    }
  }
  for (const [la, lo, name] of sc.landmarks || []) {
    const [x, z] = toXZ(la, lo); const s = textSprite(name.replace(/^\w/, (c) => c.toUpperCase()), { size: 6, bg: 'rgba(11,11,11,0.75)' });
    s.position.set(x, T.hAt(x, z) + 14, z); scene.add(s);
  }

  // can grass grow here? (not on the trail or a road, not in a forest, not on rock)
  const grassOK = (x, z) => {
    if (onTrail.has(ck(x, z, 4))) return false;
    const fj = Math.round((x - T.x0) / T.dx), fi = Math.round((T.z0 - z) / T.dz);
    if (fi < 0 || fj < 0 || fi >= T.nI || fj >= T.nJ || T.forest[fi * T.nJ + fj]) return false;
    const e = 1.5, gx = (T.hAt(x + e, z) - T.hAt(x - e, z)) / (2 * e), gz = (T.hAt(x, z + e) - T.hAt(x, z - e)) / (2 * e);
    return gx * gx + gz * gz < 0.5;
  };
  return { cs, obs, loops, water, obstacles, things, officials, spectators, grassOK, burpeeStations };
}

const LOD_D = 350; // trees beside the trail: detailed within this distance (m)
/** Shows only the tiles that are near enough and in view (every few frames). */
export function cullThings(things, camera) {
  const fr = new THREE.Frustum(), m = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  fr.setFromProjectionMatrix(m);
  const cp = camera.getWorldPosition(new THREE.Vector3());
  for (const t of things) {
    const u = t.userData;
    const d = cp.distanceTo(u.sphere.center) - u.sphere.radius;
    t.visible = d < u.maxD * (u.scale || 1) && fr.intersectsSphere(u.sphere);
    if (u.lod) { const cd = cp.distanceTo(u.sphere.center); if (u.lod === 'near' ? cd > LOD_D : cd <= LOD_D) t.visible = false; } // detailed close up, simple far off
    // only what's near casts a shadow (the shadow box only covers the ground around the runner anyway)
    if (u.shadow === undefined) u.shadow = t.castShadow;
    if (u.shadow && !t.isGroup) t.castShadow = t.visible && d < 60;
  }
}

/** Grass tufts around the runner: a fixed set of instances laid out again as you move (the same tufts in the same places). */
export function makeGrass(scene, T, grassOK, count) {
  const blades = [];
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2 + (k % 3) * 0.4, b = new THREE.BufferGeometry(), w = 0.018 + (k % 3) * 0.006, h = 0.16 + ((k * 7) % 5) * 0.035, lean = 0.05 + (k % 4) * 0.03;
    b.setAttribute('position', new THREE.Float32BufferAttribute([-w * Math.cos(a), 0, w * Math.sin(a), w * Math.cos(a), 0, -w * Math.sin(a), Math.sin(a) * lean, h, Math.cos(a) * lean], 3));
    const tip = k % 4 === 3 ? [0.62, 0.64, 0.3] : k % 3 ? [0.44, 0.66, 0.22] : [0.38, 0.58, 0.2];
    b.setAttribute('color', new THREE.Float32BufferAttribute([0.2, 0.32, 0.1, 0.2, 0.32, 0.1, ...tip], 3));
    b.computeVertexNormals(); blades.push(b);
  }
  // keep the blade shading (dark at the root, light at the tip; already linear) rather than the merge's flat colour
  const shades = blades.map((b) => b.attributes.color.array.slice());
  const geo = merge(blades.map((b) => [b, 0xffffff]));
  const cols = geo.attributes.color.array; let o = 0; for (const c of shades) { cols.set(c, o); o += c.length; }
  const gm = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), wind = { value: 0 };
  // the blades sway in the wind, the tips most, in gusts that roll across the meadow
  gm.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;').replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec2 ip = instanceMatrix[3].xz;
        float gust = sin(uWind * 1.3 + ip.x * 0.15 + ip.y * 0.11) * 0.5 + 0.5;
        transformed.x += sin(uWind * 2.7 + ip.x * 0.9 + ip.y * 0.7) * 0.05 * position.y * (1.0 + gust * 2.0);
        transformed.z += cos(uWind * 2.1 + ip.x * 0.6) * 0.03 * position.y * (1.0 + gust);
      #endif`);
  };
  const mesh = new THREE.InstancedMesh(geo, gm, count);
  mesh.frustumCulled = false; mesh.receiveShadow = true;
  scene.add(mesh);
  const STEP = 0.55, m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3(), p = new THREE.Vector3();
  const hash = (i, j) => { const h = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return h - Math.floor(h); };
  let lx = Infinity, lz = Infinity;
  return function update(x, z, dt = 0) {
    wind.value += dt;
    if (Math.hypot(x - lx, z - lz) < 6) return;
    lx = x; lz = z;
    const R = Math.sqrt(count / Math.PI) * STEP * 0.95;
    let n = 0;
    const i0 = Math.floor((x - R) / STEP), i1 = Math.ceil((x + R) / STEP), j0 = Math.floor((z - R) / STEP), j1 = Math.ceil((z + R) / STEP);
    for (let i = i0; i <= i1 && n < count; i++) for (let j = j0; j <= j1 && n < count; j++) {
      const h1 = hash(i, j), h2 = hash(j + 7, i - 3);
      const gx = (i + h1) * STEP, gz = (j + h2) * STEP;
      if ((gx - x) ** 2 + (gz - z) ** 2 > R * R || h1 < 0.25 || !grassOK(gx, gz)) continue;
      const s = 0.6 + h2 * 0.6;
      q.setFromAxisAngle(up, h1 * 6.28); sc.set(s, s * (0.8 + h1 * 0.6), s); p.set(gx, T.hAt(gx, gz) + 0.12, gz);
      m4.compose(p, q, sc); mesh.setMatrixAt(n++, m4);
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
  };
}
