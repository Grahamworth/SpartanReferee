// Spartans chat: public rooms like SkiTour's notice board, and private groups you make, join with a code, or are
// invited to from a message. Messages refresh every few seconds while the page is open.
import { call, esc } from './api-base.js';

const $ = (id) => document.getElementById(id);
let rooms = [], groups = [], invites = [], room = null, lastSig = '', timer = 0;
const store = { get: (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

function toast(s) { const t = $('toast'); t.textContent = s; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2600); }
const when = (at) => { const d = new Date(at), today = new Date().toDateString() === d.toDateString(); return today ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
const current = () => rooms.find((r) => r.id === room) || groups.find((g) => g.room === room);

function myName(ask) {
  let n = store.get('sp_name');
  if (!n || ask) {
    n = (prompt('Your name in the chat (what others see):', n || '') || '').trim().slice(0, 30);
    if (n) store.set('sp_name', n);
  }
  showWho();
  return n;
}
function showWho() {
  const n = store.get('sp_name');
  $('who').innerHTML = n ? `You're <b>${esc(n)}</b> · <a href="#" id="rename" style="color:#aaa">change</a>` : 'Pick a name when you send your first message.';
  const r = $('rename'); if (r) r.onclick = (e) => { e.preventDefault(); myName(true); };
}

// ---------------------------------------------------------------- rooms bar: public rooms, my groups, + group
function renderRooms() {
  const bar = $('rooms'); bar.innerHTML = '';
  const add = (label, id, cls = '') => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.className = (id === room ? 'on ' : '') + cls; b.onclick = () => open(id); bar.appendChild(b); };
  for (const r of rooms) add(r.name, r.id);
  for (const g of groups) add('🔒 ' + g.name, g.room, 'grp');
  const plus = document.createElement('button'); plus.type = 'button'; plus.className = 'plus'; plus.textContent = '＋ Group'; plus.onclick = groupDialog; bar.appendChild(plus);
}
function renderInvites() {
  const box = $('invites');
  box.hidden = !invites.length;
  box.innerHTML = invites.map((i) => `<div class="invite"><span><b>${esc(i.from)}</b> invited you to <b>🔒 ${esc(i.groupName)}</b></span><button class="btn btn-red" data-a="accept" data-id="${esc(i.id)}">Join</button><button class="btn btn-ghost" data-a="decline" data-id="${esc(i.id)}">No thanks</button></div>`).join('');
  box.querySelectorAll('button').forEach((b) => b.onclick = async () => {
    const accept = b.dataset.a === 'accept', name = accept ? myName(false) : '';
    if (accept && !name) return;
    try { const r = await call(`groups/invites/${b.dataset.id}/${b.dataset.a}`, { method: 'POST', body: { me: name } }); await loadGroups(); if (accept) { toast(`You're in ${r.group.name}`); open(r.group.room); } }
    catch (e) { toast(e.message); }
  });
}
async function loadGroups() {
  try { const r = await call('groups'); groups = r.groups; invites = r.invites; } catch { /* the public rooms still work */ }
  renderRooms(); renderInvites();
}

// ---------------------------------------------------------------- group header: invite code, members, leave
function renderGroupBar() {
  const g = groups.find((x) => x.room === room), bar = $('groupBar');
  bar.hidden = !g; if (!g) return;
  bar.innerHTML = `<span>Join code <b class="code">${esc(g.code)}</b></span>
    <button type="button" class="btn btn-ghost" id="gShare">Share code</button>
    <button type="button" class="btn btn-ghost" id="gMembers">${g.members.length} member${g.members.length === 1 ? '' : 's'}</button>
    ${g.owner ? '<button type="button" class="btn btn-ghost" id="gNewCode">New code</button>' : ''}
    <button type="button" class="btn btn-ghost" id="gLeave">Leave</button>`;
  $('gShare').onclick = async () => {
    const text = `Join my Spartans group "${g.name}": open the Spartans chat, tap ＋ Group, then Join with code ${g.code}`;
    try { if (navigator.share) await navigator.share({ title: 'Spartans group', text }); else { await navigator.clipboard.writeText(text); toast('Code copied – paste it to your friends'); } } catch { /* cancelled */ }
  };
  $('gMembers').onclick = () => alert(`${g.name}\n\n` + g.members.map((m) => `• ${m.name}${m.me ? ' (you)' : ''}`).join('\n'));
  if ($('gNewCode')) $('gNewCode').onclick = async () => { if (!confirm('Make a new join code? The old one stops working.')) return; try { await call(`groups/${g.id}/code`, { method: 'POST', body: {} }); await loadGroups(); renderGroupBar(); toast('New code made'); } catch (e) { toast(e.message); } };
  $('gLeave').onclick = async () => { if (!confirm(`Leave ${g.name}?`)) return; try { await call(`groups/${g.id}/leave`, { method: 'POST', body: {} }); await loadGroups(); open(rooms[0].id); toast('You left the group'); } catch (e) { toast(e.message); } };
}

// ---------------------------------------------------------------- make a group, or join one with a code
function groupDialog() {
  const bg = document.createElement('div'); bg.className = 'ed-bg';
  bg.innerHTML = `<div class="ed" role="dialog" aria-modal="true"><h3>Private group</h3>
    <label>Make a new group<input name="gname" maxlength="40" placeholder="e.g. Team Red, Morzine crew"></label>
    <div class="row"><button type="button" class="btn btn-red" data-a="make">Make the group</button></div>
    <hr style="border-color:#333;margin:16px 0">
    <label>Or join one with its code<input name="code" maxlength="8" placeholder="6-letter code" style="text-transform:uppercase"></label>
    <div class="row"><button type="button" class="btn btn-red" data-a="join">Join</button><button type="button" class="btn btn-ghost" data-a="close">Close</button></div>
    <p class="err" hidden></p></div>`;
  document.body.appendChild(bg);
  const err = bg.querySelector('.err'), fail = (m) => { err.hidden = false; err.textContent = m; };
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  bg.querySelector('[data-a=close]').onclick = () => bg.remove();
  bg.querySelector('[data-a=make]').onclick = async () => {
    const name = myName(false); if (!name) return;
    try { const r = await call('groups', { method: 'POST', body: { name: bg.querySelector('[name=gname]').value, me: name } }); bg.remove(); await loadGroups(); open(r.group.room); toast(`Group made – share code ${r.group.code} to invite people`); }
    catch (e) { fail(e.message); }
  };
  bg.querySelector('[data-a=join]').onclick = async () => {
    const name = myName(false); if (!name) return;
    try { const r = await call('groups/join', { method: 'POST', body: { code: bg.querySelector('[name=code]').value, me: name } }); bg.remove(); await loadGroups(); open(r.group.room); toast(`You're in ${r.group.name}`); }
    catch (e) { fail(e.message); }
  };
}
// invite the writer of a message into one of my groups
function inviteDialog(p) {
  if (!groups.length) { toast('Make a group first (＋ Group), then you can invite people to it'); return; }
  const bg = document.createElement('div'); bg.className = 'ed-bg';
  bg.innerHTML = `<div class="ed" role="dialog" aria-modal="true"><h3>Invite ${esc(p.name)}</h3><p style="color:#aaa;margin:0 0 10px">They’ll see an invite next time they open the chat.</p>
    <div class="choices">${groups.map((g) => `<button type="button" class="btn btn-dark" data-id="${esc(g.id)}">🔒 ${esc(g.name)}</button>`).join('')}</div>
    <div class="row"><button type="button" class="btn btn-ghost" data-a="close">Cancel</button></div><p class="err" hidden></p></div>`;
  document.body.appendChild(bg);
  bg.onclick = (e) => { if (e.target === bg) bg.remove(); };
  bg.querySelector('[data-a=close]').onclick = () => bg.remove();
  bg.querySelectorAll('[data-id]').forEach((b) => b.onclick = async () => {
    try { const r = await call(`groups/${b.dataset.id}/invite`, { method: 'POST', body: { room, post: p.id } }); bg.remove(); toast(`Invite sent to ${r.invited}`); }
    catch (e) { const err = bg.querySelector('.err'); err.hidden = false; err.textContent = e.message; }
  });
}

// ---------------------------------------------------------------- messages
async function refresh(scroll) {
  if (!room) return;
  let data;
  try { data = await call('board/' + room); } catch (e) { if (scroll) $('msgs').innerHTML = `<div class="empty">Couldn't load the chat: ${esc(e.message)}</div>`; return; }
  $('banned').hidden = !data.banned;
  $('compose').hidden = !!data.banned;
  if (data.room && data.room.about) $('roomAbout').textContent = data.room.about;
  const sig = data.posts.map((p) => p.id).join(',') + data.banned;
  if (sig === lastSig && !scroll) return;
  lastSig = sig;
  const box = $('msgs'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.innerHTML = data.posts.length ? '' : '<div class="empty">No messages yet – say hello!</div>';
  for (const p of data.posts) {
    const m = document.createElement('div'); m.className = 'msg' + (p.mine ? ' mine' : '');
    m.innerHTML = `<div class="who">${esc(p.name)}</div><div class="txt">${esc(p.text)}</div><div class="meta"><span>${esc(when(p.at))}</span>${p.mine ? '<button type="button" data-a="del">Delete</button>' : '<button type="button" data-a="inv">Invite to group</button><button type="button" data-a="rep">Report</button>'}</div>`;
    m.querySelectorAll('button').forEach((btn) => btn.onclick = async () => {
      const a = btn.dataset.a;
      if (a === 'inv') { inviteDialog(p); return; }
      if (!confirm(a === 'del' ? 'Delete your message?' : `Report ${p.name} for this message (rude, offensive, spam or trolling)? If 3 different people report someone, they're banned from this chat.`)) return;
      try { const r = await call(`board/${room}/${p.id}${a === 'del' ? '' : '/report'}`, { method: a === 'del' ? 'DELETE' : 'POST' }); toast(a === 'del' ? 'Deleted' : r.banned ? `Reported – ${p.name} is now banned from this chat` : 'Reported – thanks'); refresh(true); } catch (err) { toast(err.message); }
    });
    box.appendChild(m);
  }
  if (scroll || atBottom) box.scrollTop = box.scrollHeight;
}

function open(id) {
  room = id; lastSig = '';
  const r = current();
  $('roomName').textContent = r ? (r.about !== undefined ? r.name : '🔒 ' + r.name) : 'Chat';
  $('roomAbout').textContent = r && r.about ? r.about : r ? 'Private group' : '';
  history.replaceState(null, '', '#' + id);
  renderRooms(); renderGroupBar();
  $('msgs').innerHTML = '<div class="empty">Loading…</div>';
  refresh(true);
}

$('compose').onsubmit = async (e) => {
  e.preventDefault();
  const text = $('text').value.trim(); if (!text) return;
  const name = myName(false); if (!name) return;
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try { await call('board/' + room, { method: 'POST', body: { name, text } }); $('text').value = ''; await refresh(true); }
  catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
};
$('text').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('compose').requestSubmit(); } };

// refresh while visible (and look for new invites now and then)
let ticks = 0;
const poll = () => { clearInterval(timer); timer = setInterval(() => { if (document.hidden) return; refresh(); if (++ticks % 6 === 0) loadGroups(); }, 5000); };
document.addEventListener('visibilitychange', () => { if (!document.hidden) { refresh(); loadGroups(); } });

(async () => {
  showWho();
  try { rooms = (await call('board')).rooms; } catch (e) { $('roomAbout').textContent = "Couldn't reach the chat: " + e.message; return; }
  await loadGroups();
  const want = location.hash.slice(1);
  open(rooms.some((r) => r.id === want) || groups.some((g) => g.room === want) ? want : rooms[0].id);
  poll();
})();
