// Sky, light and weather for Course Run: a sky dome with the sun, a cloud
// layer, rain, thunder and mist. Like SkiTour's weather: pick one kind, or
// Auto, where the weather changes gradually as you run.
/* global THREE */

// Times of day: sun height and direction, light colours and strengths, sky colours.
export const LIGHTS = {
  morning: { el: 16, az: 110, sun: 0xffe2b8, si: 1.5, hemi: 0.42, top: 0x5f8fc8, hor: 0xe8d2b8, exp: 0.9 },
  midday: { el: 58, az: 170, sun: 0xfff6e8, si: 1.75, hemi: 0.48, top: 0x3f78c4, hor: 0xc6dbee, exp: 0.82 },
  afternoon: { el: 34, az: 235, sun: 0xffeccc, si: 1.65, hemi: 0.45, top: 0x4a80c6, hor: 0xd8e2ea, exp: 0.86 },
  evening: { el: 7, az: 285, sun: 0xffa86a, si: 1.3, hemi: 0.36, top: 0x40598f, hor: 0xf0b48a, exp: 0.95 },
};
// Weather: cloud cover, rain, mist (how close the haze comes), wind.
export const WX = {
  sunny: { cover: 0, rain: 0, mist: 0, wind: 0.1, ic: '☀️', name: 'Sunny' },
  light: { cover: 0.4, rain: 0, mist: 0.05, wind: 0.2, ic: '🌤️', name: 'Light cloud' },
  heavy: { cover: 0.85, rain: 0, mist: 0.2, wind: 0.35, ic: '☁️', name: 'Heavy cloud' },
  mist: { cover: 0.7, rain: 0, mist: 0.85, wind: 0.05, ic: '🌫️', name: 'Mist' },
  rain: { cover: 0.95, rain: 0.6, mist: 0.4, wind: 0.5, ic: '🌧️', name: 'Rain' },
  storm: { cover: 1, rain: 1, mist: 0.5, wind: 1, ic: '⛈️', name: 'Thunderstorm' },
};
const WX_P = ['cover', 'rain', 'mist', 'wind'];
const WX_ORDER = ['sunny', 'light', 'heavy', 'mist', 'rain', 'storm'];

