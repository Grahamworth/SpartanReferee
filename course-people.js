// People for Course Run: the runner, the other contestants, officials and
// spectators, all from one rigged, animated human (three.js's Xbot, a Mixamo
// figure with idle / walk / run). Clothes, skin and shoes are coloured by
// which bone each part of the body follows, so any look can be dressed on the
// same body; hair, hats, eyes and the race number are attached to the bones.
/* global THREE */

const MODEL_URL = 'vendor/models/Xbot.glb';
let BASE = null;

// The model's bottom is on the generous side: pull the back of the hips and the seat in a little (once, on the shared
// body, in the bind pose; a smooth falloff so nothing creases).
function slimHips(scene) {
  scene.updateMatrixWorld(true);
  const v = new THREE.Vector3(), m = new THREE.Matrix4(), inv = new THREE.Matrix4();
  const band = (y, a, b, c, d) => (y <= a || y >= d ? 0 : y < b ? (y - a) / (b - a) : y > c ? (d - y) / (d - c) : 1);
  scene.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    m.multiplyMatrices(o.matrixWorld, o.bindMatrix); inv.copy(m).invert();
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m);
      const s = 100; // world units here are 1/100 of a metre (the armature is scaled)
      const x = v.x * s, y = v.y * s, z = v.z * s;
      const k = band(y, 0.76, 0.86, 1.02, 1.14);
      if (!k) continue;
      const behind = Math.min(1, Math.max(0, (0.03 - z) / 0.05)); // the back half more than the front
      const nz = 0.025 + (z - 0.025) * (1 - 0.22 * k * behind), nx = x * (1 - 0.07 * k);
      v.set(nx / s, y / s, nz / s).applyMatrix4(inv);
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    pos.needsUpdate = true; o.geometry.computeVertexNormals();
  });
}

