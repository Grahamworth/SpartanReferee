'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createApi } = require('../src/core');
const { memoryStore } = require('../src/store');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const logoLink = (buf = PNG, type = 'png') => `data:image/${type};base64,${buf.toString('base64')}`;
const SECRET = 'test-secret-test-secret-test-secret';

async function setup() {
  const puts = [];
  const api = createApi({
    store: memoryStore(), secret: SECRET, googleClientId: 'x', adminEmails: ['boss@example.com'],
    verifyGoogle: async (t) => ({ sub: t, email: `${t}@example.com`, name: t }),
    putBrand: async (name, buf, type) => { puts.push({ name, buf, type }); return `https://logos.example/${name}`; },
  });
  const login = async (who) => ({ Authorization: `Bearer ${(await api.handle({ method: 'POST', path: 'auth/google', body: { idToken: who } })).body.token}` });
  return { api, login, puts, boss: await login('boss') };
}
const good = (over = {}) => ({ name: 'Spartan Race', id: 'spartan', website: 'spartan.com', about: 'Obstacle races', contact: 'Sam Lee', theme: { primary: '#E2231A', accent: '#ffffff', mode: 'dark' }, logo: logoLink(), ...over });
const apply = (api, h, body = good()) => api.handle({ method: 'POST', path: 'companies', headers: h, body });

test('you have to be signed in to apply', async () => {
  const { api } = await setup();
  assert.strictEqual((await apply(api, {})).status, 401);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'companies/mine' })).status, 401);
});

test('a registration is approved straight away, with its logo stored and the account\'s email', async () => {
  const { api, login, puts } = await setup();
  const r = await apply(api, await login('sam'));
  assert.strictEqual(r.status, 200);
  const c = r.body.company;
  assert.strictEqual(c.status, 'approved');
  assert.strictEqual(c.email, 'sam@example.com');
  assert.strictEqual(c.website, 'https://spartan.com/');
  assert.strictEqual(c.theme.primary, '#e2231a');
  assert.match(c.logo, /^https:\/\/logos\.example\/spartan\/[0-9a-f]{16}\.png$/);
  assert.strictEqual(puts[0].type, 'image/png');
  assert.ok(puts[0].buf.equals(PNG));
});

test('a blocked company disappears from public view, and only the brand is ever public', async () => {
  const { api, login, boss } = await setup();
  await apply(api, await login('sam'));
  await api.handle({ method: 'POST', path: 'admin/companies/spartan/suspend', headers: boss, body: {} });
  assert.strictEqual((await api.handle({ method: 'GET', path: 'companies/spartan' })).status, 404);
  const a = await api.handle({ method: 'POST', path: 'admin/companies/spartan/approve', headers: boss, body: {} });
  assert.strictEqual(a.body.company.status, 'approved');
  const pub = await api.handle({ method: 'GET', path: 'companies/spartan' });
  assert.deepStrictEqual(Object.keys(pub.body).sort(), ['id', 'logo', 'name', 'theme']);
});

test('suspending takes it off again, and the owner sees why', async () => {
  const { api, login, boss } = await setup();
  const h = await login('sam');
  await apply(api, h);
  await api.handle({ method: 'POST', path: 'admin/companies/spartan/approve', headers: boss, body: {} });
  await api.handle({ method: 'POST', path: 'admin/companies/spartan/suspend', headers: boss, body: { note: 'Unpaid' } });
  assert.strictEqual((await api.handle({ method: 'GET', path: 'companies/spartan' })).status, 404);
  const mine = await api.handle({ method: 'GET', path: 'companies/mine', headers: h });
  assert.strictEqual(mine.body.company.status, 'suspended');
  assert.strictEqual(mine.body.company.note, 'Unpaid');
});

