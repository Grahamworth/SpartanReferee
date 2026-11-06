'use strict';
/* Azure Functions (Node v4 model) entry: one catch-all HTTP function handing requests to core.js.
   Settings: STORAGE_CONNECTION (Azure Table Storage), ADMIN_KEY (optional: while unset, anyone can edit the home page). */
const { app } = require('@azure/functions');
const { createApi, CORS } = require('./core');
const { tableStore } = require('./store');
const { blobSigner } = require('./recordings');

// Settings: GOOGLE_CLIENT_ID (the web client for Google sign-in), SESSION_SECRET (signs session tokens), ADMIN_EMAILS (comma separated)
let api;
function googleVerifier(clientId) {
  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client();
  return async (idToken) => { const t = await client.verifyIdToken({ idToken, audience: clientId }); return t.getPayload(); };
}
const getApi = () => (api = api || createApi({
  store: tableStore(process.env.STORAGE_CONNECTION), blobSigner: blobSigner(process.env.STORAGE_CONNECTION), adminKey: process.env.ADMIN_KEY || '',
  adminEmails: (process.env.ADMIN_EMAILS || '').split(','), googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  verifyGoogle: process.env.GOOGLE_CLIENT_ID ? googleVerifier(process.env.GOOGLE_CLIENT_ID) : null, secret: process.env.SESSION_SECRET || '',
  fetchText: async (url) => { const r = await fetch(url, { headers: { 'User-Agent': 'Spartans app (news reader)' } }); if (!r.ok) throw new Error(String(r.status)); return r.text(); },
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