// An athlete's build, lean but muscular: on the shared body in the bind pose, each limb is reshaped around its bone
// (biceps and triceps, the forearm's swell, the quads, the calves at the back of the shin, a stronger neck and
// shoulders), the chest broadened and the waist taken in. Each vertex follows the bones it's weighted to, blended,
// so the joints stay smooth.
function athletic(scene) {
  const bump = (t, c, w) => Math.exp(-(((t - c) / w) ** 2)), comp = (a, i, k) => (k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i));
  const meshes = []; scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  if (!meshes.length) return;
  const bones = meshes[0].skeleton.bones, names = bones.map((b) => b.name.replace('mixamorig', '')), idx = {};
  names.forEach((n, i) => { idx[n] = i; });
  // Measured on the mesh itself (so it's in the same space as the vertices; each vertex follows one bone): the middle
  // of each bone's vertices, and a limb's two ends where its vertices stop along the line towards the next bone.
  const C = names.map(() => [new THREE.Vector3(), 0]), v = new THREE.Vector3();
  const boneOf = (o, i) => { let top = -1, tw = 0; for (let k = 0; k < 4; k++) { const w = comp(o.geometry.attributes.skinWeight, i, k); if (w > tw) { tw = w; top = comp(o.geometry.attributes.skinIndex, i, k); } } return top; };
  for (const o of meshes) { const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i++) { const b = boneOf(o, i); if (b >= 0) { C[b][0].add(v.fromBufferAttribute(pos, i)); C[b][1]++; } } }
  const centre = (n) => { const c = C[idx[n]]; return c && c[1] ? c[0].clone().divideScalar(c[1]) : null; };
  const ends = (n, next) => {
    const c = centre(n), cn = centre(next); if (!c || !cn) return [null, null];
    const dir = cn.clone().sub(c).normalize(); let lo = Infinity, hi = -Infinity;
    for (const o of meshes) { const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i++) if (boneOf(o, i) === idx[n]) { const t = v.fromBufferAttribute(pos, i).sub(c).dot(dir); lo = Math.min(lo, t); hi = Math.max(hi, t); } }
    return [c.clone().addScaledVector(dir, lo), c.clone().addScaledVector(dir, hi)];
  };
  const A = { up0: centre('Spine'), up1: centre('Neck'), l: centre('LeftArm'), r: centre('RightArm'), foot: centre('LeftFoot'), toe: centre('LeftToeBase') };
  if (Object.values(A).some((x) => !x)) return;
  const up = A.up1.clone().sub(A.up0).normalize();
  const lat = A.l.clone().sub(A.r); lat.addScaledVector(up, -lat.dot(up)).normalize();
  const fwd = A.toe.clone().sub(A.foot); fwd.addScaledVector(up, -fwd.dot(up)).addScaledVector(lat, -fwd.dot(lat)).normalize();
  const limbs = {};
  for (const s of ['Left', 'Right']) {
    limbs[s + 'Arm'] = [...ends(s + 'Arm', s + 'ForeArm'), (t) => 1 + 0.18 * bump(t, 0.5, 0.26) + 0.12 * bump(t, 0.03, 0.14)];   // biceps / triceps, deltoid
    limbs[s + 'ForeArm'] = [...ends(s + 'ForeArm', s + 'Hand'), (t) => 1 + 0.09 * bump(t, 0.2, 0.22) - 0.06 * bump(t, 1, 0.22)];   // the swell below the elbow, slim wrist
    limbs[s + 'UpLeg'] = [...ends(s + 'UpLeg', s + 'Leg'), (t, f) => 1 - 0.14 * bump(t, 0, 0.28) + (0.03 + 0.06 * f) * bump(t, 0.55, 0.22) - 0.05 * bump(t, 0.97, 0.12)]; // quads, lean knee
    limbs[s + 'Leg'] = [...ends(s + 'Leg', s + 'Foot'), (t, f) => 1 + 0.16 * (1 - f) * bump(t, 0.28, 0.16) - 0.05 * bump(t, 0.92, 0.14)];     // calves, slim ankle
    limbs[s + 'Shoulder'] = [...ends(s + 'Shoulder', s + 'Arm'), (t) => 1 + 0.12 * t];                                                   // traps into delts
  }
  limbs.Neck = [...ends('Neck', 'Head'), (t) => 1.08 - 0.05 * t];
  const torso = { Spine2: [1.1, 1.09, 1.02], Spine1: [1.0, 1.03, 0.98], Spine: [0.92, 0.97, 0.95], Hips: [0.86, 0.95, 0.8] }; // across, front, back
  const tc = {}; for (const n in torso) tc[n] = centre(n);
  const out = new THREE.Vector3(), q = new THREE.Vector3(), seg = new THREE.Vector3(), r = new THREE.Vector3(), d = new THREE.Vector3();
  for (const o of meshes) {
    const pos = o.geometry.attributes.position, si = o.geometry.attributes.skinIndex, sw = o.geometry.attributes.skinWeight;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      out.set(0, 0, 0); let wsum = 0;
      for (let k = 0; k < 4; k++) {
        const w = comp(sw, i, k); if (w <= 0) continue;
        const n = names[comp(si, i, k)], L = limbs[n];
        q.copy(v);
        if (L && L[0] && L[1]) {
          const a = L[0]; seg.subVectors(L[1], a);
          const t = Math.max(0, Math.min(1, d.subVectors(v, a).dot(seg) / seg.lengthSq()));
          const p = a.clone().addScaledVector(seg, t); r.subVectors(v, p);
          const f = 0.5 + 0.5 * (r.dot(fwd) / (r.length() || 1)); // 1 at the front, 0 at the back
          q.copy(p).addScaledVector(r, L[2](t, f));
        } else if (torso[n] && tc[n]) {
          const T = torso[n]; r.subVectors(v, tc[n]);
          const x = r.dot(lat), z = r.dot(fwd);
          q.copy(v).addScaledVector(lat, x * (T[0] - 1)).addScaledVector(fwd, z * ((z > 0 ? T[1] : T[2]) - 1));
        }
        out.addScaledVector(q, w); wsum += w;
      }
      if (wsum > 0) { out.multiplyScalar(1 / wsum); pos.setXYZ(i, out.x, out.y, out.z); }
    }
    pos.needsUpdate = true; o.geometry.computeVertexNormals();
  }
}

export async function loadPeople() {
  if (BASE) return BASE;
  const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().load(MODEL_URL, res, undefined, rej));
  const clips = {};
  for (const c of gltf.animations) clips[c.name] = c;
  slimHips(gltf.scene);
  athletic(gltf.scene);
  BASE = { scene: gltf.scene, clips };
  return BASE;
}

