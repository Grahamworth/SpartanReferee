'use strict';
/* Runs the site and the API together on this computer, with an in-memory store (nothing is saved):
   node api/dev-server.js [port]   then open http://localhost:8795 */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { createApi } = require('./src/core');
const { memoryStore } = require('./src/store');
const { blobSigner } = require('./src/recordings');
const { REDIRECT_URI } = require('./src/email-signin');

const root = path.join(__dirname, '..'), port = +process.argv[2] || 8795;
// The learning platform (/learn) on this computer: the real Azure SQL database, in its own "learn_dev" schema so nothing here
// touches the live data. LEARN_FROM_AZ=1 reads the database's settings from the site's own (az, signed in), never from a file.
function learnDatabase() {
  const { dbFromEnv } = require('./src/learn/db');
  const env = { ...process.env };
  if (!env.LEARN_SQL_PASSWORD && env.LEARN_FROM_AZ) {
    try {
      const out = require('node:child_process').execSync('az staticwebapp appsettings list --name spartanreferee -g rg-spartanreferee-uksouth --subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24 -o json --query properties', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true });
      Object.assign(env, JSON.parse(out));
      // here (its own learn_dev schema, made by migrations) the admin login, as the site's learn_app login can't make tables
      if (env.LEARN_SQL_ADMIN_USER) { env.LEARN_SQL_USER = env.LEARN_SQL_ADMIN_USER; env.LEARN_SQL_PASSWORD = env.LEARN_SQL_ADMIN_PASSWORD; }
      // narration's storage, for /learn's audio only (never the recordings): the storage account's connection, read the same way
      try { env.LEARN_STORAGE = require('node:child_process').execSync('az storage account show-connection-string -n spartanreferee -g rg-spartanreferee-uksouth --subscription 65c0ccca-69f7-43eb-9246-3bd6a6a06b24 -o tsv', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true }).trim(); } catch { /* no narration here */ }
    } catch { console.log('The learning platform\'s settings couldn\'t be read with az: /learn is off'); }
  }
  learnSettings = env;
  return dbFromEnv(env, env.LEARN_SCHEMA || 'learn_dev');
}
let learnSettings = {};
// email here is pretend: what would be sent is kept, and GET /api/dev/mail shows it (newest last)
const { memoryMailer } = require('./src/mailer');
const mailer = memoryMailer();
const api = createApi({
  mailer, siteUrl: 'http://localhost:8795',
  learnDb: learnDatabase(),
  // narration (Azure AI Speech) and where it's kept, when the site's settings were read with az
  learnSpeech: learnSettings.LEARN_SPEECH_KEY ? { key: learnSettings.LEARN_SPEECH_KEY, region: learnSettings.LEARN_SPEECH_REGION || 'uksouth' } : null,
  learnMedia: learnSettings.LEARN_STORAGE ? blobSigner(learnSettings.LEARN_STORAGE, 'learn-media') : null,
  // the Assistant, on the same models as the live site (its knowledge: assistant/learn_dev/index.json, from scripts/assistant-index.mjs)
  assistantAi: require('./src/assistant-ai').createAi({ endpoint: learnSettings.ASSISTANT_ENDPOINT, key: learnSettings.ASSISTANT_KEY, model: learnSettings.ASSISTANT_MODEL || 'luna', embedModel: learnSettings.ASSISTANT_EMBED || 'embed' }),
  assistantIndex: learnSettings.LEARN_STORAGE ? blobSigner(learnSettings.LEARN_STORAGE, 'assistant') : null,
  blobSigner: process.env.STORAGE_CONNECTION ? blobSigner(process.env.STORAGE_CONNECTION) : null,
  // logos stay in the page's own data link here: nothing is saved
  putBrand: async (_name, buf, type) => `data:${type};base64,${buf.toString('base64')}`,
  maxRunningServers: +process.env.MAX_RUNNING_SERVERS || 1, serverHourPrice: 0.66,
  store: memoryStore(), secret: 'dev-secret-dev-secret-dev-secret-dev', googleClientId: 'dev', adminEmails: (process.env.ADMIN_EMAILS || '').split(','),
  verifyGoogle: async (t) => { const m = /^dev:(.+@.+)$/.exec(t); if (!m) throw new Error('bad'); return { sub: m[1], email: m[1], name: m[1].split('@')[0] }; },
  // a pretend Microsoft: the code "dev:someone@example.com" signs in as that address
  emailSignIn: { config: { authorizeUrl: 'https://login.invalid/authorize', clientId: 'dev', redirectUri: REDIRECT_URI, webRedirectUri: 'http://localhost:8795/email-return.html' }, redeem: async (c) => { const m = /^dev:(.+@.+)$/.exec(c); if (!m) throw new Error('bad'); return { sub: m[1], email: m[1], name: m[1].split('@')[0] }; } },
  // and a pretend "Sign in with Microsoft", the same way
  microsoftSignIn: { config: { authorizeUrl: 'https://login.invalid/ms/authorize', clientId: 'dev', webRedirectUri: 'http://localhost:8795/email-return.html' }, redeem: async (c) => { const m = /^dev:(.+@.+)$/.exec(c); if (!m) throw new Error('bad'); return { sub: 'ms:' + m[1], email: m[1], shownEmail: m[1], name: m[1].split('@')[0] }; } },
  // a pretend Stripe: its page is checkout.invalid, and the session cs_dev_<company> is that company saving a card. DEV_NO_CARDS=1 leaves
  // card payments off, as the live site is until Stripe is set up: then only admins can book.
  payments: process.env.DEV_NO_CARDS ? null : { startSetup: async ({ companyId }) => ({ url: 'https://checkout.invalid/pay?company=' + companyId, customerId: 'cus_dev' }), finishSetup: async (id, companyId) => { if (id !== 'cs_dev_' + companyId) throw new Error('no'); return { customerId: 'cus_dev', paymentMethodId: 'pm_dev', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }; } },
});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.onnx': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.mjs': 'text/javascript' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/dev/mail') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(mailer.sent.slice(-20))); }
  if (url.pathname.startsWith('/api/')) {
    let raw = ''; for await (const c of req) raw += c;
    let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { /* not JSON */ }
    const r = await api.handle({ method: req.method, path: url.pathname.slice(5), headers: req.headers, body, query: Object.fromEntries(url.searchParams) });
    res.writeHead(r.status, r.headers);
    return res.end(r.body === null ? '' : JSON.stringify(r.body));
  }
  // staticwebapp.config.json does this on the real site
  let p = path.join(root, decodeURIComponent(url.pathname));
  if (!p.startsWith(root)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
