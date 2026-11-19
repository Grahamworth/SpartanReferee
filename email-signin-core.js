// Email sign-in's parts that must be right whatever Microsoft's page does (the page itself is email-signin-web.js). The accounts
// are Microsoft Entra External ID: Microsoft's page takes the password and sends the codes.
const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const randomText = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));
export async function challengeFor(verifier) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}
/** Microsoft's page. prompt=create opens on sign-up; prompt=login always asks again, so a shared phone is safe. "Sign in with
 *  Microsoft" passes select_account instead, so whoever signed out can pick another account. */
export function signInAddress(cfg, { create, state, challenge, prompt, loginHint }) {
  const q = new URLSearchParams({
    client_id: cfg.clientId, response_type: 'code', response_mode: 'query', redirect_uri: cfg.redirectUri, scope: 'openid profile email',
    state, code_challenge: challenge, code_challenge_method: 'S256', prompt: prompt || (create ? 'create' : 'login'),
  });
  // the address to sign in with, filled in on Microsoft's page (the join page: the invited one)
  if (loginHint) q.set('login_hint', loginHint);
  return `${cfg.authorizeUrl}?${q}`;
}
/** What came back from Microsoft's page: null when it isn't a link for this sign-in. */
export function readReturn(link, pending) {
  if (!pending || !String(link).startsWith(pending.redirectUri)) return null;
  // Microsoft adds a slash to an address with no path: ...://auth/?code=...
  const query = /^\/?\?(.*)$/s.exec(String(link).slice(pending.redirectUri.length));
  if (!query) return null;
  const q = new URLSearchParams(query[1]);
  if (q.get('state') !== pending.state) return { message: 'That sign-in didn’t match. Please try again.' };
  if (q.get('code')) return { code: q.get('code') };
  const err = q.get('error') || '', stated = /AADSTS\d+/.exec(q.get('error_description') || '');
  if (err === 'access_denied' && !stated) return { message: 'Sign-in was cancelled.' };
  return { message: `Sign-in didn’t finish${stated ? ` (${stated[0]})` : ''}. Please try again.` };
}