// ---------------------------------------------------------------- looks
export const SKINS = ['#f3d2b8', '#e7b896', '#d19a6e', '#a8704a', '#7a4a2c', '#4e2f1d'];
export const HAIR_COLS = ['#1b1410', '#3b2516', '#6a4325', '#a8763e', '#d9b46a', '#b8b8b8', '#9c2f1f'];
export const HAIRS = { none: 'None', buzz: 'Buzz cut', short: 'Short', long: 'Long', ponytail: 'Ponytail', bun: 'Bun' };
export const HATS = { none: 'None', headband: 'Headband', cap: 'Cap', visor: 'Visor', beanie: 'Beanie', bucket: 'Bucket hat' };
export const TOPS = { vest: 'Vest', tee: 'T-shirt', long: 'Long sleeves', bare: 'No top' };
export const BOTTOMS = { shorts: 'Shorts', tights: '3/4 tights', leggings: 'Leggings' };
export const KIT_COLS = ['#e2231a', '#0b0b0b', '#f2f2f2', '#1d4fa8', '#2f8f3a', '#f2b705', '#ff6a13', '#7a2fa8', '#e84a8a', '#3fb8c6', '#6b6b6b', '#4a3626'];
export const DEFAULT_LOOK = { skin: SKINS[1], hair: 'short', hairCol: HAIR_COLS[1], hat: 'headband', hatCol: '#e2231a', top: 'tee', topCol: '#0b0b0b', bottom: 'shorts', bottomCol: '#0b0b0b', shoeCol: '#f2f2f2', socks: '#f2f2f2', number: '' };

const pick = (r, a) => a[Math.floor(r() * a.length)];
export function randomLook(r, kind = 'runner') {
  const look = {
    skin: pick(r, SKINS), hair: pick(r, ['buzz', 'short', 'short', 'long', 'ponytail', 'bun', 'none']), hairCol: pick(r, HAIR_COLS),
    hat: pick(r, ['none', 'none', 'headband', 'cap', 'visor', 'beanie']), hatCol: pick(r, KIT_COLS),
    top: pick(r, ['vest', 'tee', 'tee', 'long']), topCol: pick(r, KIT_COLS), bottom: pick(r, ['shorts', 'shorts', 'tights', 'leggings']), bottomCol: pick(r, ['#0b0b0b', '#0b0b0b', '#1d2a44', '#6b6b6b', ...KIT_COLS]),
    shoeCol: pick(r, ['#f2f2f2', '#0b0b0b', '#e2231a', '#1d4fa8', '#f2b705', '#3fb8c6']), socks: pick(r, ['#f2f2f2', '#0b0b0b', '#6b6b6b']),
    number: String(1000 + Math.floor(r() * 8999)),
  };
  if (kind === 'official') Object.assign(look, { top: 'long', topCol: '#d8f000', bottom: 'leggings', bottomCol: '#1d2a44', hat: r() < 0.6 ? 'cap' : 'none', hatCol: '#0b0b0b', number: '' });
  if (kind === 'spectator') Object.assign(look, { top: r() < 0.4 ? 'long' : 'tee', bottom: r() < 0.6 ? 'leggings' : 'shorts', bottomCol: pick(r, ['#1d2a44', '#3d4a5c', '#6b6b6b', '#c9b48a', '#0b0b0b']), number: '' });
  return look;
}

// Which part of the body each bone carries: s skin, t top, a upper arm, f forearm, h hips, u thigh, l shin, x shoe.
function boneRegion(name) {
  if (/Foot|Toe/.test(name)) return 'x';
  if (/UpLeg/.test(name)) return 'u';
  if (/Leg/.test(name)) return 'l';
  if (/Hips/.test(name)) return 'h';
  if (/Spine|Shoulder/.test(name)) return 't';
  if (/ForeArm/.test(name)) return 'f';
  if (/Arm/.test(name)) return 'a';
  return 's'; // head, neck, eyes, hands
}
function regionColours(look) {
  const C = (h) => new THREE.Color(h);
  const skin = C(look.skin), top = look.top === 'bare' ? skin : C(look.topCol), bottom = C(look.bottomCol);
  return {
    s: skin, t: top, h: bottom, x: C(look.shoeCol),
    a: look.top === 'tee' || look.top === 'long' ? top : skin,
    f: look.top === 'long' ? top : skin,
    u: bottom,
    l: look.bottom === 'leggings' ? bottom : look.bottom === 'tights' ? skin.clone().lerp(bottom, 0.5) : skin,
  };
}

