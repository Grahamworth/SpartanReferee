// The admin area: who has Burpee judge powers (switch them on or off, or hand out the judge code), and who's
// banned from the chat, from which room or group, when, and the messages they were reported for.
import { call, esc } from './api-base.js';

const $ = (id) => document.getElementById(id);
const key = () => { try { return localStorage.getItem('sp_admin') || ''; } catch { return ''; } };
function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200); }
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(); };

async function loadPeople() {
  let r, c;
  try { [r, c] = await Promise.all([call('admin/people', { admin: key() }), call('admin/judgecode', { admin: key() })]); }
  catch (e) { if (/admins only/i.test(e.message)) { $('keyBox').hidden = false; $('people').innerHTML = ''; return false; } $('people').innerHTML = `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; return true; }
  $('keyBox').hidden = true;
  $('judgeCode').textContent = c.code;
  const q = $('find').value.trim().toLowerCase();
  const list = r.people.filter((p) => !q || (p.name + ' ' + p.email).toLowerCase().includes(q));
  $('people').innerHTML = list.length ? `<table class="people"><thead><tr><th>Name</th><th>Account</th><th>Last seen</th><th>Burpee judge</th></tr></thead><tbody>${list.map((p, i) => `<tr>
      <td>${esc(p.name || '(no name)')}${p.spartanUrl ? ` · <a href="${esc(p.spartanUrl)}" target="_blank" rel="noopener" style="color:#aaa">Spartan</a>` : ''}</td>
      <td>${p.google ? esc(p.email) : '<span class="muted">this phone only</span>'}</td>
      <td class="muted">${p.seen ? esc(ago(p.seen)) : ''}</td>
      <td><label class="switch"><input type="checkbox" data-i="${i}" ${p.judge ? 'checked' : ''}> ${p.judge ? 'Yes' : 'No'}</label></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">Nobody yet: people appear here once they’ve opened their profile or used the chat.</div>';
  $('people').querySelectorAll('input[data-i]').forEach((cb) => cb.onchange = async () => {
    const p = list[+cb.dataset.i];
    try { await call(`admin/people/${encodeURIComponent(p.who)}/judge`, { method: 'POST', admin: key(), body: { on: cb.checked } }); toast(cb.checked ? `${p.name || 'They'} can now use the Burpee Judge` : `Burpee judge powers removed from ${p.name || 'them'}`); loadPeople(); }
    catch (e) { toast(e.message); cb.checked = !cb.checked; }
  });
  return true;
}

async function loadBans() {
  let r;
  try { r = await call('admin/bans', { admin: key() }); }
  catch (e) { $('bans').innerHTML = /admins only/i.test(e.message) ? '' : `<div class="empty">Couldn't load: ${esc(e.message)}</div>`; return; }
  $('bans').innerHTML = r.bans.length ? r.bans.map((b, i) => `<article>
      <h3>${esc(b.name)} <span style="color:#9a9a9a;font-weight:400">· ${esc(b.roomName || b.room)}</span></h3>
      <time>Banned ${esc(new Date(b.at).toLocaleString())} · reported by ${b.reporters} people</time>
      <p style="margin-top:8px;color:#bbb">Reported for:</p>
      <ul style="margin:4px 0 8px;padding-left:18px">${b.messages.map((m) => `<li>“${esc(m.text)}” <span style="color:#777">(${esc(new Date(m.at).toLocaleDateString())}${m.by ? `, ${m.by} report${m.by > 1 ? 's' : ''}` : ''})</span></li>`).join('')}</ul>
      <button type="button" class="btn btn-ghost" data-i="${i}">Unban</button></article>`).join('')
    : '<div class="empty">Nobody is banned.</div>';
  $('bans').querySelectorAll('[data-i]').forEach((btn) => btn.onclick = async () => {
    const b = r.bans[+btn.dataset.i];
    if (!confirm(`Unban ${b.name} from ${b.roomName || b.room}?`)) return;
    try { await call(`admin/bans/${encodeURIComponent(b.room)}/${encodeURIComponent(b.who)}/lift`, { method: 'POST', admin: key(), body: {} }); toast('Unbanned'); loadBans(); } catch (e) { toast(e.message); }
  });
}
const load = async () => { if (await loadPeople()) loadBans(); };
$('keyForm').onsubmit = (e) => { e.preventDefault(); try { localStorage.setItem('sp_admin', $('key').value); } catch { /* private mode */ } load(); };
$('reload').onclick = loadBans;
$('find').oninput = () => { clearTimeout(load.t); load.t = setTimeout(loadPeople, 250); };
$('newCode').onclick = async () => { if (!confirm('Make a new judge code? The old one stops working (existing judges keep their powers).')) return; try { const r = await call('admin/judgecode', { method: 'POST', admin: key(), body: {} }); $('judgeCode').textContent = r.code; toast('New judge code made'); } catch (e) { toast(e.message); } };
load();
