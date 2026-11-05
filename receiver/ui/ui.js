'use strict';
// The receiver's window: the setup steps (Tailscale, firewall, phones, iPad), one card per camera (live or waiting,
// which route, its Larix QR code, YouTube key, Judge), settings and the server log.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tab = {};   // what each camera's card shows: 'live' (its picture), 'larix' or 'spartans' (QR codes)
const lives = {}; // n → { video, pc, connecting } the small live pictures, kept across redraws
let setupOpen = false;
let last = null, settingsFilled = false, editing = false;

function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2400); }
const step = (id, done) => $(id).classList.toggle('done', !!done);

// a newer version on the site: Update now downloads it and runs the installer (this app closes first)
let updLater = '';
function renderUpdate(st) {
  const u = st.update || {}, show = ['available', 'downloading', 'installing', 'error'].includes(u.state) && !(u.state === 'available' && updLater === u.version);
  $('verBtn').textContent = 'v' + (st.version || '–') + (u.state === 'checking' ? ' · checking…' : u.state === 'none' && renderUpdate.asked ? ' · up to date' : '');
  $('updateBar').hidden = !show; if (!show) return;
  $('updTitle').textContent = u.state === 'installing' ? `Installing ${u.version}…` : `Version ${u.version} is available`;
  const pct = u.size ? Math.round((100 * (u.got || 0)) / u.size) : 0;
  $('updText').textContent = u.state === 'downloading' ? `Downloading… ${pct}%` : u.state === 'installing' ? 'The installer is opening; this app closes now.'
    : u.state === 'error' ? `The update didn't work: ${u.error}` : `(you have ${st.version}). ${u.notes || ''} Updating closes this app and the streaming server for a minute: do it between heats.`;
  $('updNow').hidden = $('updLater').hidden = u.state === 'downloading' || u.state === 'installing';
  $('updNow').textContent = u.state === 'error' ? 'Try again' : 'Update now';
}
$('updNow').onclick = async () => { $('updNow').hidden = true; render(last && { ...last, update: { ...last.update, state: 'downloading', got: 0 } }); await window.receiver.installUpdate(); refresh(); };
$('updLater').onclick = () => { updLater = (last && last.update && last.update.version) || ''; $('updateBar').hidden = true; };
$('verBtn').onclick = async () => { renderUpdate.asked = true; $('verBtn').textContent = 'checking…'; await window.receiver.checkUpdate(); refresh(); };

