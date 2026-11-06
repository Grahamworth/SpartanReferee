'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { decide, reconcile, HARD_LIMIT_MS, REPORT_LIMIT_MS, STOP_GRACE_MS, START_LIMIT_MS } = require('../src/reconcile');
const { createArm } = require('../src/arm');

const NOW = 1_800_000_000_000;
const d = (o) => decide({ now: NOW, healthy: true, ...o });

test('wanted and not there: made; wanted and turned off: started; not wanted and off: nothing', () => {
  assert.strictEqual(d({ want: { desired: 'on' }, st: { state: 'off' }, power: 'none' }).action, 'create');
  assert.strictEqual(d({ want: { desired: 'on' }, st: { state: 'off' }, power: 'deallocated' }).action, 'start');
  assert.strictEqual(d({ want: { desired: 'off' }, st: { state: 'off' }, power: 'deallocated' }).action, null);
  assert.strictEqual(d({ want: { desired: 'off' }, st: { state: 'off' }, power: 'none' }).action, null);
});

test('a server that answers is on; while it starts it says so', () => {
  const r = d({ want: { desired: 'on', lastReport: NOW }, st: { state: 'starting', startedAt: NOW - 60e3 }, power: 'running' });
  assert.deepStrictEqual([r.action, r.state], [null, 'on']);
  const w = d({ want: { desired: 'on' }, st: { state: 'starting', startedAt: NOW - 60e3 }, power: 'running', healthy: false });
  assert.deepStrictEqual([w.action, w.state], [null, 'starting']);
});

test('Stop: it gets the chance to finish sending recordings, then is turned off', () => {
  const asked = { desired: 'off', stopRequestedAt: NOW - 60e3, lastReport: NOW };
  assert.deepStrictEqual(d({ want: asked, st: { state: 'on', startedAt: NOW - 3600e3 }, power: 'running' }).action, null);
  assert.strictEqual(d({ want: { ...asked, finished: true }, st: { state: 'stopping', startedAt: NOW - 3600e3 }, power: 'running' }).action, 'deallocate');
  assert.strictEqual(d({ want: { ...asked, stopRequestedAt: NOW - STOP_GRACE_MS - 1 }, st: { state: 'stopping', startedAt: NOW - 3600e3 }, power: 'running' }).action, 'deallocate', 'ran out of time');
  assert.strictEqual(d({ want: asked, st: { state: 'stopping', startedAt: NOW - 3600e3 }, power: 'running', healthy: false }).action, 'deallocate', 'not answering');
});

test('the safety net: on too long, silent too long, or never came up: turned off whatever is wanted', () => {
  assert.strictEqual(d({ want: { desired: 'on', lastReport: NOW }, st: { state: 'on', startedAt: NOW - HARD_LIMIT_MS - 1 }, power: 'running' }).offWhy, 'hard-limit');
  assert.strictEqual(d({ want: { desired: 'on', lastReport: NOW - REPORT_LIMIT_MS - 1 }, st: { state: 'on', startedAt: NOW - 3600e3 }, power: 'running' }).offWhy, 'silent');
  assert.strictEqual(d({ want: { desired: 'on' }, st: { state: 'on', startedAt: NOW - REPORT_LIMIT_MS - 1 }, power: 'running' }).offWhy, 'silent');
  const never = d({ want: { desired: 'on' }, st: { state: 'starting', startedAt: NOW - START_LIMIT_MS - 1 }, power: 'running', healthy: false });
  assert.strictEqual(never.offWhy, 'no-start'); assert.ok(never.error);
});

test('anything running that nobody asked for is turned off', () => {
  assert.strictEqual(d({ want: { desired: 'off' }, st: {}, power: 'running' }).action, 'deallocate');
  assert.strictEqual(d({ want: {}, st: {}, power: 'running' }).action, 'deallocate');
});

test('after a failure it doesn\'t keep retrying until they press Start again', () => {
  const st = { state: 'off', error: 'No servers', errorAt: NOW - 60e3 };
  assert.strictEqual(d({ want: { desired: 'on', requestedAt: NOW - 120e3 }, st, power: 'none' }).action, null);
  assert.strictEqual(d({ want: { desired: 'on', requestedAt: NOW - 1e3 }, st, power: 'none' }).action, 'create');
});

