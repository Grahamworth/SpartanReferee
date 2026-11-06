// Registering a company for HeadJudge: sign in, details, logo and colours with a live preview. Once registered, the same page
// shows where the application stands and changes the details.
import { call, googleButton, signedIn, getMe, signOut } from './api-base.js';

const { applyTheme, themeVars, contrast, HEADJUDGE } = window.HeadJudgeBrand;
const $ = (id) => document.getElementById(id);
const LOGO_SIDE = 512, MAX_BYTES = 400e3;
let company = null, logoData, logoShown = '', idTouched = false, idCheck = 0;

const show = (el, on) => { el.hidden = !on; };
function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); }
function error(id, msg) { $(id).textContent = msg || ''; show($(id), !!msg); }
const theme = () => ({ primary: $('primary').value, accent: $('accent').value, mode: document.querySelector('input[name=mode]:checked').value });
const toId = (name) => name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '');

function drawPreview() {
  const t = theme(), box = $('preview');
  applyTheme(t, box);
  applyTheme(t);          // the whole page takes the colours too
  $('pvName').textContent = $('name').value.trim() || 'Your company';
  $('pvLogo').src = logoShown; show($('pvLogo'), !!logoShown);
  const v = themeVars(t);
  const moved = v['--primary-text'] !== t.primary || contrast(t.accent, v['--panel']) < 3;
  $('readNote').textContent = moved ? 'One of these colours is hard to read on this background, so its text is shown a little lighter or darker. Buttons keep your exact colour.' : '';
  show($('readNote'), moved);
}

// any picture becomes a PNG no bigger than it needs to be (an SVG can't reach other people's browsers as a script this way)
function readLogoFile(file) {
  return new Promise((ok, no) => {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) return no(new Error('That needs to be a PNG, JPEG, WebP or SVG image'));
    if (file.size > 15e6) return no(new Error('That file is too large: keep it under 15 MB'));
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); no(new Error('That picture couldn\'t be opened')); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth || 512, h = img.naturalHeight || 512;
      if (w < 16 || h < 16) return no(new Error('That picture is too small'));
      for (const side of [LOGO_SIDE, 384, 256, 180]) {
        const k = Math.min(1, side / Math.max(w, h)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        const data = c.toDataURL('image/png');
        if ((data.length - 22) * 0.75 <= MAX_BYTES) return ok(data);
      }
      no(new Error('That logo has too much detail to store: try a simpler version'));
    };
    img.src = url;
  });
}
async function pickLogo(file) {
  if (!file) return;
  error('logoError', '');
  try {
    logoData = await readLogoFile(file); logoShown = logoData;
    setLogoPick(); drawPreview();
  } catch (e) { error('logoError', e.message); }
}
function setLogoPick() {
  $('logoPick').src = logoShown; show($('logoPick'), !!logoShown);
  $('dropText').textContent = logoShown ? 'Choose a different logo' : 'Choose a logo, or drop it here';
  show($('logoRemove'), !!logoShown);
}

const STATUS = {
  pending: ['We\'re checking your application', 'We check each company by hand. You can still change anything below.'],
  approved: ['You\'re approved', 'Your logo and colours are live.'],
  declined: ['We can\'t offer HeadJudge to this company at the moment', ''],
  suspended: ['This company is suspended', 'Get in touch with us to sort this out.'],
};
function drawStatus() {
  const box = $('status');
  show(box, !!company);
  if (!company) return;
  const [head, more] = STATUS[company.status] || ['', ''];
  box.dataset.state = company.status;
  box.replaceChildren();
  const h = document.createElement('h2'); h.textContent = head; box.append(h);
  for (const line of [company.note, more]) if (line) { const p = document.createElement('p'); p.textContent = line; box.append(p); }
  if (company.status === 'approved') { const l = document.createElement('a'); l.href = 'console.html'; l.className = 'primary linkbtn'; l.textContent = 'Go to my server'; box.append(l); }
}
function fill(c) {
  $('name').value = c.name; $('id').value = c.id; $('contact').value = c.contact; $('website').value = c.website || ''; $('about').value = c.about || '';
  setColour('primary', c.theme.primary); setColour('accent', c.theme.accent);
  document.querySelector(`input[name=mode][value=${c.theme.mode}]`).checked = true;
  logoShown = c.logo || ''; logoData = undefined; setLogoPick();
  show($('idRow'), false);
  $('save').textContent = 'Save changes';
  show($('dataNote'), false);
}
function setColour(k, v) { $(k).value = v; $(k + 'Hex').value = v; }

