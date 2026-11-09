// The AI judge on the site is for admins and judges; companies use it inside their video review (the free camera, or a server's). Everyone else sees a note instead. Pages served by a company's HeadJudge server (under /judge/, behind its own
// login) or a local address are the referees' own, so they skip the check; without internet, a phone that has been confirmed as a referee before carries on.
import { call } from './api-base.js';

const OK_KEY = 'sp_judge_ok';
const remember = (v) => { try { if (v) localStorage.setItem(OK_KEY, '1'); else localStorage.removeItem(OK_KEY); } catch { /* private mode */ } };
const confirmedBefore = () => { try { return localStorage.getItem(OK_KEY) === '1'; } catch { return false; } };

const cover = document.createElement('div');
cover.id = 'judgeGate';
cover.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0b0b0b;color:#fff;display:grid;place-content:center;text-align:center;padding:24px;font-family:Barlow,system-ui,sans-serif';
cover.innerHTML = '<p style="color:#9a9a9a">Checking…</p>';
document.documentElement.appendChild(cover);
const fromReceiver = new URLSearchParams(location.search).get('mode') === 'practice' || location.protocol === 'app:' || location.pathname.startsWith('/judge/') || /^(127|10|192\.168|172\.(1[6-9]|2\d|3[01])|100)(\.\d+){2,3}$/.test(location.hostname);
(fromReceiver ? Promise.resolve({ judge: true }) : call('me').then((me) => { remember(me.judge || me.admin); return me; }, () => ({ judge: confirmedBefore(), offline: true }))).then((me) => {
  if (me.judge || me.admin) { cover.remove(); return; }
  cover.innerHTML = `<div style="max-width:420px">
    <h1 style="font:italic 900 34px 'Barlow Condensed',sans-serif;text-transform:uppercase;margin:0 0 8px">AI <span style="color:#e2231a">Judge</span></h1>
    <p>The AI judge is part of HeadJudge's video review.</p>${me.offline ? '<p style="color:#9a9a9a">No internet right now: connect once so this device can confirm who you are. After that it works offline.</p>' : ''}
    <p style="color:#9a9a9a">Open it from your console: the free camera, or a booked server's video review.</p>
    <p style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:18px">
      <a href="/console.html" style="background:#e2231a;color:#fff;padding:12px 18px;font-weight:800;text-decoration:none;text-transform:uppercase">My console</a>
      <a href="/" style="border:2px solid #fff;color:#fff;padding:10px 16px;font-weight:800;text-decoration:none;text-transform:uppercase">Home</a></p></div>`;
});