// The body's material: coloured per bone by the skin weights (so the colours blend softly at the joints).
function bodyMaterial(bones, joints) {
  const cols = bones.map(() => new THREE.Color(1, 1, 1));
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, skinning: true });
  m.userData.cols = cols;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.boneCol = { value: cols };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform vec3 boneCol[${cols.length}];\nvarying vec3 vRegion;`)
      .replace('#include <skinbase_vertex>', `#include <skinbase_vertex>\nvRegion = boneCol[int(skinIndex.x)] * skinWeight.x + boneCol[int(skinIndex.y)] * skinWeight.y + boneCol[int(skinIndex.z)] * skinWeight.z + boneCol[int(skinIndex.w)] * skinWeight.w;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRegion;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', `vec4 diffuseColor = vec4( diffuse * vRegion, opacity );`);
  };
  m.customProgramCacheKey = () => 'body' + (joints ? 'j' : '') + cols.length;
  return m;
}

// Hair and hats, in metres around the centre of the head (x left, y up, z forward). The model's head is an
// egg about 0.18 wide, 0.24 tall and 0.25 deep (HEAD), centred a little above the eyes.
const HEAD = [0.088, 0.12, 0.125];
function headGear(look) {
  const g = new THREE.Group();
  const hairM = new THREE.MeshStandardMaterial({ color: look.hairCol, roughness: 0.85 });
  const hatM = new THREE.MeshStandardMaterial({ color: look.hatCol, roughness: 0.7 });
  // a shell over the head: the top of an ellipsoid a little bigger than the head, tipped back so the face stays clear
  const shell = (grow, cut, tilt, m, y = 0) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, cut), m);
    s.scale.set(HEAD[0] + grow, HEAD[1] + grow, HEAD[2] + grow); s.rotation.x = -tilt; s.position.y = y; s.castShadow = true; return s;
  };
  const band = (grow, h, y, m) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, h, 28, 1, true), m); c.scale.set(HEAD[0] + grow, 1, HEAD[2] + grow); c.position.y = y; c.rotation.x = -0.12; return c; };
  const covered = look.hat === 'beanie' || look.hat === 'bucket';
  if (look.hair !== 'none') {
    if (!covered) g.add(shell(look.hair === 'buzz' ? 0.003 : 0.012, look.hair === 'buzz' ? 1.35 : 1.75, 0.55, hairM));
    if (look.hair === 'long') { const back = shell(0.016, 1.2, 1.75, hairM, -0.03); back.scale.y *= 1.25; g.add(back); }
    if (look.hair === 'ponytail') { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.01, 0.24, 10), hairM); p.position.set(0, -0.03, -0.15); p.rotation.x = 0.45; p.castShadow = true; g.add(p); }
    if (look.hair === 'bun') { const b = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), hairM); b.position.set(0, 0.06, -0.12); g.add(b); }
  }
  if (look.hat === 'headband') g.add(band(0.012, 0.032, 0.035, hatM));
  if (look.hat === 'cap' || look.hat === 'visor') {
    if (look.hat === 'cap') g.add(shell(0.02, 1.3, 0.25, hatM, 0.01)); else g.add(band(0.016, 0.04, 0.045, hatM));
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.008, 20, 1, false, -Math.PI / 2, Math.PI), hatM);
    brim.position.set(0, 0.05, HEAD[2] + 0.005); brim.rotation.x = 0.12; brim.scale.set(1.05, 1, 1); g.add(brim);
  }
  if (look.hat === 'beanie') { g.add(shell(0.02, 1.7, 0.4, hatM, 0.01)); const f = band(0.026, 0.045, 0.0, hatM); f.rotation.x = -0.4; g.add(f); }
  if (look.hat === 'bucket') { g.add(shell(0.02, 1.5, 0.15, hatM, 0.015)); const brim = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.25, 0.045, 28, 1, true), hatM); brim.scale.set(HEAD[0] + 0.05, 1, HEAD[2] + 0.05); brim.position.y = 0.02; g.add(brim); }
  // eyes, eyebrows (hair coloured) and a mouth
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.3 }), iris = new THREE.MeshStandardMaterial({ color: 0x2a1c12, roughness: 0.2 });
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.013, 10, 8), white); e.position.set(sx * 0.034, -0.034, 0.111); g.add(e);
    const i = new THREE.Mesh(new THREE.SphereGeometry(0.0072, 8, 6), iris); i.position.set(sx * 0.034, -0.034, 0.123); g.add(i);
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.005, 0.006), hairM); brow.position.set(sx * 0.035, -0.012, 0.122); brow.rotation.z = sx * -0.12; g.add(brow);
  }
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.004, 0.004), new THREE.MeshStandardMaterial({ color: 0x8a3a2e, roughness: 0.6 }));
  mouth.position.set(0, -0.098, 0.112); g.add(mouth);
  return g;
}
function bibMesh(number) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 96;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 96); g.fillStyle = '#e2231a'; g.fillRect(0, 0, 128, 16);
  g.fillStyle = '#111'; g.font = 'bold 56px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(number, 64, 58);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.125), new THREE.MeshStandardMaterial({ map: t, roughness: 0.8, side: THREE.DoubleSide }));
  m.rotation.x = -0.12;
  const holder = new THREE.Group(); holder.add(m);
  return holder;
}

