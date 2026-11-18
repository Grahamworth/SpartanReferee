'use strict';
/* Programmes (step 2): the catalogue, each programme's versions and their states, the curriculum of a version, enrolment, and one
   person's record across every programme (PRG-01..05, PER-03, PER-04, ASM-03). Everything is checked here, on the server.

   GET    /api/learn/programmes                         -> { programmes }   the catalogue: published ones for everyone, drafts for their editors
   POST   /api/learn/programmes {id, title, category, description, locales, learnerRole, edition, qualification}  admins (AT-03)
   GET    /api/learn/programmes/<id>?version=<vid>      -> { programme, versions, version, modules, enrolment, can }
   PUT    /api/learn/programmes/<id> {title, description, category, locales, learnerRole, status}
   POST   /api/learn/programmes/<id>/versions {edition}  a new draft, a copy of the latest version's curriculum and policy
   PUT    /api/learn/versions/<vid> {policy fields, effectiveDate}     drafts only
   POST   /api/learn/versions/<vid>/state {to}          draft -> review -> published (supersedes the last), review -> draft, -> archived
   POST   /api/learn/versions/<vid>/modules {title, summary, sourceSection}   drafts only; PUT|DELETE /api/learn/modules/<id>
   POST   /api/learn/modules/<id>/lessons {title, summary, minutes}           drafts only; PUT|DELETE /api/learn/lessons/<id>
   POST   /api/learn/enrolments {programmeId, personId?} enrol yourself, or (coordinators, owners, admins) someone you look after
   DELETE /api/learn/enrolments/<id>                    withdraw
   GET    /api/learn/people/<id>/record                 -> { enrolments, credentials, attempts }  everything about a person's learning */
const STATES = ['draft', 'review', 'published', 'superseded', 'archived'];
const RULES = ['lessons', 'assessment', 'lessons+assessment'];
const PROGRAMME_ID = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;

