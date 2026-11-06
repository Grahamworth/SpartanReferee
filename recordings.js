// Cloud recordings: what the linked Receivers have backed up, by day and camera, to play or download, and the keys that
// link a Receiver. Only for the account that made the keys.
import { call, esc, getMe, signedIn } from './api-base.js';

const $ = (id) => document.getElementById(id);
const dayOf = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dayLabel = (day) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const size = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`);
let all = [];

function renderFilters() {
  const days = [...new Set(all.map((r) => dayOf(r.startedAt)))];
  const keep = $('day').value;
  $('day').innerHTML = days.map((d) => `<option value="${d}">${esc(dayLabel(d))}</option>`).join('') || '<option value="">No recordings yet</option>';
  if (days.includes(keep)) $('day').value = keep;
  renderCams();
}
function renderCams() {
  const keep = $('cam').value;
  const cams = [...new Set(all.filter((r) => dayOf(r.startedAt) === $('day').value).map((r) => r.cam))].sort((a, b) => a - b);
  $('cam').innerHTML = '<option value="">All cameras</option>' + cams.map((c) => `<option value="${c}">Camera ${c}</option>`).join('');
  if (cams.map(String).includes(keep)) $('cam').value = keep;
  renderList();
}
function renderList() {
  const rows = all.filter((r) => dayOf(r.startedAt) === $('day').value && (!$('cam').value || r.cam === +$('cam').value));
  $('list').innerHTML = rows.map((r) => `<div class="rec-row"><div><b>Camera ${r.cam}</b> · ${esc(new Date(r.startedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }))}<br><small class="muted">${esc(r.receiver)} · ${size(r.size)}</small></div>
    <button class="btn btn-red" type="button" data-play="${esc(r.id)}">Play</button><a class="btn btn-ghost" href="${esc(r.download)}">Download</a></div>`).join('')
    || '<p class="empty">Nothing here yet. Recordings appear once a linked Receiver has sent them.</p>';
}
async function loadRecordings() {
  const r = await call('recordings');
  all = r.recordings;
  $('usage').textContent = `${size(r.used)} of ${size(r.limit)} used. Recordings are deleted after ${r.keepDays} days.`;
  renderFilters();
}
async function loadLinks() {
  const r = await call('recordings/links');
  $('links').innerHTML = r.links.map((l) => `<div class="rec-row"><div><b>${esc(l.name)}</b><br><small class="muted">Linked ${esc(new Date(l.at).toLocaleDateString())}</small></div>
    <button class="btn btn-ghost" type="button" data-unlink="${esc(l.id)}" data-name="${esc(l.name)}">Remove</button></div>`).join('') || '<p class="empty">No Receivers linked yet.</p>';
}

$('day').onchange = renderCams;
$('cam').onchange = renderList;
$('list').onclick = (e) => {
  const b = e.target.closest('[data-play]'); if (!b) return;
  const r = all.find((x) => x.id === b.dataset.play); if (!r) return;
  const v = $('player'); v.src = r.url; v.hidden = false; v.play().catch(() => {}); v.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
$('links').onclick = async (e) => {
  const b = e.target.closest('[data-unlink]'); if (!b) return;
  if (!confirm(`Remove ${b.dataset.name}? It stops sending recordings. What it already sent stays here.`)) return;
  try { await call(`recordings/links/${b.dataset.unlink}`, { method: 'DELETE' }); await loadLinks(); } catch (err) { alert(err.message); }
};
$('linkForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const r = await call('recordings/links', { method: 'POST', body: { name: $('linkName').value } });
    $('keyText').textContent = r.key; $('newKey').hidden = false; $('linkName').value = '';
    await loadLinks();
  } catch (err) { alert(err.message); }
};
$('copyKey').onclick = async () => { try { await navigator.clipboard.writeText($('keyText').textContent); $('copyKey').textContent = 'Copied'; } catch { /* they can select it */ } };

(async () => {
  if (!signedIn()) { $('signInBox').hidden = false; return; }
  try {
    const me = await getMe();
    if (!me.user) { $('signInBox').hidden = false; return; }
    $('main').hidden = false;
    await loadRecordings();
    if (me.admin) await loadLinks(); else { $('linkForm').hidden = true; $('links').innerHTML = '<p class="empty">Linking Receivers is for admins for now.</p>'; }
  } catch (err) { $('error').textContent = err.message; $('error').hidden = false; }
})();
