// "Your runner": dress the runner (skin, hair, hat, top, bottoms, shoes, race number) with a turning 3D preview.
/* global THREE */
import { loadPeople, makePerson, animatePerson, DEFAULT_LOOK, SKINS, HAIR_COLS, HAIRS, HATS, TOPS, BOTTOMS, KIT_COLS, randomLook } from './course-people.js?v=2';

export function bindLook(store) {
  const box = document.getElementById('lookBox');
  let look = { ...DEFAULT_LOOK, ...store.get('look', {}) };
  if (!look.number) { look.number = String(1000 + Math.floor(Math.random() * 8999)); store.set('look', look); }
  const save = () => { store.set('look', look); if (person) person.setLook(look); };

  // the controls
  const row = (label, el) => { const l = document.createElement('div'); l.className = 'look-row'; l.innerHTML = `<span>${label}</span>`; l.appendChild(el); box.querySelector('.look-ctl').appendChild(l); };
  const swatches = (key, colours) => {
    const d = document.createElement('div'); d.className = 'swatches';
    for (const c of colours) {
      const b = document.createElement('button'); b.type = 'button'; b.style.background = c; b.title = c; b.setAttribute('aria-label', c);
      if (look[key] === c) b.classList.add('on');
      b.onclick = () => { look[key] = c; d.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); save(); };
      d.appendChild(b);
    }
    return d;
  };
  const select = (key, options) => {
    const s = document.createElement('select');
    for (const [v, t] of Object.entries(options)) s.add(new Option(t, v));
    s.value = look[key]; s.onchange = () => { look[key] = s.value; save(); };
    return s;
  };
  box.innerHTML = '<div class="look-prev"><canvas id="lookCv" width="360" height="460"></canvas><button type="button" class="btn btn-ghost" id="lookRandom">Surprise me</button></div><div class="look-ctl"></div>';
  const num = document.createElement('input'); num.type = 'text'; num.inputMode = 'numeric'; num.maxLength = 5; num.value = look.number;
  num.oninput = () => { look.number = num.value.replace(/\D/g, '').slice(0, 5); save(); };
  row('Race number', num);
  row('Skin', swatches('skin', SKINS));
  row('Hair', select('hair', HAIRS));
  row('Hair colour', swatches('hairCol', HAIR_COLS));
  row('Hat', select('hat', HATS));
  row('Hat colour', swatches('hatCol', KIT_COLS));
  row('Top', select('top', TOPS));
  row('Top colour', swatches('topCol', KIT_COLS));
  row('Bottoms', select('bottom', BOTTOMS));
  row('Bottoms colour', swatches('bottomCol', KIT_COLS));
  row('Shoes', swatches('shoeCol', ['#f2f2f2', '#0b0b0b', '#e2231a', '#1d4fa8', '#f2b705', '#3fb8c6', '#ff6a13', '#2f8f3a']));
  document.getElementById('lookRandom').onclick = () => { look = { ...randomLook(Math.random), number: look.number }; save(); bindLook(store); };

  // the preview: the runner turning slowly on the spot
  let person = null, renderer = null, scene = null, cam = null, last = 0, raf = 0;
  const cv = document.getElementById('lookCv');
  loadPeople().then(() => {
    try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch { return; }
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x445533, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
    cam = new THREE.PerspectiveCamera(30, cv.width / cv.height, 0.1, 50); cam.position.set(0, 1.25, 4.4); cam.lookAt(0, 0.95, 0);
    person = makePerson(look, { shadows: false }); scene.add(person.root);
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      if (document.getElementById('menu').hidden || !box.isConnected) return;
      const dt = Math.min(0.1, (now - last) / 1000 || 0.016); last = now;
      person.root.rotation.y += dt * 0.6;
      animatePerson(person, dt, 0, null);
      renderer.render(scene, cam);
    };
    raf = requestAnimationFrame(tick);
    box._stop = () => { cancelAnimationFrame(raf); renderer.dispose(); renderer.forceContextLoss(); };
  });
  if (box._stop) box._stop();
}