// The local transform that puts a child of a bone at worldPos with no rotation, in the pose the bones are in now
// (worked out once, straight after loading, while the bones are in the bind pose; the bones are scaled 1/100).
function localAt(bone, worldPos) {
  bone.updateWorldMatrix(true, false);
  return new THREE.Matrix4().makeTranslation(worldPos.x, worldPos.y, worldPos.z).premultiply(new THREE.Matrix4().copy(bone.matrixWorld).invert());
}
function attach(bone, obj, local) { local.decompose(obj.position, obj.quaternion, obj.scale); bone.add(obj); }

// ---------------------------------------------------------------- a person
export function makePerson(look, { shadows = true } = {}) {
  const model = THREE.SkeletonUtils.clone(BASE.scene), root = new THREE.Group();
  root.add(model);
  const bones = {};
  let skeleton = null;
  model.traverse((o) => {
    if (o.isBone) bones[o.name.replace('mixamorig', '')] = o;
    if (o.isSkinnedMesh) { skeleton = o.skeleton; o.castShadow = shadows; o.receiveShadow = false; o.frustumCulled = false; }
  });
  const mats = [];
  model.traverse((o) => { if (o.isSkinnedMesh) { o.material = bodyMaterial(o.skeleton.bones, /Joints/.test(o.name)); mats.push(o.material); } });
  model.updateMatrixWorld(true);
  const P = { root, model, bones, skeleton, mats, look: null, gear: null, bib: null, mixer: new THREE.AnimationMixer(model), actions: {}, cur: null, pose: null, poseT: 0, phase: Math.random() * 10 };
  for (const n of ['idle', 'walk', 'run']) { const a = P.mixer.clipAction(BASE.clips[n]); a.play(); a.weight = n === 'idle' ? 1 : 0; P.actions[n] = a; }
  // where the head and chest are in the bind pose (from the model's bones)
  const eye = bones.LeftEye.getWorldPosition(new THREE.Vector3());
  P.headLocal = localAt(bones.Head, new THREE.Vector3(0, eye.y + 0.033, eye.z - 0.078));
  P.chestLocal = localAt(bones.Spine1, new THREE.Vector3(0, 1.268, 0.153));
  P.setLook = (lk) => setLook(P, lk);
  P.setLook(look);
  return P;
}
function setLook(P, look) {
  P.look = { ...look };
  const rc = regionColours(look);
  for (const m of P.mats) m.userData.cols.forEach((c, i) => c.copy(rc[boneRegion(P.skeleton.bones[i].name)]));
  if (P.gear) { P.gear.parent.remove(P.gear); P.gear.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  P.gear = headGear(look); attach(P.bones.Head, P.gear, P.headLocal);
  if (P.bib) { P.bib.parent.remove(P.bib); P.bib.children[0].material.map.dispose(); P.bib = null; }
  if (look.number) { P.bib = bibMesh(look.number); attach(P.bones.Spine1, P.bib, P.chestLocal); }
}

// ---------------------------------------------------------------- moving
// Points a bone so its child lies along a direction (given in the person's own frame: x left, y up, z forward).
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
function aim(P, name, childName, dir, k = 1) {
  const b = P.bones[name], c = P.bones[childName]; if (!b || !c) return;
  b.updateWorldMatrix(true, true);
  const from = c.getWorldPosition(_v1).sub(b.getWorldPosition(_v2)).normalize();
  const want = _v2.copy(dir).normalize().applyQuaternion(P.root.getWorldQuaternion(_q3));
  _q1.setFromUnitVectors(from, want);
  if (k < 1) _q1.slerp(_q2.identity(), 1 - k);
  b.getWorldQuaternion(_q2); _q1.multiply(_q2);              // the bone's new world rotation
  b.parent.getWorldQuaternion(_q2).invert(); b.quaternion.copy(_q2.multiply(_q1));
}
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * Moves a person: speed picks idle / walk / run (blended), or a pose:
 * jump, climb, hang, crawl, carry, throw, balance, cheer, burpee (t 0..1), watch.
 */
export function animatePerson(P, dt, speed, pose = null, t = 0) {
  const want = pose && pose !== 'watch' && pose !== 'jump' ? 'idle' : speed > 2.6 ? 'run' : speed > 0.35 ? 'walk' : 'idle';
  const k = Math.min(1, dt * 6);
  for (const [n, a] of Object.entries(P.actions)) a.weight += ((n === want ? 1 : 0) - a.weight) * k;
  P.actions.run.timeScale = Math.max(0.7, speed / 4.2);
  P.actions.walk.timeScale = Math.max(0.6, speed / 1.5);
  P.mixer.update(dt);
  P.model.position.set(0, 0, 0); P.model.rotation.set(0, 0, 0);
  P.phase += dt;
  const s = Math.sin(P.phase * 5), w = Math.sin(P.phase * 7);
  if (!pose || pose === 'watch') return;
  if (pose === 'jump') { aim(P, 'LeftArm', 'LeftForeArm', V(0.3, 1, 0.3)); aim(P, 'RightArm', 'RightForeArm', V(-0.3, 1, 0.3)); aim(P, 'LeftUpLeg', 'LeftLeg', V(0, -0.6, 0.8)); aim(P, 'LeftLeg', 'LeftFoot', V(0, -1, -0.3)); return; }
  if (pose === 'cheer') {
    aim(P, 'LeftArm', 'LeftForeArm', V(0.5 + w * 0.2, 1, 0.2)); aim(P, 'LeftForeArm', 'LeftHand', V(0.3 + w * 0.4, 1, 0.1));
    aim(P, 'RightArm', 'RightForeArm', V(-0.5 + s * 0.2, 1, 0.2)); aim(P, 'RightForeArm', 'RightHand', V(-0.3 + s * 0.4, 1, 0.1));
    P.model.position.y = Math.max(0, Math.sin(P.phase * 6)) * 0.06; return;
  }
  if (pose === 'balance') { aim(P, 'LeftArm', 'LeftForeArm', V(1, 0.1 + s * 0.15, 0)); aim(P, 'RightArm', 'RightForeArm', V(-1, 0.1 - s * 0.15, 0)); P.model.rotation.z = s * 0.06; return; }
  if (pose === 'throw') { aim(P, 'RightArm', 'RightForeArm', V(-0.3, 0.7, -0.6)); aim(P, 'RightForeArm', 'RightHand', V(0, 1, 0.2)); aim(P, 'LeftArm', 'LeftForeArm', V(0.2, 0.3, 1)); return; }
  if (pose === 'carry') {
    const n = P.propName || '';
    if (/BUCKET|ATLAS/i.test(n)) { // hugged to the chest
      aim(P, 'LeftArm', 'LeftForeArm', V(0.35, -0.35, 0.85)); aim(P, 'LeftForeArm', 'LeftHand', V(-0.8, 0.15, 0.45)); aim(P, 'RightArm', 'RightForeArm', V(-0.35, -0.35, 0.85)); aim(P, 'RightForeArm', 'RightHand', V(0.8, 0.15, 0.45));
    } else if (/TIRE|PLATE|DRAG/i.test(n)) { // hands behind on the rope, leaning into it
      aim(P, 'LeftArm', 'LeftForeArm', V(0.15, -0.8, -0.6)); aim(P, 'RightArm', 'RightForeArm', V(-0.15, -0.8, -0.6)); P.model.rotation.x = 0.25;
    } else { // on the shoulders
      aim(P, 'LeftArm', 'LeftForeArm', V(0.5, 0.7, 0.3)); aim(P, 'LeftForeArm', 'LeftHand', V(-0.6, 0.6, 0)); aim(P, 'RightArm', 'RightForeArm', V(-0.5, 0.7, 0.3)); aim(P, 'RightForeArm', 'RightHand', V(0.6, 0.6, 0));
    }
    return;
  }
  if (pose === 'hang') {
    aim(P, 'LeftArm', 'LeftForeArm', V(0.12, 1, s * 0.3)); aim(P, 'LeftForeArm', 'LeftHand', V(0.05, 1, 0)); aim(P, 'RightArm', 'RightForeArm', V(-0.12, 1, -s * 0.3)); aim(P, 'RightForeArm', 'RightHand', V(-0.05, 1, 0));
    aim(P, 'LeftUpLeg', 'LeftLeg', V(0, -1, s * 0.35)); aim(P, 'RightUpLeg', 'RightLeg', V(0, -1, -s * 0.35)); P.model.position.y = 0.7; return;
  }
  if (pose === 'climb') {
    aim(P, 'LeftArm', 'LeftForeArm', V(0.25, 1, 0.35 + s * 0.2)); aim(P, 'RightArm', 'RightForeArm', V(-0.25, 1, 0.35 - s * 0.2));
    aim(P, 'LeftUpLeg', 'LeftLeg', V(0, -0.3 + s * 0.4, 1)); aim(P, 'LeftLeg', 'LeftFoot', V(0, -1, 0)); aim(P, 'RightUpLeg', 'RightLeg', V(0, -0.3 - s * 0.4, 1)); aim(P, 'RightLeg', 'RightFoot', V(0, -1, 0));
    P.model.position.y = 0.45 + s * 0.05; return;
  }
  if (pose === 'crawl') {
    P.model.rotation.x = Math.PI / 2; P.model.position.set(0, 0.25, -0.9);
    // lying forward: in the body's own frame "forward" is now down, so aim in that frame
    aim(P, 'LeftArm', 'LeftForeArm', V(0.3, -0.2 + s * 0.3, 1)); aim(P, 'RightArm', 'RightForeArm', V(-0.3, -0.2 - s * 0.3, 1));
    return;
  }
  if (pose === 'burpee') {
    // squat, kick back to a plank, chest down, back up, jump and clap overhead
    if (t < 0.2) { const q = t / 0.2; P.model.position.y = -0.45 * q; aim(P, 'LeftUpLeg', 'LeftLeg', V(0.15, -1 + q, q * 1.2), 1); aim(P, 'RightUpLeg', 'RightLeg', V(-0.15, -1 + q, q * 1.2)); aim(P, 'LeftLeg', 'LeftFoot', V(0, -1, -0.2)); aim(P, 'RightLeg', 'RightFoot', V(0, -1, -0.2)); aim(P, 'LeftArm', 'LeftForeArm', V(0.1, -1, 0.6 * q)); aim(P, 'RightArm', 'RightForeArm', V(-0.1, -1, 0.6 * q)); }
    else if (t < 0.6) {
      const down = t > 0.38 && t < 0.5;
      P.model.rotation.x = Math.PI / 2 - (down ? 0.05 : 0.2); P.model.position.set(0, down ? 0.18 : 0.42, -0.95);
      aim(P, 'LeftArm', 'LeftForeArm', V(0.15, -1, down ? -0.5 : 0), 1); aim(P, 'RightArm', 'RightForeArm', V(-0.15, -1, down ? -0.5 : 0));
      aim(P, 'LeftForeArm', 'LeftHand', V(0, -1, down ? 0.6 : 0)); aim(P, 'RightForeArm', 'RightHand', V(0, -1, down ? 0.6 : 0));
    } else if (t < 0.78) { const q = 1 - (t - 0.6) / 0.18; P.model.position.y = -0.45 * q; aim(P, 'LeftUpLeg', 'LeftLeg', V(0.15, -1 + q, q * 1.2)); aim(P, 'RightUpLeg', 'RightLeg', V(-0.15, -1 + q, q * 1.2)); aim(P, 'LeftLeg', 'LeftFoot', V(0, -1, -0.2)); aim(P, 'RightLeg', 'RightFoot', V(0, -1, -0.2)); }
    else { const q = (t - 0.78) / 0.22; P.model.position.y = Math.sin(q * Math.PI) * 0.35; aim(P, 'LeftArm', 'LeftForeArm', V(0.1, 1, 0)); aim(P, 'RightArm', 'RightForeArm', V(-0.1, 1, 0)); }
  }
}


// ---------------------------------------------------------------- carried things
// What a carry obstacle has you carry, placed on the body in the carry pose (or dragged behind on a rope).
const PROP_MAT = {};
const pm = (c, r = 0.8) => PROP_MAT[c] || (PROP_MAT[c] = new THREE.MeshStandardMaterial({ color: c, roughness: r }));
function makeProp(name) {
  const n = String(name || '').toUpperCase(), g = new THREE.Group();
  const add = (geo, mat, x, y, z, rx = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.castShadow = true; g.add(m); return m; };
  if (/LOG/.test(n)) add(new THREE.CylinderGeometry(0.11, 0.12, 1.3, 12), pm(0x8a5a32, 0.95), 0, 1.6, -0.02, 0, Math.PI / 2);         // a log across the shoulders
  else if (/BUCKET/.test(n)) { add(new THREE.CylinderGeometry(0.17, 0.14, 0.34, 14), pm(0x222222), 0, 1.18, 0.28); add(new THREE.CylinderGeometry(0.165, 0.165, 0.03, 14), pm(0x8a7a5a, 1), 0, 1.36, 0.28); } // a bucket of gravel hugged to the chest
  else if (/ATLAS/.test(n)) add(new THREE.SphereGeometry(0.22, 16, 12), pm(0x8f8f8f, 0.9), 0, 1.15, 0.3);                               // the atlas stone held to the chest
  else if (/CHAIN/.test(n)) { for (let i = 0; i < 9; i++) add(new THREE.TorusGeometry(0.05, 0.016, 6, 10), pm(0x6a6a6a, 0.4), -0.28 + i * 0.07, 1.53 + Math.sin(i / 8 * Math.PI) * 0.06, -0.02, 0, i % 2 ? Math.PI / 2 : 0); } // a chain over the shoulders
  else if (/TIRE|PLATE|DRAG/.test(n)) {
    // dragged behind on a rope
    if (/TIRE/.test(n)) add(new THREE.TorusGeometry(0.32, 0.12, 8, 16), pm(0x1a1a1a, 0.95), 0, 0.12, -2.2, Math.PI / 2);
    else add(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 18), pm(0x555555, 0.5), 0, 0.05, -2.2);
    const rope = add(new THREE.CylinderGeometry(0.015, 0.015, 2.1, 5), pm(0xc9b27a, 1), 0, 0.55, -1.15, Math.PI / 2 - 0.4); rope.castShadow = false;
  } else add(new THREE.BoxGeometry(0.62, 0.26, 0.36), pm(0x6b5a3a, 1), 0, 1.6, -0.02);                                                // a sandbag on the shoulders
  return g;
}
/** Shows what the obstacle has you carry (or nothing): call with the obstacle's name, or null. */
export function showProp(P, name) {
  if ((P.propName || null) === (name || null)) return;
  if (P.prop) { P.root.remove(P.prop); P.prop = null; }
  P.propName = name || null;
  if (name) { P.prop = makeProp(name); P.root.add(P.prop); }
}

