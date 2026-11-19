'use strict';
/* Email from SpartanReferee (19 November 2026): invites, sign-in codes and learning reminders, sent with Azure Communication Services
   Email (spartanreferee-comms, its Azure-managed domain), through its REST API signed with the resource's key, so no extra package.
   Settings: EMAIL_CONNECTION ("endpoint=https://…;accesskey=…", a secret) and EMAIL_FROM (DoNotReply@<domain>.azurecomm.net).
   Locally (dev-server.js) a pretend mailer keeps what would be sent, to read back in tests, and sends nothing.

   send({ to, subject, text, html }) -> { id } once Azure has accepted it (it's delivered in the background), or throws. */
const crypto = require('node:crypto');

const API = '2023-03-31';
const part = (cs, k) => (new RegExp(`(?:^|;)${k}=([^;]+)`, 'i').exec(cs || '') || [])[1] || '';

function createMailer({ connection, from, doFetch = fetch, now = () => new Date() }) {
  const endpoint = part(connection, 'endpoint').replace(/\/+$/, ''), key = part(connection, 'accesskey');
  if (!endpoint || !key || !from) return null;
  const host = new URL(endpoint).host;
  async function send({ to, subject, text, html }) {
    const path = `/emails:send?api-version=${API}`;
    const body = JSON.stringify({
      senderAddress: from,
      recipients: { to: (Array.isArray(to) ? to : [to]).map((address) => ({ address })) },
      content: { subject, plainText: text, ...(html ? { html } : {}) },
    });
    const date = now().toUTCString(), hash = crypto.createHash('sha256').update(body).digest('base64');
    const sig = crypto.createHmac('sha256', Buffer.from(key, 'base64')).update(`POST\n${path}\n${date};${host};${hash}`).digest('base64');
    const r = await doFetch(`${endpoint}${path}`, {
      method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'x-ms-date': date, 'x-ms-content-sha256': hash, Authorization: `HMAC-SHA256 SignedHeaders=x-ms-date;host;x-ms-content-sha256&Signature=${sig}` },
    });
    if (r.status !== 202) throw Object.assign(new Error(`The email service said ${r.status}`), { status: 502 });
    return { id: (await r.json().catch(() => ({}))).id || '' };
  }
  return { send };
}

/** locally and in tests: keeps each email (newest last) instead of sending it */
function memoryMailer() {
  const sent = [];
  return { sent, send: async (m) => { sent.push({ ...m, at: Date.now() }); return { id: `dev-${sent.length}` }; } };
}

/** a plain email with one button-like link, in SpartanReferee's colours; text is the plain version (every line kept) */
function layout({ title, lines, link, linkText, foot }) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><html><body style="margin:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1b1f24">
<div style="max-width:560px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border-radius:12px;padding:24px;border-top:4px solid #e2231a">
<p style="margin:0 0 16px;font-weight:700;font-size:18px">Spartan<span style="color:#e2231a">Referee</span></p>
<h1 style="font-size:20px;margin:0 0 12px">${esc(title)}</h1>
${lines.map((l) => `<p style="margin:0 0 12px;line-height:1.5">${esc(l)}</p>`).join('')}
${link ? `<p style="margin:20px 0"><a href="${esc(link)}" style="background:#2457c5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:700;display:inline-block">${esc(linkText)}</a></p>
<p style="margin:0;font-size:13px;color:#59626e;word-break:break-all">${esc(link)}</p>` : ''}
${foot ? `<p style="margin:20px 0 0;font-size:13px;color:#59626e">${esc(foot)}</p>` : ''}</div></div></body></html>`;
  const text = [title, '', ...lines, ...(link ? ['', `${linkText}: ${link}`] : []), ...(foot ? ['', foot] : [])].join('\n');
  return { html, text };
}

module.exports = { createMailer, memoryMailer, layout };