function fake(rows, power, opts = {}) {
  const m = new Map(rows.map(([p, k, v]) => [`${p}|${k}`, v]));
  const store = { get: async (p, k) => m.get(`${p}|${k}`) ?? null, put: async (p, k, v) => { m.set(`${p}|${k}`, v); }, list: async (p) => [...m].filter(([k]) => k.startsWith(`${p}|`)).map(([, v]) => v) };
  const calls = [];
  const arm = { power: async () => power.v, create: async (s, seed) => { calls.push(['create', s.vm, seed]); if (opts.fail) throw new Error(opts.fail); power.v = 'starting'; }, start: async (vm) => { calls.push(['start', vm]); if (opts.fail) throw new Error(opts.fail); }, deallocate: async (vm) => { calls.push(['deallocate', vm]); power.v = 'stopping'; } };
  return { store, arm, calls, m };
}
const SERVER = ['server', 'peak', { id: 'peak', vm: 'hj-peak', host: 'h.example', label: 'hj-peak', secret: 's' }];

test('a pass makes the server, passing it its settings, and remembers when it started', async () => {
  const { store, arm, calls } = fake([SERVER, ['serverwant', 'peak', { id: 'peak', desired: 'on', requestedAt: NOW }]], { v: 'none' });
  await reconcile({ store, arm, health: async () => false, seedFor: async (s) => ({ host: s.host }), now: () => NOW });
  assert.deepStrictEqual(calls[0], ['create', 'hj-peak', { host: 'h.example' }]);
  const st = await store.get('serverstate', 'peak');
  assert.strictEqual(st.state, 'starting'); assert.strictEqual(st.startedAt, NOW);
});

test('Azure having no room says so in plain words, and tries again only when asked', async () => {
  const power = { v: 'none' };
  const { store, arm, calls } = fake([SERVER, ['serverwant', 'peak', { id: 'peak', desired: 'on', requestedAt: NOW - 1000 }]], power, { fail: 'POST: 409 AllocationFailed' });
  const pass = (t) => reconcile({ store, arm, health: async () => false, seedFor: async () => ({}), now: () => t });
  await pass(NOW);
  const st = await store.get('serverstate', 'peak');
  assert.strictEqual(st.state, 'off'); assert.match(st.error, /no graphics-card servers free/);
  await pass(NOW + 60e3);
  assert.strictEqual(calls.length, 1, 'no retry by itself');
});

test('hours are counted while it runs, and only then', async () => {
  const power = { v: 'running' };
  const { store, arm } = fake([SERVER, ['serverwant', 'peak', { id: 'peak', desired: 'on', lastReport: NOW + 3e6 }], ['serverstate', 'peak', { id: 'peak', state: 'on', startedAt: NOW - 60e3, checkedAt: NOW - 60e3, minutes: {} }]], power);
  const pass = (t) => reconcile({ store, arm, health: async () => true, seedFor: async () => ({}), now: () => t });
  await pass(NOW); await pass(NOW + 60e3);
  const k = new Date(NOW).toISOString().slice(0, 7);
  assert.strictEqual(Math.round((await store.get('serverstate', 'peak')).minutes[k]), 2);
  power.v = 'deallocated';
  await store.put('serverwant', 'peak', { id: 'peak', desired: 'off' });
  await pass(NOW + 120e3); await pass(NOW + 180e3);
  assert.strictEqual(Math.round((await store.get('serverstate', 'peak')).minutes[k]), 2);
});

test('the safety net marks it not wanted, so it doesn\'t come straight back on', async () => {
  const power = { v: 'running' };
  const { store, arm, calls } = fake([SERVER, ['serverwant', 'peak', { id: 'peak', desired: 'on', lastReport: NOW - REPORT_LIMIT_MS - 1 }], ['serverstate', 'peak', { id: 'peak', state: 'on', startedAt: NOW - 3600e3, checkedAt: NOW - 60e3 }]], power);
  const pass = (t) => reconcile({ store, arm, health: async () => true, seedFor: async () => ({}), now: () => t });
  await pass(NOW);
  assert.deepStrictEqual(calls[0], ['deallocate', 'hj-peak']);
  assert.strictEqual((await store.get('serverwant', 'peak')).desired, 'off');
  power.v = 'deallocated'; await pass(NOW + 60e3);
  assert.strictEqual(calls.length, 1);
  const st = await store.get('serverstate', 'peak');
  assert.strictEqual(st.state, 'off'); assert.strictEqual(st.lastOff.why, 'silent');
});

