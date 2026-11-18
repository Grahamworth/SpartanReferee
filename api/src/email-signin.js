'use strict';
/* Email accounts for companies on the website: Microsoft Entra External ID, set up by scripts/set-up-email-sign-in.mjs.
   Microsoft handles the password, the code that proves the address at sign-up, and the emailed code at each sign-in.
   The page gets a one-time code back from Microsoft's page and hands it here with its PKCE verifier. We swap them for
   Microsoft's ID token directly over HTTPS, which is why that token's signature needn't be checked again (OpenID
   Connect Core 3.1.3.7), and the API then issues its own session. The app is a public client, so there's no secret.
   This is done here rather than in the app because Microsoft refuses cross-origin token requests from native clients. */
const REDIRECT_URI = 'com.vdaso.spartans.broadcast://auth';
const WEB_REDIRECT_URI = 'https://brave-forest-022879f03.3.azurestaticapps.net/email-return.html'; // the website's; scripts/set-up-email-sign-in.mjs registers both

const claimsOf = (idToken) => JSON.parse(Buffer.from(String(idToken).split('.')[1] || '', 'base64url').toString());

function createEmailSignIn({ subdomain, tenantId, clientId, fetchFn = fetch, now = Date.now }) {
  if (!subdomain || !tenantId || !clientId) return null;
  const base = `https://${subdomain}.ciamlogin.com/${tenantId}/oauth2/v2.0`;
  return {
    config: { authorizeUrl: `${base}/authorize`, clientId, redirectUri: REDIRECT_URI, webRedirectUri: WEB_REDIRECT_URI },
    async redeem(code, verifier, redirectUri = REDIRECT_URI) {
      if (redirectUri !== REDIRECT_URI && redirectUri !== WEB_REDIRECT_URI) throw new Error('That isn\'t one of our return addresses');
      const r = await fetchFn(`${base}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, code_verifier: verifier, redirect_uri: redirectUri, scope: 'openid profile email' }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out.id_token) throw new Error(`Microsoft refused the code: ${String(out.error_description || out.error || r.status).split('\n')[0].slice(0, 200)}`);
      const c = claimsOf(out.id_token);
      if (c.aud !== clientId) throw new Error('That token is for another app');
      if (String(c.tid).toLowerCase() !== tenantId.toLowerCase()) throw new Error('That token is from another tenant');
      if (!(c.exp * 1000 > now())) throw new Error('That token has expired');
      const sub = c.oid || c.sub;
      if (!sub) throw new Error('That token doesn\'t say who it is');
      return { sub, email: c.email || c.preferred_username || '', name: c.name || '' };
    },
  };
}

module.exports = { createEmailSignIn, REDIRECT_URI, WEB_REDIRECT_URI };
