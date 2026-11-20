'use strict';
/* A person's own data (from the review of 19 November 2026; the brief's PER-08): a download of everything the learning platform holds
   about someone, and erasing a person. Erasing anonymises the person (their name, address and country go, their sign-in link is
   removed, and they're suspended) but keeps the learning records, now anonymous, so credential history and reports stay consistent.
   The audit log can't be changed by the site's own login; scripts/learn-erase.mjs (with the admin login) removes the address from
   any older audit entries. The draft privacy notice and procedure: docs/learning/privacy-draft.md.

   GET  /api/learn/people/<id>/export           -> { exportedAt, person, logins, roles, enrolments, completions, attempts, credentials, practice, learningDays, badges, audit }
                                                   yourself, or an admin
   POST /api/learn/people/<id>/erase {confirm: 'ERASE'}   admins only; not yourself */
function createPrivacy(ctx) {
  const { db, reply, P, audit, isUuid } = ctx;

  async function exportPerson(w, id) {
    const p = await ctx.personById(id);
    const self = p && p.person_id === w.real?.person_id && !w.actingAs;
    if (!p || !(self || P.can(w.grants, 'person.merge'))) return reply(404, { error: 'No such person, or not one you can export' });
    const q = (sql) => db.query(sql, { p: p.person_id });
    const parse = (rows, keys) => rows.map((r) => { for (const k of keys) if (typeof r[k] === 'string') { try { r[k] = JSON.parse(r[k]); } catch { /* as it is */ } } return r; });
    const out = {
      exportedAt: new Date().toISOString(),
      note: 'Everything the SpartanReferee learning platform holds about this person. The camera site keeps its own account and referee-list entries.',
      person: (await q('SELECT * FROM {S}.person WHERE person_id = @p'))[0],
      logins: (await q('SELECT provider, created_at FROM {S}.person_login WHERE person_id = @p')),
      roles: await q('SELECT role, programme_id, region_id, granted_at FROM {S}.role_grant WHERE person_id = @p'),
      programmeRoles: await q('SELECT * FROM {S}.programme_role WHERE person_id = @p'),
      enrolments: await q('SELECT * FROM {S}.enrolment WHERE person_id = @p'),
      lessonProgress: await q('SELECT * FROM {S}.lesson_progress WHERE person_id = @p'),
      completions: await q('SELECT * FROM {S}.completion WHERE person_id = @p'),
      completionsBeforeRestarts: await q('SELECT * FROM {S}.completion_archive WHERE person_id = @p'),
      lessonTests: await q('SELECT * FROM {S}.lesson_test WHERE person_id = @p'),
      attempts: parse(await q('SELECT * FROM {S}.attempt WHERE person_id = @p'), ['answers']),
      credentials: await q('SELECT * FROM {S}.credential WHERE person_id = @p'),
      practice: await q('SELECT check_key, programme_id, box, answered, right_count, last_right, last_at, due_at FROM {S}.check_state WHERE person_id = @p'),
      learningDays: (await q('SELECT day FROM {S}.learning_day WHERE person_id = @p ORDER BY day')).map((r) => r.day),
      badges: await q('SELECT badge_id, programme_id, earned_at FROM {S}.badge WHERE person_id = @p'),
      audit: parse(await q("SELECT at, action, entity_type, entity_id, summary FROM {S}.audit_event WHERE actor_id = @p OR acting_as = @p OR (entity_type = 'person' AND entity_id = CONVERT(NVARCHAR(64), @p)) ORDER BY audit_id"), ['summary']),
    };
    await audit(db.query, w, 'person.export', 'person', p.person_id, { by: self ? 'themselves' : 'an admin' }, { regionId: p.region_id });
    return reply(200, out);
  }

  async function erasePerson(w, id, b) {
    if (!P.can(w.grants, 'person.merge') || w.actingAs) return reply(403, { error: 'Only an admin, as themselves, erases a person' });
    const p = isUuid(id) && await ctx.personById(id); if (!p) return reply(404, { error: 'No such person' });
    if (p.person_id === w.real.person_id) return reply(400, { error: 'You can\'t erase yourself: ask another admin' });
    if (b?.confirm !== 'ERASE') return reply(400, { error: 'Type ERASE to confirm' });
    if (p.status === 'erased') return reply(409, { error: 'Already erased' });
    await db.tx(async (q) => {
      await q(`UPDATE {S}.person SET legal_name = 'Erased person', preferred_name = NULL, email = CONCAT('erased-', LOWER(CONVERT(NVARCHAR(36), person_id)), '@erased.invalid'),
               country = NULL, status = 'erased', updated_at = SYSUTCDATETIME() WHERE person_id = @p`, { p: p.person_id });
      await q('DELETE FROM {S}.person_login WHERE person_id = @p', { p: p.person_id });
      await q('DELETE FROM {S}.role_grant WHERE person_id = @p', { p: p.person_id });
      await q('DELETE FROM {S}.lesson_progress WHERE person_id = @p', { p: p.person_id });
      // practice, the streak and badges: not part of the learning record
      for (const t of ['check_state', 'learning_day', 'badge']) await q(`DELETE FROM {S}.${t} WHERE person_id = @p`, { p: p.person_id });
      await q("UPDATE {S}.duplicate_flag SET state = 'not_duplicate' WHERE (person_a = @p OR person_b = @p) AND state = 'open'", { p: p.person_id });
      await audit(q, w, 'person.erase', 'person', p.person_id, { publicId: p.public_id }, { regionId: p.region_id });
    });
    return reply(200, { erased: p.public_id, note: 'Anonymised. Run scripts/learn-erase.mjs to remove their address from older audit entries, and remove them from the referee list on the admin page.' });
  }

  async function route(w, method, parts, body) {
    const [, a, b, c] = parts;
    if (a === 'people' && b && c === 'export' && method === 'GET') return exportPerson(w, b);
    if (a === 'people' && b && c === 'erase' && method === 'POST') return erasePerson(w, b, body);
    return null;
  }
  return { route };
}

module.exports = { createPrivacy };