test('one company\'s trouble doesn\'t stop the others', async () => {
  const power = { v: 'none' };
  const { store, arm, calls } = fake([SERVER, ['serverwant', 'peak', { id: 'peak', desired: 'on', requestedAt: NOW }], ['server', 'b', { id: 'b', vm: 'hj-b', host: 'b' }], ['serverwant', 'b', { id: 'b', desired: 'on', requestedAt: NOW }]], power);
  const real = arm.power; let first = true;
  arm.power = async (vm) => { if (first) { first = false; throw new Error('Azure hiccup'); } return real(vm); };
  const out = await reconcile({ store, arm, health: async () => false, seedFor: async () => ({}), now: () => NOW });
  assert.ok(out[0].failed);
  assert.strictEqual(calls[0][1], 'hj-b');
});

test('a machine nobody asked for is found and turned off, leaving known ones alone', async () => {
  const power = { v: 'running' };
  const { store, arm, calls } = fake([SERVER, ['serverwant', 'peak', { id: 'peak', desired: 'on', lastReport: NOW }], ['serverstate', 'peak', { id: 'peak', state: 'on', startedAt: NOW - 60e3 }]], power);
  arm.listRunning = async () => ['hj-peak', 'hj-stray'];
  await reconcile({ store, arm, health: async () => true, seedFor: async () => ({}), now: () => NOW });
  assert.deepStrictEqual(calls, [['deallocate', 'hj-stray']]);
});

test('Azure: the requests are built as Azure expects, and a power state is read from its answer', async () => {
  const seen = [];
  const answers = { instanceView: { statuses: [{ code: 'ProvisioningState/succeeded' }, { code: 'PowerState/deallocated' }] } };
  const doFetch = async (url, o) => { seen.push({ url, method: o.method, body: o.body && JSON.parse(o.body) }); const body = url.includes('instanceView') ? answers.instanceView : { id: `/id/${url.split('?')[0].split('/').pop()}` }; return { ok: true, status: 200, text: async () => JSON.stringify(body) }; };
  const arm = createArm({ subscription: 'S', group: 'G', region: 'italynorth', image: '/img', subnet: '/subnet', nsg: '/nsg', sshKey: 'ssh-ed25519 AAA', token: async () => 'T', doFetch });
  assert.strictEqual(await arm.power('hj-a'), 'deallocated');
  await arm.create({ id: 'a', vm: 'hj-a', label: 'hj-a' }, { host: 'x' });
  const [pip, nic, vm] = seen.slice(1);
  assert.strictEqual(pip.body.properties.dnsSettings.domainNameLabel, 'hj-a');
  assert.strictEqual(nic.body.properties.networkSecurityGroup.id, '/nsg');
  const p = vm.body.properties;
  assert.strictEqual(p.hardwareProfile.vmSize, 'Standard_NC8as_T4_v3');
  assert.strictEqual(p.storageProfile.imageReference.id, '/img');
  assert.strictEqual(p.osProfile.linuxConfiguration.disablePasswordAuthentication, true);
  assert.strictEqual(p.securityProfile.uefiSettings.secureBootEnabled, false);
  assert.deepStrictEqual(JSON.parse(Buffer.from(p.userData, 'base64').toString()), { host: 'x' });
  assert.ok(vm.url.includes('/resourceGroups/G/'));
  await arm.deallocate('hj-a');
  assert.match(seen.at(-1).url, /virtualMachines\/hj-a\/deallocate/);
  const none = createArm({ subscription: 'S', group: 'G', token: async () => 'T', doFetch: async () => ({ ok: false, status: 404, text: async () => '' }) });
  assert.strictEqual(await none.power('nope'), 'none');
});
