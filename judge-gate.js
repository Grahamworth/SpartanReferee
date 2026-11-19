// The AI judge on the site is for admins and judges; companies use it inside their video review (the free camera, or a server's). Everyone else sees a note instead. Pages served by a company's SpartanReferee server (under /judge/, behind its own
// login) or a local address are the referees' own, so they skip the check; without internet, a phone that has been confirmed as a referee before carries on.
import { call } from './api-base.js';

const OK_KEY = 'sp_judge_ok';
const remember = (v) => { try { if (v) localStorage.setItem(OK_KEY, '1'); else localStorage.removeItem(OK_KEY); } catch { /* private mode */ } };
const confirmedBefore = () => { try { return localStorage.getItem(OK_KEY) === '1'; } catch { return false; } };

const cover = document.createElement('div');
cover.id = 'judgeGate';
// in the page's Look (styles.css: --black is the page, --white the writing, --muted, --primary)
cover.style.cssText = 'position:fixed;inset:0;z-index:9999;background:var(--black,#111418);color:var(--white,#eef1f4);display:grid;place-content:center;text-align:center;padding:24px;font-family:Barlow,system-ui,sans-serif';
cover.innerHTML = '<p style="color:var(--muted,#a5adb8)">Checking…</p>';
document.documentElement.appendChild(cover);
const fromReceiver = new URLSearchParams(location.search).get('mode') === 'practice' || location.protocol === 'app:' || location.pathname.startsWith('/judge/') || /^(127|10|192\.168|172\.(1[6-9]|2\d|3[01])|100)(\.\d+){2,3}$/.test(location.hostname);
(fromReceiver ? Promise.resolve({ judge: true }) : call('me').then((me) => { remember(me.judge || me.admin); return me; }, () => ({ judge: confirmedBefore(), offline: true }))).then((me) => {
  if (me.judge || me.admin) { cover.remove(); return; }
  cover.innerHTML = `<div style="max-width:420px">
    <h1 style="font:700 32px/1.2 Barlow,sans-serif;margin:0 0 8px">AI <span style="color:#e2231a">Judge</span></h1>
    <p>The AI judge is part of SpartanReferee's video review.</p>${me.offline ? '<p style="color:var(--muted,#a5adb8)">No internet right now: connect once so this device can confirm who you are. After that it works offline.</p>' : ''}
    <p style="color:var(--muted,#a5adb8)">Open it from your console: the free camera, or a booked server's video review.</p>
    <p style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:18px">
      <a href="/console.html" style="background:var(--primary,#3566d6);color:#fff;padding:12px 18px;border-radius:10px;font-weight:700;text-decoration:none">My console</a>
      <a href="/" style="border:1px solid var(--line,#333a43);color:inherit;padding:11px 16px;border-radius:10px;font-weight:700;text-decoration:none">Home</a></p></div>`;
});