function render(st) {
  last = st;
  renderUpdate(st);
  $('serverState').className = 'pill ' + (st.server ? 'ok' : 'bad');
  $('serverState').textContent = st.server ? (st.testMode ? 'Server running (test: this computer only)' : 'Server running') : 'Server starting…';

  // an older server from the script setup blocks this one
  const old = st.oldServer || {};
  $('oldWarn').hidden = !(old.installed || (old.running && old.running.length));
  $('portWarn').hidden = !$('oldWarn').hidden || !st.portBusy;

  // 1. Tailscale
  const ts = st.tailscale, b = $('tsBtn');
  let text, btn = '';
  if (ts.busy) text = ts.busy;
  else if (!ts.installed) { text = 'Not installed. It links the phones and iPad to this laptop over any Wi-Fi or 4G.'; btn = 'Install Tailscale'; }
  else if (ts.state === 'NeedsLogin' || ts.state === 'NoState') { text = 'Installed, not signed in. Sign in opens your browser.'; btn = 'Sign in'; }
  else if (ts.state !== 'Running') { text = 'Switched off.'; btn = 'Switch on'; }
  else text = `Connected${ts.account ? ` as <b>${esc(ts.account)}</b>` : ''} · this laptop is <b>${esc(st.addr.tailscale || '')}</b>`;
  if (!ts.busy && !btn && ts.update) { text += ` · <b>Tailscale ${esc(ts.update)} is available</b>`; btn = 'Update Tailscale'; }
  $('tsText').innerHTML = text;
  b.hidden = !btn; b.textContent = btn; b.dataset.act = !ts.installed ? 'install' : btn === 'Update Tailscale' ? 'site' : 'up';
  step('stepTs', ts.installed && ts.state === 'Running');

  // 2. firewall
  $('fwText').textContent = st.testMode ? 'Test mode: this computer only.' : st.firewall ? 'Done.' : 'Windows needs to let them in. Click Allow and say Yes.';
  $('fixFirewall').hidden = st.firewall || st.testMode;
  step('stepFw', st.firewall || st.testMode);

  // 3. phones
  $('phoneQr').src = st.phoneSetup.qr;
  $('tsAccount').innerHTML = ts.account ? `as <b>${esc(ts.account)}</b>` : 'with the same account as this laptop';
  $('phoneList').innerHTML = ts.phones && ts.phones.length
    ? 'On Tailscale: ' + ts.phones.map((p) => `<span class="${p.online ? 'on' : 'off'}">${esc(p.name)} (${p.online ? 'online' : 'offline'})</span>`).join(', ')
    : (ts.state === 'Running' ? 'No phones on Tailscale yet.' : '');
  step('stepPhones', st.stations.some((s) => s.live));

  // all done: one line instead of the four steps (Show setup opens them again)
  const allDone = ts.installed && ts.state === 'Running' && (st.firewall || st.testMode) && st.stations.some((s) => s.live);
  $('setupDone').hidden = !allDone || setupOpen; $('setupSteps').hidden = allDone && !setupOpen;
  $('setupSummary').textContent = allDone ? `Tailscale connected${ts.account ? ' as ' + ts.account : ''} · phones can connect · review at ${st.review.url || '–'}` : '';

  // 4. iPad
  $('reviewQr').src = st.review.qr; $('reviewUrl').textContent = st.review.url || '(connect Tailscale or Wi-Fi first)';
  step('stepIpad', !!st.review.url);

  // redraw the cards only when something on them changes (a redraw would restart the live pictures)
  const cardSig = JSON.stringify([st.stations.map((s) => [s.n, s.live, s.route, s.video, s.from, s.watchers, s.youtube, s.larixLink]), tab]);
  if (!editing && cardSig !== render.cardSig) {
    render.cardSig = cardSig;
    $('stations').innerHTML = st.stations.map((s) => {
    const t = tab[s.n] || (s.live ? 'live' : 'spartans');
    const show = t === 'live' && !s.live ? 'spartans' : t;
    const tabBtn = (key, label) => `<button data-n="${s.n}" data-t="${key}" class="${show === key ? 'on' : ''}">${label}</button>`;
    return `<article class="card ${s.live ? 'live' : ''}">
      <div class="top"><div class="name">Camera ${s.n}</div>
        <div class="status ${s.live ? 'live' : ''}">${s.live ? `LIVE · ${esc(s.route)}<small>${esc(s.video)} from ${esc(s.from)}${s.watchers ? ` · ${s.watchers} watching` : ''}</small>` : 'Waiting for a phone'}</div></div>
      <div class="tabs">${s.live ? tabBtn('live', 'Live') : ''}${tabBtn('spartans', 'Broadcaster')}${tabBtn('larix', 'Larix')}</div>
      ${show === 'live'
        ? `<div class="livebox" data-expand="${s.n}" data-slot="${s.n}" title="Open in Video review"><div class="msg">Connecting…</div></div>`
        : `<div class="qr"><img alt="Camera ${s.n} QR code" src="${show === 'spartans' ? s.spartans : s.larix}"></div>`}
      ${show === 'larix' ? `<p class="hint">Scan with the phone camera or Larix's own scanner, then tap <b>Import</b> in Larix and tick the connection in Settings → Connections. Sends to this laptop${s.youtube ? ' <b>and YouTube</b>' : ''}, with a backup recording on the phone.</p>
      <div class="addr" data-copy="${esc(s.larixLink)}" title="Click to copy, then send to the phone">Copy Larix link</div>` : ''}
      ${show === 'spartans' ? '<p class="hint">Spartans Broadcaster (Android): open it and tap <b>Scan station QR code</b>. The Spartans app works too (Home → Camera station).</p>' : ''}
      <label class="yt">YouTube stream key <input type="password" data-yt="${s.n}" placeholder="${s.youtube ? '•••••• (set: type to change, clear to remove)' : 'Optional: from YouTube Studio'}"></label>
      <button class="btn red expand" data-expand="${s.n}">⤢ Open in Video review</button>
    </article>`;
  }).join('') + (st.stations.length && st.stations.length < 12
    ? `<button type="button" class="card add-cam" data-add="1"><span class="plus">+</span><b>Add camera</b><small>Camera ${st.stations.length + 1} of up to 12</small></button>`
    : '');
  }

  placeLives(st);

  if (!settingsFilled) {
    const f = $('settingsForm');
    f.stations.value = st.settings.stations; f.record.checked = st.settings.record; f.keepDays.value = st.settings.keepDays;
    settingsFilled = true;
  }
  if (!$('log').hidden) { const l = $('log'); const end = l.scrollTop + l.clientHeight >= l.scrollHeight - 5; l.textContent = st.log.join('\n'); if (end) l.scrollTop = l.scrollHeight; }
}

