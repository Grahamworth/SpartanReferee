import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
// a plain browser script: run as the page would, handing it somewhere to put its functions
const m = { exports: {} };
new Function('module', fs.readFileSync(new URL('../booking.js', import.meta.url), 'utf8'))(m);
const { quote, timeLeft, money } = m.exports;
const price = { hour: 0.66, camerasPerServer: 2 };

test('two cameras to a server, rounding up', () => {
  for (const [cams, servers] of [[1, 1], [2, 1], [3, 2], [4, 2], [5, 3]]) assert.strictEqual(quote(cams, 1, price).servers, servers, String(cams));
});

test('the cost is servers x hours x the hourly price, and says so', () => {
  const q = quote(3, 4, price);
  assert.strictEqual(q.cost, 5.28);
  assert.strictEqual(q.how, '2 servers × 4 hours × £0.66 an hour');
  assert.strictEqual(quote(1, 1, price).how, '1 server × 1 hour × £0.66 an hour');
});

test('money shows pence, and time left reads naturally', () => {
  assert.strictEqual(money(5.2), '£5.20');
  assert.strictEqual(timeLeft(90 * 60e3), 'in 1 hour 30 minutes');
  assert.strictEqual(timeLeft(2 * 3600e3), 'in 2 hours');
  assert.strictEqual(timeLeft(61e3), 'in 2 minutes');
  assert.strictEqual(timeLeft(30e3), 'in 1 minute');
  assert.strictEqual(timeLeft(-1), 'now');
});