function createProgrammes(ctx) {
  const { db, reply, P, audit, uuid, text, isUuid, personById } = ctx;
  const progById = async (id) => (PROGRAMME_ID.test(String(id || '')) ? (await db.query('SELECT * FROM {S}.programme WHERE programme_id = @id', { id }))[0] || null : null);
  const versionById = async (id) => (isUuid(id) ? (await db.query('SELECT * FROM {S}.programme_version WHERE version_id = @id', { id }))[0] || null : null);
  const editor = (w, programmeId) => P.can(w.grants, 'content.draft', { programmeId }) || P.can(w.grants, 'programme.edit', { programmeId });
  const progView = (p) => ({ id: p.programme_id, title: p.title, category: p.category, description: p.description, ownerId: p.owner_id || '', status: p.status,
    locales: String(p.locales || 'en').split(',').filter(Boolean), learnerRole: p.learner_role, demo: !!p.demo, createdAt: p.created_at });
  const versionView = (v) => v && ({ id: v.version_id, programmeId: v.programme_id, edition: v.edition, state: v.state, effectiveDate: v.effective_date,
    completionRule: v.completion_rule, passMark: v.pass_mark, maxAttempts: v.max_attempts, retakeWaitHours: v.retake_wait_hours, validityMonths: v.validity_months,
    renewalDueDays: v.renewal_due_days, qualification: v.qualification, policyNote: v.policy_note, createdAt: v.created_at, submittedAt: v.submitted_at, publishedAt: v.published_at });
  const moduleView = (m) => ({ id: m.module_id, lineageId: m.lineage_id, code: m.code || '', seq: m.seq, title: m.title, summary: m.summary, sourceSection: m.source_section || '', required: !!m.required });
  const lessonView = (l) => ({ id: l.lesson_id, lineageId: l.lineage_id, code: l.code || '', moduleId: l.module_id, seq: l.seq, title: l.title, summary: l.summary, minutes: l.minutes });
  /** the version a learner gets: the published one */
  const currentVersion = async (programmeId) => (await db.query("SELECT TOP 1 * FROM {S}.programme_version WHERE programme_id = @id AND state = 'published' ORDER BY published_at DESC", { id: programmeId }))[0] || null;
  ctx.currentVersion = currentVersion; ctx.versionById = versionById; ctx.progById = progById; ctx.versionView = versionView;
  ctx.lessonView = lessonView; ctx.moduleView = moduleView; ctx.editor = editor;

  // ------------------------------------------------------------------ the catalogue
  async function catalogue(w) {
    const progs = await db.query('SELECT * FROM {S}.programme ORDER BY title');
    const versions = await db.query('SELECT * FROM {S}.programme_version ORDER BY created_at');
    const mine = await db.query("SELECT * FROM {S}.enrolment WHERE person_id = @p AND state <> 'withdrawn'", { p: w.person.person_id });
    const counts = await db.query("SELECT v.programme_id, COUNT(*) AS n FROM {S}.module m JOIN {S}.programme_version v ON v.version_id = m.version_id WHERE v.state = 'published' GROUP BY v.programme_id");
    const out = [];
    for (const p of progs) {
      const canEdit = editor(w, p.programme_id), vs = versions.filter((v) => v.programme_id === p.programme_id);
      const current = vs.filter((v) => v.state === 'published').pop() || null;
      if (!canEdit && (!current || p.status !== 'active')) continue; // learners see what's open to them
      const e = mine.find((x) => x.programme_id === p.programme_id);
      out.push({ ...progView(p), current: versionView(current), drafts: canEdit ? vs.filter((v) => v.state === 'draft' || v.state === 'review').map(versionView) : [],
        modules: counts.find((c) => c.programme_id === p.programme_id)?.n || 0, enrolment: e ? { id: e.enrolment_id, state: e.state, versionId: e.version_id } : null, canEdit });
    }
    return reply(200, { programmes: out, canCreate: P.can(w.grants, 'programme.create') });
  }

  // a programme made from the admin screens, with a first draft version (PRG-01, PRG-02, AT-03): no code change
  async function createProgramme(w, b) {
    if (!P.can(w.grants, 'programme.create')) return reply(403, { error: 'Only admins create programmes' });
    const id = String(b?.id || '').trim().toLowerCase(), title = text(b?.title, 120), category = text(b?.category, 40) || 'other';
    if (!PROGRAMME_ID.test(id)) return reply(400, { error: 'A programme id is 3 to 32 lowercase letters, numbers and dashes, like spartan-kids-marshal' });
    if (title.length < 3) return reply(400, { error: 'What is the programme called?' });
    if (await progById(id)) return reply(409, { error: 'There is already a programme with that id' });
    const locales = [...new Set(String(b?.locales || 'en').split(',').map((s) => s.trim()).filter((l) => ctx.LOCALES.includes(l)))];
    if (!locales.includes('en')) locales.unshift('en');
    const edition = text(b?.edition, 40) || String(new Date().getUTCFullYear() + 1), versionId = uuid();
    await db.tx(async (q) => {
      await q(`INSERT INTO {S}.programme (programme_id, title, category, description, owner_id, locales, learner_role, created_by)
               VALUES (@id, @title, @category, @description, @owner, @locales, @role, @by)`,
      { id, title, category, description: text(b?.description, 1000), owner: w.person.person_id, locales: locales.join(','), role: text(b?.learnerRole, 60) || 'Learner', by: w.person.person_id });
      await q(`INSERT INTO {S}.programme_version (version_id, programme_id, edition, qualification, policy_note, created_by)
               VALUES (@v, @id, @edition, @qual, @note, @by)`,
      { v: versionId, id, edition, qual: text(b?.qualification, 120) || `${title} ${edition}`, note: 'Sample policy: set by the programme owner before use', by: w.person.person_id });
      await audit(q, w, 'programme.create', 'programme', id, { title, category, edition, locales }, { programmeId: id });
    });
    return reply(200, { programme: progView(await progById(id)), versionId });
  }

  async function editProgramme(w, id, b) {
    const p = await progById(id); if (!p) return reply(404, { error: 'No such programme' });
    if (!P.can(w.grants, 'programme.edit', { programmeId: id })) return reply(403, { error: 'Only the programme\'s owner or an admin changes it' });
    const v = {};
    if (b?.title !== undefined) { v.title = text(b.title, 120); if (v.title.length < 3) return reply(400, { error: 'What is the programme called?' }); }
    if (b?.description !== undefined) v.description = text(b.description, 1000);
    if (b?.category !== undefined) v.category = text(b.category, 40) || 'other';
    if (b?.learnerRole !== undefined) v.learner_role = text(b.learnerRole, 60) || 'Learner';
    if (b?.status !== undefined) { if (!['active', 'archived'].includes(b.status)) return reply(400, { error: 'A programme is active or archived' }); v.status = b.status; }
    if (b?.locales !== undefined) { const l = [...new Set(String(b.locales).split(',').map((s) => s.trim()).filter((x) => ctx.LOCALES.includes(x)))]; if (!l.includes('en')) l.unshift('en'); v.locales = l.join(','); }
    const keys = Object.keys(v); if (!keys.length) return reply(200, { programme: progView(p) });
    await db.tx(async (q) => {
      await q(`UPDATE {S}.programme SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE programme_id = @id`, { ...v, id });
      await audit(q, w, 'programme.edit', 'programme', id, { before: Object.fromEntries(keys.map((k) => [k, p[k]])), after: v }, { programmeId: id });
    });
    return reply(200, { programme: progView(await progById(id)) });
  }

  // ------------------------------------------------------------------ one programme, and its curriculum
  async function curriculum(versionId) {
    const modules = await db.query('SELECT * FROM {S}.module WHERE version_id = @v ORDER BY seq', { v: versionId });
    const lessons = await db.query('SELECT * FROM {S}.lesson WHERE version_id = @v ORDER BY seq', { v: versionId });
    return modules.map((m) => ({ ...moduleView(m), lessons: lessons.filter((l) => l.module_id === m.module_id).map(lessonView) }));
  }
  ctx.curriculum = curriculum;
  async function getProgramme(w, id, query) {
    const p = await progById(id); if (!p) return reply(404, { error: 'No such programme' });
    const canEdit = editor(w, id);
    const versions = (await db.query('SELECT * FROM {S}.programme_version WHERE programme_id = @id ORDER BY created_at', { id: p.programme_id }))
      .filter((v) => canEdit || v.state === 'published');
    if (!versions.length) return reply(404, { error: 'No such programme' });
    const asked = query.version && versions.find((v) => v.version_id.toLowerCase() === String(query.version).toLowerCase());
    const e = (await db.query("SELECT TOP 1 * FROM {S}.enrolment WHERE person_id = @p AND programme_id = @id AND state <> 'withdrawn' ORDER BY enrolled_at DESC", { p: w.person.person_id, id }))[0];
    // what you're enrolled on, else the published one, else (editors) the newest
    const v = asked || (e && versions.find((x) => x.version_id === e.version_id)) || versions.filter((x) => x.state === 'published').pop() || versions[versions.length - 1];
    const extra = ctx.programmeExtras ? await ctx.programmeExtras(w, p, v, e) : {};
    return reply(200, {
      programme: progView(p), versions: versions.map(versionView), version: versionView(v), modules: await curriculum(v.version_id),
      enrolment: e ? { id: e.enrolment_id, state: e.state, versionId: e.version_id, enrolledAt: e.enrolled_at, completedAt: e.completed_at } : null,
      can: { edit: canEdit, approve: P.can(w.grants, 'content.approve', { programmeId: id }), programme: P.can(w.grants, 'programme.edit', { programmeId: id }), enrol: !!versions.find((x) => x.state === 'published') && p.status === 'active' },
      ...extra,
    });
  }

  // a new draft version: a copy of the latest version's curriculum and policy (each module and lesson keeps its lineage)
  async function newVersion(w, id, b) {
    const p = await progById(id); if (!p) return reply(404, { error: 'No such programme' });
    if (!P.can(w.grants, 'programme.edit', { programmeId: id })) return reply(403, { error: 'Only the programme\'s owner or an admin starts a new version' });
    const edition = text(b?.edition, 40); if (!edition) return reply(400, { error: 'Which edition? For example 2028' });
    if ((await db.query('SELECT 1 AS x FROM {S}.programme_version WHERE programme_id = @id AND edition = @e', { id, e: edition })).length) return reply(409, { error: 'That edition already exists' });
    const from = (await db.query('SELECT TOP 1 * FROM {S}.programme_version WHERE programme_id = @id ORDER BY created_at DESC', { id }))[0];
    const vid = uuid();
    await db.tx(async (q) => {
      await q(`INSERT INTO {S}.programme_version (version_id, programme_id, edition, completion_rule, pass_mark, max_attempts, retake_wait_hours, validity_months, renewal_due_days, qualification, policy_note, created_by)
               VALUES (@vid, @id, @edition, @rule, @pass, @max, @wait, @valid, @due, @qual, @note, @by)`,
      { vid, id, edition, rule: from?.completion_rule || 'lessons+assessment', pass: from?.pass_mark ?? 80, max: from?.max_attempts ?? null, wait: from?.retake_wait_hours ?? 0, valid: from?.validity_months ?? null,
        due: from?.renewal_due_days ?? 60, qual: from ? from.qualification.replace(from.edition, edition) : `${p.title} ${edition}`, note: from?.policy_note || '', by: w.person.person_id });
      if (from) {
        const mods = await q('SELECT * FROM {S}.module WHERE version_id = @v', { v: from.version_id });
        const lessons = await q('SELECT * FROM {S}.lesson WHERE version_id = @v', { v: from.version_id });
        const map = new Map();
        for (const m of mods) { const nid = uuid(); map.set(m.module_id, nid); await q('INSERT INTO {S}.module (module_id, lineage_id, code, version_id, seq, title, summary, source_section, required) VALUES (@id, @lin, @code, @v, @seq, @t, @s, @src, @req)', { id: nid, lin: m.lineage_id, code: m.code, v: vid, seq: m.seq, t: m.title, s: m.summary, src: m.source_section, req: m.required }); }
        const lessonMap = new Map();
        for (const l of lessons) { const nid = uuid(); lessonMap.set(l.lesson_id, nid); await q('INSERT INTO {S}.lesson (lesson_id, lineage_id, code, module_id, version_id, seq, title, summary, minutes) VALUES (@id, @lin, @code, @m, @v, @seq, @t, @s, @min)', { id: nid, lin: l.lineage_id, code: l.code, m: map.get(l.module_id), v: vid, seq: l.seq, t: l.title, s: l.summary, min: l.minutes }); }
        if (ctx.copyVersionExtras) await ctx.copyVersionExtras(q, from, vid, map, lessonMap);
      }
      await audit(q, w, 'version.create', 'programme_version', vid, { programme: id, edition, copiedFrom: from?.edition || null }, { programmeId: id });
    });
    return reply(200, { version: versionView(await versionById(vid)) });
  }

  async function draftVersion(w, vid, need = 'content.draft') {
    const v = await versionById(vid); if (!v) return { error: reply(404, { error: 'No such version' }) };
    if (!P.can(w.grants, need, { programmeId: v.programme_id }) && !P.can(w.grants, 'programme.edit', { programmeId: v.programme_id })) return { error: reply(403, { error: 'You can\'t change this programme' }) };
    if (v.state !== 'draft') return { error: reply(409, { error: `This version is ${v.state}: only a draft can change. Start a new version instead` }) };
    return { v };
  }
  ctx.draftVersion = draftVersion;
  async function editVersion(w, vid, b) {
    const { v, error } = await draftVersion(w, vid, 'programme.edit'); if (error) return error;
    const out = {};
    const int = (x, lo, hi) => (x === null || x === '' ? null : Number.isInteger(Number(x)) && Number(x) >= lo && Number(x) <= hi ? Number(x) : NaN);
    if (b?.passMark !== undefined) { out.pass_mark = int(b.passMark, 1, 100); if (!Number.isInteger(out.pass_mark)) return reply(400, { error: 'A pass mark is 1 to 100' }); }
    if (b?.maxAttempts !== undefined) { out.max_attempts = int(b.maxAttempts, 1, 50); if (Number.isNaN(out.max_attempts)) return reply(400, { error: 'Attempts is 1 to 50, or empty for unlimited' }); }
    if (b?.retakeWaitHours !== undefined) { out.retake_wait_hours = int(b.retakeWaitHours, 0, 720) ?? 0; if (Number.isNaN(out.retake_wait_hours)) return reply(400, { error: 'The wait is 0 to 720 hours' }); }
    if (b?.validityMonths !== undefined) { out.validity_months = int(b.validityMonths, 1, 120); if (Number.isNaN(out.validity_months)) return reply(400, { error: 'Validity is 1 to 120 months, or empty for no expiry' }); }
    if (b?.renewalDueDays !== undefined) { out.renewal_due_days = int(b.renewalDueDays, 0, 365) ?? 60; if (Number.isNaN(out.renewal_due_days)) return reply(400, { error: 'Renewal notice is 0 to 365 days' }); }
    if (b?.completionRule !== undefined) { if (!RULES.includes(b.completionRule)) return reply(400, { error: 'Completion is lessons, assessment, or both' }); out.completion_rule = b.completionRule; }
    if (b?.qualification !== undefined) { out.qualification = text(b.qualification, 120); if (!out.qualification) return reply(400, { error: 'What does completing it earn?' }); }
    if (b?.policyNote !== undefined) out.policy_note = text(b.policyNote, 400);
    if (b?.effectiveDate !== undefined) { if (b.effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveDate)) return reply(400, { error: 'A date like 2027-01-01' }); out.effective_date = b.effectiveDate || null; }
    const keys = Object.keys(out); if (!keys.length) return reply(200, { version: versionView(v) });
    await db.tx(async (q) => {
      await q(`UPDATE {S}.programme_version SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE version_id = @vid`, { ...out, vid: v.version_id });
      await audit(q, w, 'version.policy', 'programme_version', v.version_id, { before: Object.fromEntries(keys.map((k) => [k, v[k]])), after: out }, { programmeId: v.programme_id });
    });
    return reply(200, { version: versionView(await versionById(v.version_id)) });
  }

  // draft -> review (editors) -> published (approvers, never the person who sent it for review, unless an admin) (PRG-05, CNT-01)
  async function changeState(w, vid, b) {
    const v = await versionById(vid); if (!v) return reply(404, { error: 'No such version' });
    const to = String(b?.to || ''), pid = v.programme_id;
    if (!STATES.includes(to)) return reply(400, { error: 'No such state' });
    const allowed = { draft: ['review', 'archived'], review: ['published', 'draft'], published: ['archived'], superseded: ['archived'], archived: [] }[v.state] || [];
    if (!allowed.includes(to)) return reply(409, { error: `A ${v.state} version can't become ${to}` });
    if (to === 'review' && !editor(w, pid)) return reply(403, { error: 'Only the programme\'s editors send it for review' });
    if ((to === 'published' || (v.state === 'review' && to === 'draft')) && !P.can(w.grants, 'content.approve', { programmeId: pid })) return reply(403, { error: 'Only the programme\'s owner or an admin approves it' });
    if (to === 'published' && v.submitted_by && v.submitted_by === w.person.person_id && !P.can(w.grants, 'programme.create')) return reply(403, { error: 'Someone else must approve what you sent for review' });
    if (to === 'archived' && !P.can(w.grants, 'programme.edit', { programmeId: pid })) return reply(403, { error: 'Only the programme\'s owner or an admin archives it' });
    if (to === 'published' && ctx.beforePublish) { const why = await ctx.beforePublish(v); if (why) return reply(409, { error: why }); }
    await db.tx(async (q) => {
      if (to === 'review') await q('UPDATE {S}.programme_version SET state = @to, submitted_by = @by, submitted_at = SYSUTCDATETIME() WHERE version_id = @vid', { to, by: w.person.person_id, vid });
      else if (to === 'published') {
        // the version learners had becomes superseded; their enrolments stay on it until they re-enrol
        await q("UPDATE {S}.programme_version SET state = 'superseded' WHERE programme_id = @pid AND state = 'published'", { pid });
        await q('UPDATE {S}.programme_version SET state = @to, published_by = @by, published_at = SYSUTCDATETIME(), effective_date = ISNULL(effective_date, CAST(SYSUTCDATETIME() AS DATE)) WHERE version_id = @vid', { to, by: w.person.person_id, vid });
      } else await q('UPDATE {S}.programme_version SET state = @to WHERE version_id = @vid', { to, vid });
      if (to === 'published' && ctx.afterPublish) await ctx.afterPublish(q, v, w);
      await audit(q, w, `version.${to}`, 'programme_version', vid, { programme: pid, edition: v.edition, from: v.state, to }, { programmeId: pid });
    });
    return reply(200, { version: versionView(await versionById(vid)) });
  }

  // ------------------------------------------------------------------ modules and lessons, in a draft
  async function addModule(w, vid, b) {
    const { v, error } = await draftVersion(w, vid); if (error) return error;
    const title = text(b?.title, 160); if (title.length < 2) return reply(400, { error: 'What is the module called?' });
    const id = uuid(), seq = ((await db.query('SELECT MAX(seq) AS n FROM {S}.module WHERE version_id = @v', { v: v.version_id }))[0].n || 0) + 1;
    await db.tx(async (q) => {
      await q('INSERT INTO {S}.module (module_id, lineage_id, version_id, seq, title, summary, source_section) VALUES (@id, @id, @v, @seq, @t, @s, @src)', { id, v: v.version_id, seq, t: title, s: text(b?.summary, 1000), src: text(b?.sourceSection, 80) || null });
      await audit(q, w, 'module.create', 'module', id, { title, version: v.edition }, { programmeId: v.programme_id });
    });
    return reply(200, { modules: await curriculum(v.version_id) });
  }
  async function changeModule(w, id, method, b) {
    const m = isUuid(id) && (await db.query('SELECT * FROM {S}.module WHERE module_id = @id', { id }))[0]; if (!m) return reply(404, { error: 'No such module' });
    const { v, error } = await draftVersion(w, m.version_id); if (error) return error;
    await db.tx(async (q) => {
      if (method === 'DELETE') {
        if (ctx.beforeDeleteLessons) await ctx.beforeDeleteLessons(q, (await q('SELECT lesson_id FROM {S}.lesson WHERE module_id = @id', { id })).map((l) => l.lesson_id));
        await q('DELETE FROM {S}.lesson WHERE module_id = @id', { id }); await q('DELETE FROM {S}.module WHERE module_id = @id', { id });
      } else {
        const t = b?.title !== undefined ? text(b.title, 160) : m.title, s = b?.summary !== undefined ? text(b.summary, 1000) : m.summary, seq = Number.isInteger(b?.seq) ? b.seq : m.seq;
        await q('UPDATE {S}.module SET title = @t, summary = @s, seq = @seq WHERE module_id = @id', { t, s, seq, id });
      }
      await audit(q, w, method === 'DELETE' ? 'module.delete' : 'module.edit', 'module', id, { title: m.title }, { programmeId: v.programme_id });
    });
    return reply(200, { modules: await curriculum(v.version_id) });
  }
  async function addLesson(w, moduleId, b) {
    const m = isUuid(moduleId) && (await db.query('SELECT * FROM {S}.module WHERE module_id = @id', { id: moduleId }))[0]; if (!m) return reply(404, { error: 'No such module' });
    const { v, error } = await draftVersion(w, m.version_id); if (error) return error;
    const title = text(b?.title, 160); if (title.length < 2) return reply(400, { error: 'What is the lesson called?' });
    const minutes = Math.max(1, Math.min(120, Math.round(Number(b?.minutes) || 5)));
    const id = uuid(), seq = ((await db.query('SELECT MAX(seq) AS n FROM {S}.lesson WHERE module_id = @m', { m: m.module_id }))[0].n || 0) + 1;
    await db.tx(async (q) => {
      await q('INSERT INTO {S}.lesson (lesson_id, lineage_id, module_id, version_id, seq, title, summary, minutes) VALUES (@id, @id, @m, @v, @seq, @t, @s, @min)', { id, m: m.module_id, v: v.version_id, seq, t: title, s: text(b?.summary, 1000), min: minutes });
      await audit(q, w, 'lesson.create', 'lesson', id, { title, module: m.title }, { programmeId: v.programme_id });
    });
    return reply(200, { modules: await curriculum(v.version_id), lessonId: id });
  }
  async function changeLesson(w, id, method, b) {
    const l = isUuid(id) && (await db.query('SELECT * FROM {S}.lesson WHERE lesson_id = @id', { id }))[0]; if (!l) return reply(404, { error: 'No such lesson' });
    const { v, error } = await draftVersion(w, l.version_id); if (error) return error;
    await db.tx(async (q) => {
      if (method === 'DELETE') { if (ctx.beforeDeleteLessons) await ctx.beforeDeleteLessons(q, [id]); await q('DELETE FROM {S}.lesson WHERE lesson_id = @id', { id }); }
      else {
        const t = b?.title !== undefined ? text(b.title, 160) : l.title, s = b?.summary !== undefined ? text(b.summary, 1000) : l.summary;
        const min = b?.minutes !== undefined ? Math.max(1, Math.min(120, Math.round(Number(b.minutes) || 5))) : l.minutes, seq = Number.isInteger(b?.seq) ? b.seq : l.seq;
        await q('UPDATE {S}.lesson SET title = @t, summary = @s, minutes = @min, seq = @seq WHERE lesson_id = @id', { t, s, min, seq, id });
      }
      await audit(q, w, method === 'DELETE' ? 'lesson.delete' : 'lesson.edit', 'lesson', id, { title: l.title }, { programmeId: v.programme_id });
    });
    return reply(200, { modules: await curriculum(v.version_id) });
  }

  // ------------------------------------------------------------------ enrolment (PRG-04): one person, any number of programmes
  async function enrol(w, b) {
    const p = await progById(b?.programmeId); if (!p || p.status !== 'active') return reply(404, { error: 'No such programme' });
    const person = b?.personId ? await personById(b.personId) : w.person; if (!person) return reply(404, { error: 'No such person' });
    if (!P.can(w.grants, 'enrol', { programmeId: p.programme_id, regionId: person.region_id || undefined, personId: person.person_id, selfId: w.person.person_id })) return reply(403, { error: 'You can\'t enrol that person' });
    const v = await currentVersion(p.programme_id); if (!v) return reply(409, { error: 'That programme has no published version yet' });
    const had = (await db.query('SELECT * FROM {S}.enrolment WHERE person_id = @p AND version_id = @v', { p: person.person_id, v: v.version_id }))[0];
    if (had && had.state !== 'withdrawn') return reply(409, { error: 'Already enrolled on this version' });
    const id = had ? had.enrolment_id : uuid();
    await db.tx(async (q) => {
      if (had) await q("UPDATE {S}.enrolment SET state = 'active', enrolled_by = @by, enrolled_at = SYSUTCDATETIME() WHERE enrolment_id = @id", { id, by: w.person.person_id });
      else await q('INSERT INTO {S}.enrolment (enrolment_id, person_id, programme_id, version_id, enrolled_by) VALUES (@id, @p, @prog, @v, @by)', { id, p: person.person_id, prog: p.programme_id, v: v.version_id, by: w.person.person_id });
      if (!(await q('SELECT 1 AS x FROM {S}.programme_role WHERE person_id = @p AND programme_id = @prog', { p: person.person_id, prog: p.programme_id })).length) {
        await q('INSERT INTO {S}.programme_role (person_id, programme_id, role, grade) VALUES (@p, @prog, @role, @grade)', { p: person.person_id, prog: p.programme_id, role: p.learner_role, grade: 'Trainee' });
      }
      await audit(q, w, 'enrolment.create', 'enrolment', id, { person: person.public_id, programme: p.programme_id, edition: v.edition }, { programmeId: p.programme_id, regionId: person.region_id });
    });
    return reply(200, { enrolment: { id, programmeId: p.programme_id, versionId: v.version_id, state: 'active' } });
  }
  async function withdraw(w, id) {
    const e = isUuid(id) && (await db.query('SELECT * FROM {S}.enrolment WHERE enrolment_id = @id', { id }))[0]; if (!e) return reply(404, { error: 'No such enrolment' });
    const person = await personById(e.person_id);
    if (!P.can(w.grants, 'enrol', { programmeId: e.programme_id, regionId: person?.region_id || undefined, personId: e.person_id, selfId: w.person.person_id })) return reply(403, { error: 'You can\'t change that enrolment' });
    await db.tx(async (q) => {
      await q("UPDATE {S}.enrolment SET state = 'withdrawn' WHERE enrolment_id = @id", { id });
      await audit(q, w, 'enrolment.withdraw', 'enrolment', id, { person: person?.public_id, programme: e.programme_id }, { programmeId: e.programme_id, regionId: person?.region_id });
    });
    return reply(200, { ok: true });
  }

  // ------------------------------------------------------------------ a person's whole learning record (PER-04)
  async function record(w, personId) {
    const person = await personById(personId);
    if (!person || !P.can(w.grants, 'person.read', { regionId: person.region_id || undefined, personId: person.person_id, selfId: w.person.person_id })) return reply(404, { error: 'No such person, or not one you can see' });
    const rows = await db.query(`SELECT e.*, p.title, p.category, p.learner_role, p.demo, v.edition, v.state AS version_state, v.qualification, v.completion_rule, v.pass_mark,
        r.role AS prog_role, r.grade, r.status AS role_status
      FROM {S}.enrolment e JOIN {S}.programme p ON p.programme_id = e.programme_id JOIN {S}.programme_version v ON v.version_id = e.version_id
      LEFT JOIN {S}.programme_role r ON r.person_id = e.person_id AND r.programme_id = e.programme_id
      WHERE e.person_id = @p ORDER BY e.enrolled_at`, { p: person.person_id });
    const enrolments = [];
    for (const e of rows) {
      const lessons = (await db.query('SELECT COUNT(*) AS n FROM {S}.lesson WHERE version_id = @v', { v: e.version_id }))[0].n;
      enrolments.push({ id: e.enrolment_id, programmeId: e.programme_id, title: e.title, category: e.category, demo: !!e.demo, versionId: e.version_id, edition: e.edition, versionState: e.version_state,
        qualification: e.qualification, completionRule: e.completion_rule, passMark: e.pass_mark, state: e.state, enrolledAt: e.enrolled_at, completedAt: e.completed_at,
        role: e.prog_role || e.learner_role, grade: e.grade || '', roleStatus: e.role_status || 'active', lessons, ...(ctx.progressOf ? await ctx.progressOf(e) : { done: 0 }) });
    }
    const extra = ctx.recordExtras ? await ctx.recordExtras(w, person) : {};
    return reply(200, { person: ctx.personView(person), enrolments, canEnrol: P.can(w.grants, 'enrol', { regionId: person.region_id || undefined, personId: person.person_id, selfId: w.person.person_id }), ...extra });
  }

  async function route(w, method, parts, body, query) {
    const [, a, b, c] = parts;
    if (a === 'programmes' && !b && method === 'GET') return catalogue(w);
    if (a === 'programmes' && !b && method === 'POST') return createProgramme(w, body);
    if (a === 'programmes' && b && !c && method === 'GET') return getProgramme(w, b, query);
    if (a === 'programmes' && b && !c && method === 'PUT') return editProgramme(w, b, body);
    if (a === 'programmes' && b && c === 'versions' && method === 'POST') return newVersion(w, b, body);
    if (a === 'versions' && b && !c && method === 'PUT') return editVersion(w, b, body);
    if (a === 'versions' && b && c === 'state' && method === 'POST') return changeState(w, b, body);
    if (a === 'versions' && b && c === 'modules' && method === 'POST') return addModule(w, b, body);
    if (a === 'modules' && b && !c && (method === 'PUT' || method === 'DELETE')) return changeModule(w, b, method, body);
    if (a === 'modules' && b && c === 'lessons' && method === 'POST') return addLesson(w, b, body);
    if (a === 'lessons' && b && !c && (method === 'PUT' || method === 'DELETE')) return changeLesson(w, b, method, body);
    if (a === 'enrolments' && !b && method === 'POST') return enrol(w, body);
    if (a === 'enrolments' && b && method === 'DELETE') return withdraw(w, b);
    if (a === 'people' && b && c === 'record' && method === 'GET') return record(w, b);
    return null;
  }
  return { route };
}

module.exports = { createProgrammes, PROGRAMME_ID };
