'use strict';
/* Azure Functions (Node v4 model) entry: one catch-all HTTP function handing requests to core.js.
   Settings: STORAGE_CONNECTION (Azure Table Storage), ADMIN_KEY (optional: while unset, anyone can edit the home page). */
const { app } = require('@azure/functions');
const { createApi, CORS } = require('./core');
const { tableStore } = require('./store');
const { blobSigner, brandWriter } = require('./recordings');
const { createEmailSignIn } = require('./email-signin');
const { createMicrosoftSignIn } = require('./microsoft-signin');
const { createPayments } = require('./payments');

// Settings: GOOGLE_CLIENT_ID (the web client for Google sign-in), SESSION_SECRET (signs session tokens), ADMIN_EMAILS (comma separated),
// CIAM_SUBDOMAIN, CIAM_TENANT_ID, CIAM_CLIENT_ID (email sign-in; none is a secret), MICROSOFT_CLIENT_ID (Sign in with Microsoft; not a secret),
// STRIPE_SECRET_KEY (saving cards; a secret)
let api;
function googleVerifier(clientId) {
  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client();
  return async (idToken) => { const t = await client.verifyIdToken({ idToken, audience: clientId }); return t.getPayload(); };
}
const getApi = () => (api = api || createApi({
  store: tableStore(process.env.STORAGE_CONNECTION), blobSigner: blobSigner(process.env.STORAGE_CONNECTION), putBrand: brandWriter(process.env.STORAGE_CONNECTION), maxRunningServers: +process.env.MAX_RUNNING_SERVERS || 1, serverHourPrice: +process.env.SERVER_HOUR_PRICE || 0.66, adminKey: process.env.ADMIN_KEY || '',
  adminEmails: (process.env.ADMIN_EMAILS || '').split(','), googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  verifyGoogle: process.env.GOOGLE_CLIENT_ID ? googleVerifier(process.env.GOOGLE_CLIENT_ID) : null, secret: process.env.SESSION_SECRET || '',
  emailSignIn: createEmailSignIn({ subdomain: process.env.CIAM_SUBDOMAIN, tenantId: process.env.CIAM_TENANT_ID, clientId: process.env.CIAM_CLIENT_ID }),
  microsoftSignIn: createMicrosoftSignIn({ clientId: process.env.MICROSOFT_CLIENT_ID }),
  payments: createPayments({ secretKey: process.env.STRIPE_SECRET_KEY, siteUrl: 'https://zealous-island-03d6db503.8.azurestaticapps.net' }),
}));

app.http('api', {
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  authLevel: 'anonymous',
  route: '{*path}',
  handler: async (request, context) => {
    if (!process.env.STORAGE_CONNECTION) { context.error('STORAGE_CONNECTION is not set'); return { status: 503, jsonBody: { error: 'The chat isn’t set up yet' }, headers: CORS }; }
    const body = request.method === 'POST' || request.method === 'PUT' ? await request.json().catch(() => null) : null;
    const r = await getApi().handle({ method: request.method, path: request.params.path, headers: Object.fromEntries(request.headers), body, query: Object.fromEntries(request.query) });
    return r.body === null ? { status: r.status, headers: r.headers } : { status: r.status, jsonBody: r.body, headers: r.headers };
  },
});
