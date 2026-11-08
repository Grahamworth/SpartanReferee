'use strict';
/* Runs the site and the API together on this computer, with an in-memory store (nothing is saved):
   node api/dev-server.js [port]   then open http://localhost:8795 */
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { createApi } = require('./src/core');
const { memoryStore } = require('./src/store');
const { blobSigner } = require('./src/recordings');
const { REDIRECT_URI } = require('./src/email-signin');

const root = path.join(__dirname, '..'), port = +process.argv[2] || 8795;
const api = createApi({
  blobSigner: process.env.STORAGE_CONNECTION ? blobSigner(process.env.STORAGE_CONNECTION) : null,
  // logos stay in the page's own data link here: nothing is saved
  putBrand: async (_name, buf, type) => `data:${type};base64,${buf.toString('base64')}`,
  maxRunningServers: +process.env.MAX_RUNNING_SERVERS || 1, serverHourPrice: 0.66,
  store: memoryStore(), secret: 'dev-secret-dev-secret-dev-secret-dev', googleClientId: 'dev', adminEmails: (process.env.ADMIN_EMAILS || '').split(','),
  verifyGoogle: async (t) => { const m = /^dev:(.+@.+)$/.exec(t); if (!m) throw new Error('bad'); return { sub: m[1], email: m[1], name: m[1].split('@')[0] }; },
  // a pretend Microsoft: the code "dev:someone@example.com" signs in as that address
  emailSignIn: { config: { authorizeUrl: 'https://login.invalid/authorize', clientId: 'dev', redirectUri: REDIRECT_URI, webRedirectUri: 'http://localhost:8795/email-return.html' }, redeem: async (c) => { const m = /^dev:(.+@.+)$/.exec(c); if (!m) throw new Error('bad'); return { sub: m[1], email: m[1], name: m[1].split('@')[0] }; } },
  // a pretend Stripe: its page is checkout.invalid, and the session cs_dev_<company> is that company saving a card
  payments: { startSetup: async ({ companyId }) => ({ url: 'https://checkout.invalid/pay?company=' + companyId, customerId: 'cus_dev' }), finishSetup: async (id, companyId) => { if (id !== 'cs_dev_' + companyId) throw new Error('no'); return { customerId: 'cus_dev', paymentMethodId: 'pm_dev', brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030 }; } },
});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.onnx': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.mjs': 'text/javascript' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
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
}).listen(port, () => console.log(`http://localhost:${port}`));
