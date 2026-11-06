import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const auth = require('../server/auth.js');
const { createSleep } = require('../server/idle.js');
const { mediamtxYaml } = require('../server/mediamtx.js');
const { spartansLink } = require('../server/network.js');

const SECRET = 'a-long-test-secret-a-long-test-secret';
const NOW = 1_800_000_000_000;
const reqWith = (cookie) => ({ headers: { cookie } });

test('a login link gives a cookie that opens the server', () => {
  const link = auth.sign(SECRET, { kind: 'login', who: 'sam', exp: NOW + 60000 });
  const s = auth.login(SECRET, link, NOW);
  assert.match(s.cookie, /HttpOnly/); assert.match(s.cookie, /Secure/); assert.match(s.cookie, /SameSite=Lax/);
  const value = s.cookie.split(';')[0];
  assert.strictEqual(auth.session(SECRET, reqWith(`other=1; ${value}`), NOW).who, 'sam');
});

test('an old, forged or wrong kind of link is refused, and so is using a session as a link', () => {
  assert.strictEqual(auth.login(SECRET, auth.sign(SECRET, { kind: 'login', who: 'x', exp: NOW - 1 }), NOW), null, 'expired');
  assert.strictEqual(auth.login(SECRET, auth.sign('another-secret', { kind: 'login', who: 'x', exp: NOW + 60000 }), NOW), null, 'other server');
  assert.strictEqual(auth.login(SECRET, auth.sign(SECRET, { kind: 'session', who: 'x', exp: NOW + 60000 }), NOW), null, 'session as link');
  const good = auth.sign(SECRET, { kind: 'login', who: 'x', exp: NOW + 60000 }).split('.');
  const tampered = `${Buffer.from(JSON.stringify({ kind: 'login', who: 'admin', exp: NOW + 60000 })).toString('base64url')}.${good[1]}`;
  assert.strictEqual(auth.login(SECRET, tampered, NOW), null, 'tampered');
  for (const bad of ['', 'x', 'a.b.c', null]) assert.strictEqual(auth.login(SECRET, bad, NOW), null, String(bad));
  assert.strictEqual(auth.login('', good.join('.'), NOW), null, 'no secret');
});

test('a login link can\'t be used as a session cookie, and an expired session stops working', () => {
  const link = auth.sign(SECRET, { kind: 'login', who: 'x', exp: NOW + 60000 });
  assert.strictEqual(auth.session(SECRET, reqWith(`${auth.COOKIE}=${link}`), NOW), null);
  const s = auth.sign(SECRET, { kind: 'session', who: 'x', exp: NOW + 1000 });
  assert.ok(auth.session(SECRET, reqWith(`${auth.COOKIE}=${s}`), NOW));
  assert.strictEqual(auth.session(SECRET, reqWith(`${auth.COOKIE}=${s}`), NOW + 2000), null);
  assert.strictEqual(auth.session(SECRET, reqWith(''), NOW), null);
});

function sleeper({ busy = () => false, ...o } = {}) {
  let t = NOW; const told = [], order = [];
  const s = createSleep({ idleMinutes: 30, hardHours: 16, busy, flush: async () => { order.push('flush'); }, tell: async (w) => { told.push(w); if (w === 'finished') order.push('told'); return o.reply ?? null; }, now: () => t });
  return { s, told, order, pass: (ms) => { t += ms; } };
}

test('a quiet server asks to be turned off after the idle time, once the recordings have been dealt with', async () => {
  const { s, told, order, pass } = sleeper();
  pass(29 * 60000); await s.tick();
  assert.deepStrictEqual(told, ['alive']);
  pass(2 * 60000); await s.tick();
  assert.deepStrictEqual(order, ['flush', 'told']);
  assert.ok(s.status().leaving);
  await s.tick();
  assert.strictEqual(told.filter((x) => x === 'finished').length, 1, 'only once');
});

test('a live camera or a person using the page keeps it on', async () => {
  let cameraLive = true;
  const { s, told, pass } = sleeper({ busy: () => cameraLive });
  for (let i = 0; i < 10; i++) { pass(10 * 60000); await s.tick(); }
  assert.ok(!told.includes('finished'));
  cameraLive = false;
  pass(20 * 60000); s.seen(); pass(20 * 60000); await s.tick();
  assert.ok(!told.includes('finished'), 'someone used the page 20 minutes ago');
  pass(11 * 60000); await s.tick();
  assert.ok(told.includes('finished'));
});

test('the hard limit stops even a server with a camera left streaming', async () => {
  const { s, told, pass } = sleeper({ busy: () => true });
  pass(15 * 3600e3); await s.tick(); assert.ok(!told.includes('finished'));
  pass(3600e3); await s.tick(); assert.ok(told.includes('finished'));
});

test('Stop pressed on the site reaches the server when it checks in', async () => {
  const { s, order } = sleeper({ busy: () => true, reply: { stop: true } });
  await s.tick();
  assert.deepStrictEqual(order, ['flush', 'told']);
});

test('finishing up failing still tells the site, so it can\'t be left running', async () => {
  const told = [];
  const s = createSleep({ idleMinutes: 1, hardHours: 1, busy: () => false, flush: async () => { throw new Error('disk'); }, tell: async (w) => { told.push(w); return null; }, now: () => NOW });
  await s.leave('test');
  assert.deepStrictEqual(told, ['finished']);
});

test('only this machine can watch a stream directly; phones need the password', () => {
  const y = mediamtxYaml({ apiPort: 1, playbackPort: 2, rtmpPort: 1935, srtPort: 8890, webrtcPort: 8889, iceUdpPort: 8189, password: 'pw', record: true, keepDays: 14 }, { recordDir: '/data', publicHost: '1.2.3.4' });
  assert.match(y, /webrtcAddress: 127\.0\.0\.1:8889/);
  assert.match(y, /apiAddress: 127\.0\.0\.1:1/);
  assert.match(y, /playbackAddress: 127\.0\.0\.1:2/);
  assert.match(y, /webrtcAdditionalHosts: \[1\.2\.3\.4, 127\.0\.0\.1\]/);
  const anyone = y.split('- user: any')[1];
  assert.match(anyone, /ips: \['127\.0\.0\.1', '::1'\]/);
  assert.ok(!/action: publish/.test(anyone), 'nobody publishes without the password');
  assert.strictEqual((y.match(/- user:/g) || []).length, 2);
  assert.match(y, /- user: larix\n\s+pass: pw/);
});

test('a phone is given the server by name, with no Tailscale route', () => {
  const u = new URL(spartansLink({ lan: ['hj-peak.italynorth.cloudapp.azure.com'], lanNames: ['internet'], tailscale: null }, 2, { rtmpPort: 1935, password: 'pw' }));
  assert.strictEqual(u.searchParams.get('lan'), 'hj-peak.italynorth.cloudapp.azure.com');
  assert.strictEqual(u.searchParams.get('ts'), null);
  assert.strictEqual(u.searchParams.get('n'), '2');
  assert.strictEqual(u.searchParams.get('pass'), 'pw');
});
