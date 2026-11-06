'use strict';
// Who may use a company's server. The HeadJudge site signs a short-lived link for someone signed in and allowed; following it
// here swaps it for a cookie. Both are signed with the secret this server was given when it was created, which only it and the site hold.
const crypto = require('crypto');

const COOKIE = 'hj_session', SESSION_HOURS = 14;
const mac = (secret, p) => crypto.createHmac('sha256', secret).update(p).digest('base64url');

function sign(secret, payload) { const p = Buffer.from(JSON.stringify(payload)).toString('base64url'); return `${p}.${mac(secret, p)}`; }
/** the payload if the token is genuine and in date, otherwise null */
function verify(secret, token, now = Date.now()) {
  const [p, m, more] = String(token || '').split('.');
  if (!p || !m || more !== undefined || !secret) return null;
  const good = Buffer.from(mac(secret, p)), got = Buffer.from(m);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  try { const v = JSON.parse(Buffer.from(p, 'base64url').toString()); return v.exp > now ? v : null; } catch { return null; }
}
function cookieValue(req, name = COOKIE) {
  for (const part of String(req.headers.cookie || '').split(';')) { const [k, ...v] = part.trim().split('='); if (k === name) return v.join('='); }
  return '';
}
const session = (secret, req, now) => { const v = verify(secret, cookieValue(req), now); return v && v.kind === 'session' ? v : null; };
/** a login link's token swapped for a session cookie: null if the link isn't good */
function login(secret, token, now = Date.now()) {
  const v = verify(secret, token, now);
  if (!v || v.kind !== 'login') return null;
  const exp = now + SESSION_HOURS * 3600e3;
  return { cookie: `${COOKIE}=${sign(secret, { kind: 'session', who: v.who, exp })}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`, who: v.who };
}
module.exports = { sign, verify, session, login, cookieValue, COOKIE };
