'use strict';
// Who may do what in the learning platform (src/learn/permissions.js): the design's permissions matrix.
const test = require('node:test');
const assert = require('node:assert');
const { can, editableFields, regionsVisible, SELF_FIELDS, ADMIN_FIELDS } = require('../src/learn/permissions');

const admin = [{ role: 'global_admin' }];
const europe = [{ role: 'regional_coordinator', region_id: 'europe' }];
const ocrOwner = [{ role: 'programme_owner', programme_id: 'ocr-referee' }];
const editor = [{ role: 'content_editor', programme_id: 'ocr-referee' }];
const tech = [{ role: 'technical_admin' }];
const learner = [];

test('a learner sees and partly edits only their own profile', () => {
  assert.ok(can(learner, 'person.read', { personId: 'a', selfId: 'a', regionId: 'europe' }));
  assert.ok(!can(learner, 'person.read', { personId: 'b', selfId: 'a', regionId: 'europe' }));
  assert.ok(!can(learner, 'person.list'));
  assert.deepStrictEqual(editableFields(learner, { personId: 'a', selfId: 'a', regionId: 'europe' }), SELF_FIELDS);
  assert.deepStrictEqual(editableFields(learner, { personId: 'b', selfId: 'a', regionId: 'europe' }), []);
});

test('a regional coordinator works only in their region (AT-09)', () => {
  assert.ok(can(europe, 'person.read', { personId: 'b', selfId: 'a', regionId: 'europe' }));
  assert.ok(!can(europe, 'person.read', { personId: 'b', selfId: 'a', regionId: 'mea' }));
  assert.ok(can(europe, 'person.create', { regionId: 'europe' }));
  assert.ok(!can(europe, 'person.create', { regionId: 'mea' }));
  assert.ok(!can(europe, 'person.create', {}), 'no region: refused');
  assert.deepStrictEqual(regionsVisible(europe), ['europe']);
  assert.deepStrictEqual(editableFields(europe, { personId: 'b', selfId: 'a', regionId: 'europe' }), ADMIN_FIELDS);
  assert.deepStrictEqual(editableFields(europe, { personId: 'b', selfId: 'a', regionId: 'mea' }), []);
  assert.ok(!can(europe, 'role.grant')); assert.ok(!can(europe, 'audit.read')); assert.ok(!can(europe, 'view-as'));
});

test('a programme owner approves their own programme only; an editor drafts but never approves', () => {
  assert.ok(can(ocrOwner, 'content.approve', { programmeId: 'ocr-referee' }));
  assert.ok(!can(ocrOwner, 'content.approve', { programmeId: 'deka-judge' }));
  assert.ok(can(editor, 'content.draft', { programmeId: 'ocr-referee' }));
  assert.ok(!can(editor, 'content.approve', { programmeId: 'ocr-referee' }));
  assert.ok(can(ocrOwner, 'audit.read', { programmeId: 'ocr-referee' }));
});

test('a technical admin sees no profiles; a global admin does everything', () => {
  assert.ok(!can(tech, 'person.read', { personId: 'b', selfId: 'a', regionId: 'europe' }));
  assert.ok(!can(tech, 'person.list'));
  for (const a of ['person.list', 'person.merge', 'role.grant', 'audit.read', 'view-as', 'programme.create']) assert.ok(can(admin, a), a);
  assert.strictEqual(regionsVisible(admin), 'all');
  assert.ok(!can(admin, 'no.such.action'));
});