async function checkId() {
  const id = $('id').value, mine = ++idCheck;
  if (!id) { $('idNote').textContent = 'Letters, numbers and hyphens. It can\'t be changed later.'; $('idNote').classList.remove('bad'); return; }
  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(id)) { $('idNote').textContent = 'Use 3 to 32 letters, numbers and hyphens, starting and ending with a letter or number.'; $('idNote').classList.add('bad'); return; }
  const r = await call(`companies/check/${encodeURIComponent(id)}`).catch(() => null);
  if (mine !== idCheck || !r) return;
  $('idNote').textContent = r.free ? 'That address is free. It can\'t be changed later.' : 'That address is taken: try another.';
  $('idNote').classList.toggle('bad', !r.free);
}

function wire() {
  $('name').addEventListener('input', () => {
    if (!idTouched && !company) { $('id').value = toId($('name').value); clearTimeout(wire.t); wire.t = setTimeout(checkId, 350); }
    drawPreview();
  });
  $('id').addEventListener('input', () => {
    idTouched = true;
    $('id').value = $('id').value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    clearTimeout(wire.t); wire.t = setTimeout(checkId, 350);
  });
  for (const k of ['primary', 'accent']) {
    $(k).addEventListener('input', () => { $(k + 'Hex').value = $(k).value; drawPreview(); });
    $(k + 'Hex').addEventListener('input', () => {
      let v = $(k + 'Hex').value.trim().toLowerCase(); if (v && v[0] !== '#') v = '#' + v;
      if (/^#[0-9a-f]{6}$/.test(v)) { $(k).value = v; drawPreview(); }
    });
    $(k + 'Hex').addEventListener('blur', () => { $(k + 'Hex').value = $(k).value; });
    $(k + 'Hex').value = $(k).value;
  }
  document.querySelectorAll('input[name=mode]').forEach((r) => r.addEventListener('change', drawPreview));
  $('logo').addEventListener('change', () => { pickLogo($('logo').files[0]); $('logo').value = ''; });
  $('logoRemove').onclick = () => { logoData = null; logoShown = ''; setLogoPick(); drawPreview(); };
  const drop = $('drop');
  for (const ev of ['dragenter', 'dragover']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const ev of ['dragleave', 'drop']) drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => pickLogo(e.dataTransfer.files[0]));
  $('form').addEventListener('submit', save);
  $('form').addEventListener('input', () => error('formError', ''));
}

async function save(e) {
  e.preventDefault();
  error('formError', '');
  const name = $('name').value.trim(), contact = $('contact').value.trim();
  if (name.length < 2) { error('formError', 'Add your company\'s name.'); return $('name').focus(); }
  if (!company && !$('id').value) { error('formError', 'Choose a web address.'); return $('id').focus(); }
  if (contact.length < 2) { error('formError', 'Add your name.'); return $('contact').focus(); }
  const body = { name, contact, website: $('website').value.trim(), about: $('about').value.trim(), theme: theme() };
  if (logoData !== undefined) body.logo = logoData;
  const btn = $('save'); btn.disabled = true;
  try {
    const r = company ? await call('companies/mine', { method: 'PUT', body }) : await call('companies', { method: 'POST', body: { ...body, id: $('id').value } });
    const first = !company;
    company = r.company; fill(company); drawStatus(); drawPreview();
    toast(first ? 'Registered: we\'ll be in touch' : 'Saved');
    if (first) window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) { error('formError', err.message); }
  finally { btn.disabled = false; }
}

async function start() {
  wire(); drawPreview();
  if (!signedIn()) {
    show($('signIn'), true);
    await googleButton($('googleBtn'), () => { show($('signIn'), false); enter(); }, (e) => error('signInError', e.message || 'Sign-in didn\'t work: try again'));
    return;
  }
  enter();
}
async function enter() {
  const me = await getMe(true);
  if (!me.user) { signOut(); return start(); }
  $('who').textContent = me.user.email;
  try {
    const r = await call('companies/mine');
    company = r.company;
    if (company) fill(company); else if (me.user.name) $('contact').value = me.user.name;
    drawStatus(); show($('form'), true); drawPreview();
  } catch (e) { error('signInError', e.message); show($('signIn'), true); }
}
start();