test('only admins can list or decide', async () => {
  const { api, login } = await setup();
  const h = await login('sam');
  await apply(api, h);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'admin/companies', headers: h })).status, 403);
  assert.strictEqual((await api.handle({ method: 'POST', path: 'admin/companies/spartan/approve', headers: h, body: {} })).status, 403);
  assert.strictEqual((await api.handle({ method: 'GET', path: 'companies/mine', headers: h })).body.company.status, 'approved');
});

test('one company per account, and web addresses are unique and sensible', async () => {
  const { api, login } = await setup();
  const a = await login('a'), b = await login('b');
  assert.strictEqual((await apply(api, a)).status, 200);
  assert.strictEqual((await apply(api, a, good({ id: 'another' }))).status, 409);
  assert.strictEqual((await apply(api, b)).status, 409, 'taken');
  for (const id of ['admin', 'api', 'x', 'Has Space', '-bad-', 'a'.repeat(40)]) assert.notStrictEqual((await apply(api, b, good({ id }))).status, 200, id);
  assert.deepStrictEqual((await api.handle({ method: 'GET', path: 'companies/check/spartan' })).body, { free: false });
  assert.deepStrictEqual((await api.handle({ method: 'GET', path: 'companies/check/toughmudder' })).body, { free: true });
  assert.deepStrictEqual((await api.handle({ method: 'GET', path: 'companies/check/admin' })).body, { free: false });
});

test('a logo is judged by its bytes: anything but a real PNG, JPEG or WebP under the size limit is refused', async () => {
  const { api, login, puts } = await setup();
  const h = await login('sam');
  const bad = [
    logoLink(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'png'),
    logoLink(Buffer.from('<html><script>alert(1)</script></html>'), 'jpeg'),
    'https://example.com/logo.png',
    'data:text/html;base64,PGh0bWw+',
    logoLink(Buffer.concat([PNG, Buffer.alloc(400e3)])),
  ];
  for (const logo of bad) assert.strictEqual((await apply(api, h, good({ logo }))).status, 400, String(logo).slice(0, 40));
  assert.strictEqual(puts.length, 0);
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20)]);
  const r = await apply(api, h, good({ logo: logoLink(jpg, 'jpeg') }));
  assert.match(r.body.company.logo, /\.jpg$/);
});

test('colours, names and websites are checked; text can\'t carry markup', async () => {
  const { api, login } = await setup();
  const h = await login('sam');
  for (const over of [{ theme: { primary: 'red' } }, { theme: { accent: '#12' } }, { theme: { mode: 'neon' } }, { theme: { primary: 'url(x);' } }, { name: 'x' }, { contact: '' }, { website: 'not a site' }]) {
    assert.strictEqual((await apply(api, h, good(over))).status, 400, JSON.stringify(over));
  }
  const r = await apply(api, h, good({ name: '<b>Spartan</b> Race', logo: undefined }));
  assert.strictEqual(r.body.company.name, 'b Spartan /b Race');
  assert.strictEqual(r.body.company.logo, '');
});

test('the owner changes the brand; the address and status stay, and nobody else can change it', async () => {
  const { api, login, boss } = await setup();
  const h = await login('sam'), other = await login('other');
  await apply(api, h);
  const r = await api.handle({ method: 'PUT', path: 'companies/mine', headers: h, body: { name: 'Spartan', id: 'stolen', status: 'approved', owner: 'x', theme: { primary: '#00ff00' } } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.company.id, 'spartan');
  assert.strictEqual(r.body.company.status, 'approved');
  assert.strictEqual(r.body.company.theme.primary, '#00ff00');
  assert.strictEqual(r.body.company.theme.mode, 'dark', 'other colours stay');
  assert.strictEqual((await api.handle({ method: 'PUT', path: 'companies/mine', headers: other, body: { name: 'Hacked' } })).status, 404);
  const all = await api.handle({ method: 'GET', path: 'admin/companies', headers: boss });
  assert.strictEqual(all.body.companies[0].name, 'Spartan');
  const off = await api.handle({ method: 'PUT', path: 'companies/mine', headers: h, body: { logo: null } });
  assert.strictEqual(off.body.company.logo, '');
});
