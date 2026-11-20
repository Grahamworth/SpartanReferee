'use strict';
// New programmes aren't open on the live site yet: the live schema refuses them, and says no in the catalogue so the form doesn't show.
// The dev and test schemas (and the live one with LEARN_NEW_PROGRAMMES=on) keep them.
const test = require('node:test');
const assert = require('node:assert');
const { createProgrammes } = require('../src/learn/programmes');

function areaOn(schema) {
  const queries = [];
  const db = { schema, query: async (sql) => { queries.push(sql); return []; }, tx: async () => { throw new Error('nothing should be written'); } };
  const ctx = { db, reply: (status, body) => ({ status, body }), P: { can: () => true }, audit: async () => {}, uuid: () => 'u', text: (s) => String(s || ''), isUuid: () => true, personById: async () => null };
  return { area: createProgrammes(ctx), queries };
}
const admin = { person: { person_id: 'p1' }, grants: [{ role: 'admin' }] };
const form = { id: 'kids-marshal', title: 'Spartan Kids Course Marshal' };

test('the live site refuses a new programme and hides the form, even for an admin', async () => {
  const before = process.env.LEARN_NEW_PROGRAMMES;
  delete process.env.LEARN_NEW_PROGRAMMES;
  try {
    const { area, queries } = areaOn('learn');
    const made = await area.route(admin, 'POST', ['learn', 'programmes'], form);
    assert.strictEqual(made.status, 403);
    assert.strictEqual(made.body.error, 'New programmes can\'t be created yet');
    assert.strictEqual(queries.length, 0, 'refused before touching the database');
    const list = await area.route(admin, 'GET', ['learn', 'programmes']);
    assert.strictEqual(list.body.canCreate, false);
  } finally { if (before === undefined) delete process.env.LEARN_NEW_PROGRAMMES; else process.env.LEARN_NEW_PROGRAMMES = before; }
});

test('the dev and test schemas, and the live one when switched on, still offer it', async () => {
  const before = process.env.LEARN_NEW_PROGRAMMES;
  try {
    delete process.env.LEARN_NEW_PROGRAMMES;
    assert.strictEqual((await areaOn('learn_dev').area.route(admin, 'GET', ['learn', 'programmes'])).body.canCreate, true);
    process.env.LEARN_NEW_PROGRAMMES = 'on';
    assert.strictEqual((await areaOn('learn').area.route(admin, 'GET', ['learn', 'programmes'])).body.canCreate, true);
  } finally { if (before === undefined) delete process.env.LEARN_NEW_PROGRAMMES; else process.env.LEARN_NEW_PROGRAMMES = before; }
});
