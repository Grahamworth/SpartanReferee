'use strict';
/* "Sign in with Microsoft": any work or school account, or a personal Microsoft account (Outlook, Hotmail, Xbox), set up by
   scripts/set-up-microsoft-sign-in.mjs. It works like email sign-in (email-signin.js): Microsoft's page comes back to
   email-return.html with a one-time code, which the page hands here with its PKCE verifier. We swap them for Microsoft's ID
   token directly over HTTPS, so its signature needn't be checked again (OpenID Connect Core 3.1.3.7). The app is a public
   client, so there's no secret.

   The address counts for admin rights only when Microsoft vouches for it: a personal account's own address, or a work
   account whose email domain its organisation has proved it owns (the xms_edov claim). Anyone running their own Microsoft
   organisation could otherwise type any address into a user's email. */
const AUTHORITY = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const WEB_REDIRECT_URI = 'https://zealous-island-03d6db503.8.azurestaticapps.net/email-return.html';
const PERSONAL_ACCOUNTS = '9188040d-6c67-4c5b-b112-36a304b66dad'; // the tenant every personal Microsoft account signs in through

const claimsOf = (idToken) => JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString());
const yes = (v) => v === true || v === 1 || v === 'true' || v === '1';

function createMicrosoftSignIn({ clientId, fetchFn = fetch, now = Date.now }) {
  if (!clientId) return null;
  return {
    config: { authorizeUrl: `${AUTHORITY}/authorize`, clientId, webRedirectUri: WEB_REDIRECT_URI },
    async redeem(code, verifier, redirectUri) {
      if (redirectUri !== WEB_REDIRECT_URI) throw new Error('That isn\'t our return address');
      const r = await fetchFn(`${AUTHORITY}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, scope: 'openid profile email' }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out.id_token) throw new Error(`Microsoft refused the code: ${String(out.error_description || out.error || r.status).split('\n')[0].slice(0, 200)}`);
      const c = claimsOf(out.id_token);
      if (c.aud !== clientId) throw new Error('That token is for another app');
      if (!(c.exp * 1000 > now())) throw new Error('That token has expired');
      const tid = String(c.tid || '').toLowerCase(), who = c.oid || c.sub;
      if (!tid || !who) throw new Error('That token doesn\'t say who it is');
      if (c.iss !== `https://login.microsoftonline.com/${tid}/v2.0`) throw new Error('That token is from somewhere else');
      const email = String(c.email || '').toLowerCase();
      const vouched = email && (tid === PERSONAL_ACCOUNTS || yes(c.xms_edov));
      return { sub: `${tid}:${who}`, email: vouched ? email : '', shownEmail: email || String(c.preferred_username || ''), name: c.name || '' };
    },
  };
}

module.exports = { createMicrosoftSignIn, WEB_REDIRECT_URI, PERSONAL_ACCOUNTS };
