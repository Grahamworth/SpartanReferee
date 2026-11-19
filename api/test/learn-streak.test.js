'use strict';
// The weekly learning streak (checks.js): weeks run Monday to Sunday, and this week only breaks the run once it's over.
const test = require('node:test');
const assert = require('node:assert');
const { streakFrom, weekOf } = require('../src/learn/checks');

const NOW = Date.UTC(2026, 10, 19, 12); // Thursday 19 November 2026
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

test('weeks start on Monday', () => {
  assert.strictEqual(weekOf(day(2026, 11, 16)), weekOf(day(2026, 11, 22)), 'Monday to Sunday is one week');
  assert.strictEqual(weekOf(day(2026, 11, 23)), weekOf(day(2026, 11, 22)) + 1, 'the next Monday starts the next');
});
test('weeks in a row, counting this week if it has learning, or up to last week if not yet', () => {
  const s = streakFrom([day(2026, 11, 2), day(2026, 11, 10), day(2026, 11, 12), day(2026, 11, 18)], NOW);
  assert.deepStrictEqual([s.weeks, s.thisWeek, s.best], [3, true, 3]);
  assert.deepStrictEqual(s.recent, [false, false, false, false, false, true, true, true]);
  const notYet = streakFrom([day(2026, 11, 2), day(2026, 11, 10)], NOW);
  assert.deepStrictEqual([notYet.weeks, notYet.thisWeek], [2, false], 'this week can still keep it going');
  const broken = streakFrom([day(2026, 10, 1), day(2026, 10, 8), day(2026, 10, 15), day(2026, 10, 22), day(2026, 11, 10)], NOW);
  assert.deepStrictEqual([broken.weeks, broken.best], [1, 4], 'a gap ends the run; the best is kept');
  assert.deepStrictEqual(streakFrom([], NOW).weeks, 0);
});