// ---------------------------------------------------------------- crowds
/**
 * A fixed number of people moved to wherever they're needed near the camera:
 * slots are the places people could be; the nearest ones get a person.
 */
export function makePool(scene, n, looks, opts) {
  const people = [];
  for (let i = 0; i < n; i++) { const p = makePerson(looks(i), opts); p.root.visible = false; scene.add(p.root); people.push(p); }
  return {
    people,
    // assign the nearest slots (within range) to people; keeps a person on its slot while it stays near
    assign(slots, x, z, range) {
      const near = slots.map((s) => [s, (s.x - x) ** 2 + (s.z - z) ** 2]).filter((a) => a[1] < range * range).sort((a, b) => a[1] - b[1]).slice(0, people.length).map((a) => a[0]);
      const keep = new Set(near);
      const free = people.filter((p) => !p.slot || !keep.has(p.slot));
      const taken = new Set(people.filter((p) => p.slot && keep.has(p.slot)).map((p) => p.slot));
      for (const s of near) if (!taken.has(s)) { const p = free.shift(); if (!p) break; p.slot = s; if (s.look) p.setLook(s.look); }
      for (const p of free) { p.slot = null; p.root.visible = false; }
      for (const p of people) if (p.slot) { p.root.visible = true; p.root.position.set(p.slot.x, p.slot.y, p.slot.z); }
    },
  };
}