// A cloud texture: soft blobs of fractal noise that tile.
function cloudTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), img = g.createImageData(N, N);
  const grid = (s) => { const a = new Float32Array(s * s); for (let i = 0; i < a.length; i++) a[i] = Math.random(); return a; };
  const octs = [4, 8, 16, 32, 64].map((s) => ({ s, a: grid(s) }));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, amp = 0.5;
    for (const { s, a } of octs) {
      const fx = (x / N) * s, fy = (y / N) * s, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, w = fy - j;
      const at = (ii, jj) => a[((jj % s) * s) + (ii % s)];
      const su = u * u * (3 - 2 * u), sw = w * w * (3 - 2 * w);
      v += amp * ((at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sw) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sw);
      amp *= 0.5;
    }
    const k = (y * N + x) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(v * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function makeSky(scene, renderer, sun, hemi, mode, time, lowPower) {
  const L = LIGHTS[time] || LIGHTS.midday;
  // the sky dome: a gradient from the horizon up, and the sun's glow; drawn without fog, behind everything
  const u = { top: { value: new THREE.Color(L.top) }, hor: { value: new THREE.Color(L.hor) }, sunDir: { value: new THREE.Vector3() }, sunCol: { value: new THREE.Color(L.sun) }, grey: { value: 0 } };
  const dome = new THREE.Mesh(new THREE.SphereGeometry(30000, 32, 16), new THREE.ShaderMaterial({
    uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
    fragmentShader: `uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float grey; varying vec3 vDir;
      void main(){
        float h = max(vDir.y, 0.0);
        vec3 c = mix(hor, top, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        c += sunCol * (pow(s, 900.0) * 6.0 * (1.0 - grey) + pow(s, 12.0) * 0.35 * (1.0 - grey * 0.7));
        c = mix(c, vec3(dot(c, vec3(0.33))) * 0.95, grey * 0.6);
        if (vDir.y < 0.0) c = hor;
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <encodings_fragment>
      }`,
  }));
  dome.renderOrder = -1; dome.frustumCulled = false;
  scene.add(dome);
  // a cloud layer: a big textured sheet high above, drifting with the wind
  const ct = cloudTexture(); ct.repeat.set(6, 6);
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: 0, depthWrite: false, fog: false, color: 0xffffff }));
  clouds.rotation.x = Math.PI / 2; clouds.renderOrder = -0.5; clouds.frustumCulled = false;
  scene.add(clouds);
  // rain: streaks in a box that follows the camera
  const NR = lowPower ? 1500 : 4000, rp = new Float32Array(NR * 6), rs = new Float32Array(NR);
  for (let i = 0; i < NR; i++) { const x = (Math.random() - 0.5) * 60, y = Math.random() * 30, z = (Math.random() - 0.5) * 60; rp.set([x, y, z, x, y - 0.6, z], i * 6); rs[i] = 14 + Math.random() * 6; }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  const rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xaab4c0, transparent: true, opacity: 0.55, fog: false }));
  rain.frustumCulled = false; rain.visible = false;
  scene.add(rain);

  const S = { mode, time, L, dome, clouds, rain, u, P: null, kind: null, auto: null, flash: 0, nextFlash: 0, t: 0, hemiK: 1, env: null };
  const sunDir = new THREE.Vector3().setFromSphericalCoords(1, (90 - L.el) * Math.PI / 180, L.az * Math.PI / 180);
  u.sunDir.value.copy(sunDir);
  sun.color.setHex(L.sun);
  renderer.toneMappingExposure = L.exp;
  S.sunDir = sunDir;

  // Auto: mostly fine, with spells of cloud, mist or rain drifting through every few minutes
  function target(dt) {
    if (S.mode !== 'auto') return { ...WX[S.mode], kind: S.mode };
    let A = S.auto;
    if (!A) { const r = Math.random(); A = S.auto = { kind: r < 0.45 ? 'sunny' : r < 0.75 ? 'light' : r < 0.85 ? 'heavy' : r < 0.93 ? 'mist' : 'rain', until: 50 + Math.random() * 60 }; }
    A.until -= dt;
    if (A.until <= 0) {
      // the next spell, a step or two along from the last (rain builds from cloud and clears to cloud)
      const i = WX_ORDER.indexOf(A.kind), r = Math.random();
      const next = i <= 1 ? (r < 0.5 ? 'sunny' : r < 0.8 ? 'light' : 'heavy') : i === 2 ? (r < 0.35 ? 'light' : r < 0.55 ? 'mist' : r < 0.85 ? 'rain' : 'storm') : i === 3 ? (r < 0.6 ? 'light' : 'heavy') : (r < 0.7 ? 'heavy' : r < 0.85 ? 'rain' : 'light');
      A.kind = next; A.until = 60 + Math.random() * 90; // a new spell every minute or two
    }
    return { ...WX[A.kind], kind: A.kind };
  }

  S.step = function (dt, camPos, fog, toast, sound) {
    S.t += dt;
    const tg = target(dt);
    if (!S.P) S.P = { ...tg };
    const rate = Math.min(1, dt / (S.mode === 'auto' ? 12 : 2.5)); // spells come and go gradually (quickly when picked)
    for (const q of WX_P) S.P[q] += (tg[q] - S.P[q]) * rate;
    if (tg.kind !== S.kind) {
      const was = S.kind; S.kind = tg.kind;
      if (was && S.mode === 'auto' && toast) toast(WX_ORDER.indexOf(tg.kind) > WX_ORDER.indexOf(was) ? `${WX[tg.kind].ic} ${WX[tg.kind].name} coming in` : `${WX[tg.kind].ic} Clearing: ${WX[tg.kind].name.toLowerCase()}`, 2200);
    }
    const P = S.P, k = P.cover;
    // the gloom: duller sun, flatter light, grey sky, the haze closing in
    const grey = new THREE.Color(0x9aa4ae).lerp(new THREE.Color(0x7d868f), P.rain);
    const horizon = new THREE.Color(L.hor).lerp(grey, Math.min(1, k * 1.05));
    fog.color.copy(horizon);
    fog.far = 11000 - 9500 * Math.min(1, P.mist * 1.1) - 3000 * P.rain;
    fog.near = Math.max(15, fog.far * (0.06 - 0.04 * P.mist));
    u.hor.value.copy(horizon); u.top.value.setHex(L.top).lerp(new THREE.Color(0x87909a), k); u.grey.value = k;
    sun.intensity = L.si * (1 - 0.85 * k); hemi.intensity = L.hemi * (1 + 0.7 * k) * S.hemiK;
    if (S.env && (S.t % 3) < dt) S.refreshEnv();
    clouds.material.opacity = Math.min(0.95, 0.15 + k * 0.85) * (k > 0.02 ? 1 : 0);
    clouds.material.color.setHex(0xffffff).lerp(new THREE.Color(0x6f7780), Math.max(0, k - 0.4) * 1.5);
    clouds.position.set(camPos.x, camPos.y + 1800 - 900 * P.mist, camPos.z);
    ct.offset.x += dt * (0.0008 + P.wind * 0.004); ct.offset.y += dt * 0.0005;
    dome.position.copy(camPos);
    // rain falls around the camera, slanting with the wind
    rain.visible = P.rain > 0.03;
    if (rain.visible) {
      rain.position.set(camPos.x, camPos.y - 8, camPos.z);
      rain.material.opacity = 0.25 + 0.45 * P.rain;
      const a = rg.attributes.position.array, n = Math.floor(NR * Math.min(1, P.rain * 1.2)), wx = P.wind * 4;
      for (let i = 0; i < NR; i++) {
        const o = i * 6;
        if (i >= n) { a[o + 1] = a[o + 4] = -999; continue; }
        let y = a[o + 1] - rs[i] * dt;
        if (y < 0 || y > 40) { y = 26 + Math.random() * 4; a[o] = (Math.random() - 0.5) * 60; a[o + 2] = (Math.random() - 0.5) * 60; }
        a[o] += wx * dt; if (a[o] > 30) a[o] -= 60;
        a[o + 1] = y; a[o + 3] = a[o] - wx * 0.04; a[o + 4] = y - 0.7; a[o + 5] = a[o + 2];
      }
      rg.attributes.position.needsUpdate = true;
    }
    // thunder: a flash, then the rumble a moment later
    if (P.rain > 0.85 && S.t > S.nextFlash) { S.nextFlash = S.t + 8 + Math.random() * 18; S.flash = 0.25; if (sound) setTimeout(() => sound.thunder(), 600 + Math.random() * 2500); }
    if (S.flash > 0) { S.flash -= dt; hemi.intensity += 3 * Math.max(0, S.flash) / 0.25; }
    if (sound) sound.weather(P.rain, P.wind);
    return P;
  };
  // Light from the whole sky: the dome (and a grassy ground below it) blurred into an environment map, so every
  // surface is lit by the sky's colour from above and the ground's bounce from below, and steel, water and wet mud
  // reflect it. Rebuilt when the cloud cover changes. The flat ambient light is turned down to match.
  S.makeEnv = function (rend, scene) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping; tex.encoding = THREE.sRGBEncoding;
    S.env = { pm: new THREE.PMREMGenerator(rend), c, tex, scene, rt: null, cover: -1 };
    S.hemiK = 0.45;
    S.refreshEnv();
  };
  // the sky painted as a panorama: gradient from the horizon up, the sun's glow, the meadow and forest below
  S.refreshEnv = function () {
    const E = S.env; if (!E) return;
    const cover = S.P ? S.P.cover : 0;
    if (Math.abs(cover - E.cover) < 0.12) return;
    E.cover = cover;
    const g = E.c.getContext('2d'), W = 256, H = 128, css = (col, k = 1) => col.clone().multiplyScalar(k * 0.62).convertLinearToSRGB().getStyle();
    const sky = g.createLinearGradient(0, 0, 0, H / 2);
    sky.addColorStop(0, css(u.top.value)); sky.addColorStop(0.75, css(u.top.value.clone().lerp(u.hor.value, 0.7))); sky.addColorStop(1, css(u.hor.value));
    g.fillStyle = sky; g.fillRect(0, 0, W, H / 2);
    const ground = g.createLinearGradient(0, H / 2, 0, H);
    ground.addColorStop(0, css(u.hor.value, 0.7)); ground.addColorStop(0.12, 'rgb(70,84,46)'); ground.addColorStop(1, 'rgb(46,56,30)');
    g.fillStyle = ground; g.fillRect(0, H / 2, W, H / 2);
    // the sun's glow (equirectangular: u = azimuth, v = elevation)
    const d = u.sunDir.value, az = Math.atan2(d.x, d.z), el = Math.asin(Math.max(-1, Math.min(1, d.y)));
    const sx = ((0.5 - az / (2 * Math.PI)) % 1 + 1) % 1 * W, sy = (0.5 - el / Math.PI) * H, glow = g.createRadialGradient(sx, sy, 0, sx, sy, 40);
    glow.addColorStop(0, `rgba(255,244,220,${0.9 * (1 - cover)})`); glow.addColorStop(1, 'rgba(255,244,220,0)');
    g.fillStyle = glow; g.fillRect(0, 0, W, H / 2);
    E.tex.needsUpdate = true;
    const rt = E.pm.fromEquirectangular(E.tex);
    if (E.rt) E.rt.dispose();
    E.rt = rt; E.scene.environment = rt.texture;
  };
  S.label = () => (S.mode === 'auto' ? 'Auto: ' : '') + `${WX[S.kind || 'sunny'].ic} ${WX[S.kind || 'sunny'].name}`;
  return S;
}