$('stations').addEventListener('click', (e) => {
  const b = e.target.closest('button, .addr, .livebox');
  if (b && b.dataset.expand) { window.receiver.review(+b.dataset.expand); return; }
  if (!b) return;
  if (b.dataset.add) {
    b.disabled = true;
    window.receiver.addCamera().then((n) => { $('settingsForm').stations.value = n; toast(`Camera ${n} added: scan its code with a phone`); refresh(); });
  }
  else if (b.dataset.t) { tab[b.dataset.n] = b.dataset.t; render.cardSig = ''; render(last); }
  else if (b.dataset.judge) window.receiver.judge(+b.dataset.judge);
  else if (b.dataset.copy) { window.receiver.copy(b.dataset.copy); toast('Copied'); }
});
// YouTube keys: don't redraw while typing; save on leaving the box
$('stations').addEventListener('focusin', (e) => { if (e.target.dataset.yt) editing = true; });
$('stations').addEventListener('focusout', async (e) => {
  if (!e.target.dataset.yt) return;
  editing = false;
  const v = e.target.value;
  if (v !== '' || e.target.dataset.cleared) { await window.receiver.youtube(+e.target.dataset.yt, v); toast(v ? 'YouTube key saved: scan the Larix code again' : 'YouTube key removed'); }
  refresh();
});
$('stations').addEventListener('keydown', (e) => { if (e.target.dataset.yt && e.key === 'Backspace' && !e.target.value) e.target.dataset.cleared = '1'; if (e.key === 'Enter') e.target.blur(); });
$('tsBtn').onclick = async () => { $('tsBtn').disabled = true; const act = $('tsBtn').dataset.act; const r = await (act === 'install' ? window.receiver.tailscaleInstall() : act === 'site' ? window.receiver.tailscaleSite() : window.receiver.tailscaleUp()); if (r && r.error) toast(`Tailscale couldn't sign in: ${r.error}. Try its icon by the clock.`); $('tsBtn').disabled = false; refresh(); };
$('fixFirewall').onclick = async () => { $('fixFirewall').disabled = true; const ok = await window.receiver.fixFirewall(); $('fixFirewall').disabled = false; toast(ok ? 'Phones can connect now' : 'Not changed: say Yes when Windows asks'); refresh(); };
$('removeOld').onclick = async () => { $('removeOld').disabled = true; const ok = await window.receiver.removeOldServer(); $('removeOld').disabled = false; toast(ok ? 'Old server removed: scan the Larix code again on each phone' : 'Not removed: say Yes when Windows asks'); refresh(); };
$('openRec').onclick = () => window.receiver.openRecordings();
$('showSetup').onclick = () => { setupOpen = true; if (last) render(last); };
$('showLog').onclick = () => { $('log').hidden = !$('log').hidden; if (last) render(last); };
$('settingsForm').onsubmit = async (e) => {
  e.preventDefault();
  const f = e.target;
  await window.receiver.settings({ stations: f.stations.value, record: f.record.checked, keepDays: f.keepDays.value });
  settingsFilled = false; toast('Saved: the server restarts'); refresh();
};

async function refresh() { try { render(await window.receiver.state()); } catch (e) { $('serverState').textContent = 'Error: ' + e.message; } }
refresh();
setInterval(refresh, 2000);

// ---------------------------------------------------------------- the small live pictures (WebRTC from this computer's server)
function placeLives(st) {
  // cameras no longer listed (fewer cameras in the settings) are closed
  for (const n of Object.keys(lives)) if (!st.stations.some((s) => s.n === +n)) { lives[n].pc?.close(); delete lives[n]; }
  for (const s of st.stations) {
    const slot = document.querySelector(`[data-slot="${s.n}"]`);
    let L = lives[s.n];
    if (!s.live) { if (L) { L.pc?.close(); delete lives[s.n]; } continue; }
    if (!slot) { if (L && L.pc) { L.pc.close(); L.pc = null; } continue; }
    if (!L) { L = lives[s.n] = { video: Object.assign(document.createElement('video'), { muted: true, autoplay: true, playsInline: true }), pc: null, connecting: false }; }
    if (L.video.parentElement !== slot) { slot.append(L.video); L.video.play().catch(() => {}); }
    const playing = L.pc && L.pc.connectionState === 'connected' && L.video.videoWidth;
    const msg = slot.querySelector('.msg'); if (msg) msg.hidden = !!playing;
    if (!playing && !L.connecting) connectLive(s.n, L, st.webrtcPort);
  }
}
async function connectLive(n, L, port) {
  L.connecting = true;
  try {
    L.pc?.close();
    const pc = L.pc = new RTCPeerConnection();
    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.ontrack = (e) => { L.video.srcObject = e.streams[0] || new MediaStream([e.track]); L.video.play().catch(() => {}); };
    await pc.setLocalDescription(await pc.createOffer());
    await new Promise((ok) => { if (pc.iceGatheringState === 'complete') ok(); pc.addEventListener('icegatheringstatechange', () => pc.iceGatheringState === 'complete' && ok()); setTimeout(ok, 1500); });
    const r = await fetch(`http://127.0.0.1:${port}/live/station${n}/whep`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: pc.localDescription.sdp });
    if (!r.ok) throw new Error(r.status);
    await pc.setRemoteDescription({ type: 'answer', sdp: await r.text() });
    await new Promise((ok) => setTimeout(ok, 4000));
  } catch { await new Promise((ok) => setTimeout(ok, 2000)); }
  L.connecting = false;
}
