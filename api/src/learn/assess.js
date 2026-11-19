'use strict';
/* Assessment and credentials (step 4): each programme version's question bank, attempts against its pass policy, assessors'
   decisions, and demonstration credentials (ASM-01..05, AT-04, AT-08, AT-09, AT-10).

   POST /api/learn/versions/<vid>/assessments {title, description}    drafts only (editors)
   GET  /api/learn/assessments/<id>                 -> { assessment, questions (editors), policy, attempts, can }
   POST /api/learn/assessments/<id>/questions {type, prompt, options, feedback, rules, clip, needsAssessor}   drafts only
   DELETE /api/learn/questions/<id>                 drafts only
   POST /api/learn/assessments/<id>/attempts        -> { attempt }  starts one: the questions, without their answers
   GET  /api/learn/attempts/<id>                    -> { attempt }  yours (after submitting: feedback), or one you assess
   POST /api/learn/attempts/<id>/submit {answers}   -> { attempt, credential }  once only
   GET  /api/learn/assessing                        -> { attempts }  assessors: answers waiting for a decision
   POST /api/learn/attempts/<id>/decide {decisions: {questionId: true|false}, note}   assessors
   GET  /api/learn/credentials/<id>                 -> { credential }  POST /api/learn/credentials/<id>/status {status, reason}
   Scoring: a single-choice question is right when the right option is chosen; a multiple-choice one when exactly the right ones
   are; a video judgement as either, and when it needs an assessor, they confirm it with the learner's reasons. */
const TYPES = ['single', 'multiple', 'video'];

function createAssess(ctx) {
  const { db, reply, P, audit, uuid, text, isUuid } = ctx;
  const assessmentById = async (id) => (isUuid(id) ? (await db.query('SELECT a.*, v.programme_id, v.state AS version_state, v.edition, v.pass_mark, v.max_attempts, v.retake_wait_hours, v.completion_rule FROM {S}.assessment a JOIN {S}.programme_version v ON v.version_id = a.version_id WHERE a.assessment_id = @id', { id }))[0] || null : null);
  const questionsOf = async (aid) => db.query('SELECT * FROM {S}.question WHERE assessment_id = @a ORDER BY seq', { a: aid });
  const qView = (q, withAnswers) => ({ id: q.question_id, lineageId: q.lineage_id, versionNo: q.version_no, seq: q.seq, type: q.type, prompt: q.prompt,
    options: JSON.parse(q.options).map((o) => ({ id: o.id, text: o.text, ...(withAnswers ? { correct: !!o.correct } : {}) })),
    clip: q.clip ? JSON.parse(q.clip) : null, rules: q.rules ? q.rules.split(',').filter(Boolean) : [], reviewNote: q.review_note || '', needsAssessor: !!q.needs_assessor,
    ...(withAnswers ? { feedback: q.feedback } : {}) });
  const attemptById = async (id) => (isUuid(id) ? (await db.query('SELECT t.*, a.title AS assessment_title, p.title AS programme_title, r.legal_name, r.public_id, r.region_id FROM {S}.attempt t JOIN {S}.assessment a ON a.assessment_id = t.assessment_id JOIN {S}.programme p ON p.programme_id = t.programme_id JOIN {S}.person r ON r.person_id = t.person_id WHERE t.attempt_id = @id', { id }))[0] || null : null);
  const credView = (c, due = 60) => {
    if (!c) return null;
    const now = Date.now(), exp = c.expires_at ? new Date(c.expires_at).getTime() : 0;
    const status = c.status !== 'active' ? c.status : exp && exp < now ? 'expired' : exp && exp - now < (c.renewal_due_days ?? due) * 864e5 ? 'due' : 'active';
    return { id: c.credential_id, publicId: c.public_id, personId: c.person_id, programmeId: c.programme_id, versionId: c.version_id, qualification: c.qualification,
      issuedAt: c.issued_at, expiresAt: c.expires_at, status, storedStatus: c.status, reason: c.status_reason || '', demonstration: !!c.demonstration, attemptId: c.attempt_id || '',
      edition: c.edition || '', programmeTitle: c.programme_title || '', personName: c.legal_name || '', personPublicId: c.person_public_id || '' };
  };
  const credQuery = `SELECT c.*, v.renewal_due_days, v.edition, p.title AS programme_title, r.legal_name, r.public_id AS person_public_id, r.region_id
    FROM {S}.credential c JOIN {S}.programme_version v ON v.version_id = c.version_id JOIN {S}.programme p ON p.programme_id = c.programme_id JOIN {S}.person r ON r.person_id = c.person_id`;
  ctx.credView = credView; ctx.credQuery = credQuery;

  // ------------------------------------------------------------------ hooks into the other areas
  /** has this enrolment passed an assessment of its version? */
  ctx.assessmentPassed = async (q, e) => {
    // every assessment of the version, each passed at least once
    const all = await q('SELECT assessment_id FROM {S}.assessment WHERE version_id = @v', { v: e.version_id });
    const passed = new Set((await q("SELECT DISTINCT assessment_id FROM {S}.attempt WHERE enrolment_id = @e AND result = 'pass'", { e: e.enrolment_id })).map((r) => String(r.assessment_id).toLowerCase()));
    return all.length > 0 && all.every((a) => passed.has(String(a.assessment_id).toLowerCase()));
  };
  /** completing a programme earns its credential: a DEMONSTRATION one, expiring by the version's policy; it supersedes earlier ones */
  ctx.onComplete = async (q, e, w) => {
    if ((await q('SELECT 1 AS x FROM {S}.credential WHERE enrolment_id = @e', { e: e.enrolment_id })).length) return; // issued for this enrolment already
    const blocked = (await q("SELECT TOP 1 public_id, status FROM {S}.credential WHERE person_id = @p AND programme_id = @prog AND status IN ('suspended', 'revoked')", { p: e.person_id, prog: e.programme_id }))[0];
    if (blocked) { await audit(q, w, 'credential.withheld', 'enrolment', e.enrolment_id, { reason: `${blocked.public_id} is ${blocked.status}` }, { programmeId: e.programme_id }); return; }
    const v = (await q('SELECT * FROM {S}.programme_version WHERE version_id = @v', { v: e.version_id }))[0];
    const attempt = (await q("SELECT TOP 1 attempt_id FROM {S}.attempt WHERE enrolment_id = @e AND result = 'pass' ORDER BY submitted_at DESC", { e: e.enrolment_id }))[0];
    const n = (await q('SELECT NEXT VALUE FOR {S}.credential_seq AS n'))[0].n, id = uuid();
    const code = e.programme_id.split('-')[0].toUpperCase().slice(0, 6), publicId = `DEMO-${code}-${String(n).padStart(6, '0')}`;
    await q("UPDATE {S}.credential SET status = 'superseded', status_reason = 'A newer credential was issued', updated_at = SYSUTCDATETIME() WHERE person_id = @p AND programme_id = @prog AND status = 'active'", { p: e.person_id, prog: e.programme_id });
    await q(`INSERT INTO {S}.credential (credential_id, public_id, person_id, programme_id, version_id, enrolment_id, attempt_id, qualification, expires_at, issued_by)
             VALUES (@id, @pub, @p, @prog, @v, @e, @a, @qual, ${v.validity_months ? 'DATEADD(month, @months, SYSUTCDATETIME())' : 'NULL'}, @by)`,
    { id, pub: publicId, p: e.person_id, prog: e.programme_id, v: e.version_id, e: e.enrolment_id, a: attempt?.attempt_id || null, qual: v.qualification, months: v.validity_months, by: w?.person?.person_id || null });
    await audit(q, w, 'credential.issue', 'credential', id, { publicId, qualification: v.qualification, validityMonths: v.validity_months, demonstration: true }, { programmeId: e.programme_id });
  };
  const prevProgress = ctx.progressOf;
  ctx.progressOf = async (e) => {
    const base = prevProgress ? await prevProgress(e) : {};
    const c = (await db.query(`${credQuery} WHERE c.person_id = @p AND c.programme_id = @prog ORDER BY c.issued_at DESC`, { p: e.person_id, prog: e.programme_id }))[0];
    const best = (await db.query("SELECT MAX(CASE WHEN max_score > 0 THEN 100 * score / max_score END) AS best, COUNT(*) AS n FROM {S}.attempt WHERE enrolment_id = @e AND result <> 'open'", { e: e.enrolment_id }))[0];
    return { ...base, credential: credView(c), attemptText: best.n ? `best ${best.best}% in ${best.n} attempt${best.n === 1 ? '' : 's'}` : '' };
  };
  const prevExtras = ctx.programmeExtras;
  ctx.programmeExtras = async (w, p, v, e) => {
    const base = prevExtras ? await prevExtras(w, p, v, e) : {};
    const list = await db.query('SELECT a.*, (SELECT COUNT(*) FROM {S}.question q WHERE q.assessment_id = a.assessment_id) AS questions FROM {S}.assessment a WHERE a.version_id = @v ORDER BY a.created_at', { v: v.version_id });
    const mine = e ? await db.query('SELECT * FROM {S}.attempt WHERE enrolment_id = @e ORDER BY started_at', { e: e.enrolment_id }) : [];
    const cred = e ? (await db.query(`${credQuery} WHERE c.person_id = @p AND c.programme_id = @prog ORDER BY c.issued_at DESC`, { p: w.person.person_id, prog: p.programme_id }))[0] : null;
    return { ...base, assessments: list.map((a) => ({ id: a.assessment_id, title: a.title, description: a.description, questions: a.questions,
      attempts: mine.filter((t) => t.assessment_id === a.assessment_id).map((t) => ({ id: t.attempt_id, result: t.result, percent: t.max_score ? Math.round((100 * t.score) / t.max_score) : null, submittedAt: t.submitted_at })) })),
    credential: credView(cred) };
  };
  const prevRecord = ctx.recordExtras;
  ctx.recordExtras = async (w, person) => {
    const base = prevRecord ? await prevRecord(w, person) : {};
    const creds = await db.query(`${credQuery} WHERE c.person_id = @p ORDER BY c.issued_at DESC`, { p: person.person_id });
    const attempts = await db.query('SELECT t.*, a.title FROM {S}.attempt t JOIN {S}.assessment a ON a.assessment_id = t.assessment_id WHERE t.person_id = @p ORDER BY t.started_at DESC', { p: person.person_id });
    return { ...base, credentials: creds.map((c) => credView(c)), attempts: attempts.map((t) => ({ id: t.attempt_id, title: t.title, programmeId: t.programme_id, result: t.result, percent: t.max_score ? Math.round((100 * t.score) / t.max_score) : null, submittedAt: t.submitted_at })),
      canChangeCredentials: P.can(w.grants, 'credential.change') || w.grants.some((g) => g.role === 'programme_owner') };
  };
  const prevCopy = ctx.copyVersionExtras;
  ctx.copyVersionExtras = async (q, from, vid, moduleMap, lessonMap) => {
    if (prevCopy) await prevCopy(q, from, vid, moduleMap, lessonMap);
    for (const a of await q('SELECT * FROM {S}.assessment WHERE version_id = @v', { v: from.version_id })) {
      const nid = uuid();
      await q('INSERT INTO {S}.assessment (assessment_id, lineage_id, version_id, title, description, created_by) VALUES (@id, @lin, @v, @t, @d, @by)', { id: nid, lin: a.lineage_id, v: vid, t: a.title, d: a.description, by: a.created_by });
      for (const qu of await q('SELECT * FROM {S}.question WHERE assessment_id = @a', { a: a.assessment_id })) {
        await q(`INSERT INTO {S}.question (question_id, lineage_id, assessment_id, version_no, seq, type, prompt, options, feedback, clip, rules, review_note, needs_assessor)
                 VALUES (@id, @lin, @a, @no, @seq, @type, @prompt, @opt, @fb, @clip, @rules, @rn, @na)`,
        { id: uuid(), lin: qu.lineage_id, a: nid, no: qu.version_no, seq: qu.seq, type: qu.type, prompt: qu.prompt, opt: qu.options, fb: qu.feedback, clip: qu.clip, rules: qu.rules, rn: qu.review_note, na: qu.needs_assessor });
      }
    }
  };

  // ------------------------------------------------------------------ the question bank, in a draft version
  async function addAssessment(w, vid, b) {
    const { v, error } = await ctx.draftVersion(w, vid); if (error) return error;
    const title = text(b?.title, 160); if (title.length < 2) return reply(400, { error: 'What is the assessment called?' });
    const id = uuid();
    await db.tx(async (q) => {
      await q('INSERT INTO {S}.assessment (assessment_id, lineage_id, version_id, title, description, created_by) VALUES (@id, @id, @v, @t, @d, @by)', { id, v: v.version_id, t: title, d: text(b?.description, 1000), by: w.person.person_id });
      await audit(q, w, 'assessment.create', 'assessment', id, { title, version: v.edition }, { programmeId: v.programme_id });
    });
    return reply(200, { assessment: { id, title } });
  }
  function readQuestion(b) {
    const type = String(b?.type || 'single'); if (!TYPES.includes(type)) return { error: 'A question is single choice, multiple choice or a video judgement' };
    const prompt = text(b?.prompt, 1000); if (prompt.length < 5) return { error: 'What is the question?' };
    const options = (Array.isArray(b?.options) ? b.options : []).map((o, i) => ({ id: String.fromCharCode(97 + i), text: text(o?.text, 300), correct: !!o?.correct })).filter((o) => o.text);
    if (options.length < 2 || options.length > 8) return { error: 'Give 2 to 8 answers' };
    const right = options.filter((o) => o.correct).length;
    if (!right) return { error: 'Mark the right answer' };
    if (type !== 'multiple' && right !== 1) return { error: 'A single-choice question has exactly one right answer' };
    const clip = type === 'video' ? { anim: 'burpee', variant: ['good', 'noJump', 'shallow', 'noExtension'].includes(b?.clip?.variant) ? b.clip.variant : 'good' } : null;
    const rules = [...new Set((Array.isArray(b?.rules) ? b.rules : String(b?.rules || '').split(',')).map((r) => text(r, 60)).filter(Boolean))].slice(0, 10).join(',');
    return { type, prompt, options, clip, rules, feedback: text(b?.feedback, 1000), needsAssessor: type === 'video' && !!b?.needsAssessor };
  }
  async function addQuestion(w, aid, b) {
    const a = await assessmentById(aid); if (!a) return reply(404, { error: 'No such assessment' });
    const { error } = await ctx.draftVersion(w, a.version_id); if (error) return error;
    const qn = readQuestion(b); if (qn.error) return reply(400, { error: qn.error });
    const id = uuid(), seq = ((await db.query('SELECT MAX(seq) AS n FROM {S}.question WHERE assessment_id = @a', { a: a.assessment_id }))[0].n || 0) + 1;
    await db.tx(async (q) => {
      await q(`INSERT INTO {S}.question (question_id, lineage_id, assessment_id, seq, type, prompt, options, feedback, clip, rules, needs_assessor)
               VALUES (@id, @id, @a, @seq, @type, @prompt, @opt, @fb, @clip, @rules, @na)`,
      { id, a: a.assessment_id, seq, type: qn.type, prompt: qn.prompt, opt: JSON.stringify(qn.options), fb: qn.feedback, clip: qn.clip ? JSON.stringify(qn.clip) : null, rules: qn.rules, na: qn.needsAssessor ? 1 : 0 });
      await audit(q, w, 'question.create', 'question', id, { assessment: a.title, type: qn.type, rules: qn.rules }, { programmeId: a.programme_id });
    });
    return getAssessment(w, a.assessment_id);
  }
  async function deleteQuestion(w, id) {
    const qu = isUuid(id) && (await db.query('SELECT * FROM {S}.question WHERE question_id = @id', { id }))[0]; if (!qu) return reply(404, { error: 'No such question' });
    const a = await assessmentById(qu.assessment_id);
    const { error } = await ctx.draftVersion(w, a.version_id); if (error) return error;
    await db.tx(async (q) => { await q('DELETE FROM {S}.question WHERE question_id = @id', { id }); await audit(q, w, 'question.delete', 'question', id, { prompt: qu.prompt.slice(0, 80) }, { programmeId: a.programme_id }); });
    return getAssessment(w, a.assessment_id);
  }

  // ------------------------------------------------------------------ taking an assessment
  /** can this person start an attempt now? { ok, why, waitUntil } by the version's policy (ASM-03) */
  async function mayAttempt(a, e) {
    if (!e || e.state === 'withdrawn') return { ok: false, why: 'Enrol in the programme to take its assessment' };
    if (!['published', 'superseded'].includes(a.version_state)) return { ok: false, why: 'The assessment opens once the programme is published' };
    const tries = await db.query("SELECT * FROM {S}.attempt WHERE enrolment_id = @e AND assessment_id = @a ORDER BY started_at", { e: e.enrolment_id, a: a.assessment_id });
    if (tries.some((t) => t.result === 'pass')) return { ok: false, why: 'You\'ve passed it already', passed: true };
    if (tries.some((t) => t.result === 'pending')) return { ok: false, why: 'An assessor is checking your last attempt' };
    const open = tries.find((t) => t.result === 'open'); if (open) return { ok: true, resume: open.attempt_id };
    // lessons first, where the programme needs both
    if (a.completion_rule === 'lessons+assessment') {
      const countable = await ctx.countableLessons(a.version_id);
      const done = new Set((await db.query('SELECT DISTINCT lesson_id FROM {S}.completion WHERE enrolment_id = @e AND preview = 0', { e: e.enrolment_id })).map((r) => r.lesson_id));
      const left = countable.filter((id) => !done.has(id)).length;
      if (left) return { ok: false, why: `Complete the ${left === 1 ? 'lesson' : `${left} lessons`} first (in an approved language)` };
    }
    const failed = tries.filter((t) => t.result === 'fail');
    if (a.max_attempts && !a.retake_wait_hours && failed.length >= a.max_attempts) return { ok: false, why: `All ${a.max_attempts} attempts used: ask the programme's owner` };
    if (a.max_attempts && failed.length && failed.length % a.max_attempts === 0) {
      const last = new Date(failed[failed.length - 1].submitted_at).getTime(), until = last + a.retake_wait_hours * 3600e3;
      if (until > Date.now()) return { ok: false, why: `${a.max_attempts} attempts used: you can try again after ${new Date(until).toISOString().slice(0, 16).replace('T', ' ')} UTC`, waitUntil: until };
    }
    return { ok: true };
  }
  async function getAssessment(w, id) {
    const a = await assessmentById(id); if (!a) return reply(404, { error: 'No such assessment' });
    const canEdit = ctx.editor(w, a.programme_id);
    if (!canEdit && !['published', 'superseded'].includes(a.version_state)) return reply(404, { error: 'No such assessment' });
    const e = (await db.query("SELECT TOP 1 * FROM {S}.enrolment WHERE person_id = @p AND version_id = @v AND state <> 'withdrawn'", { p: w.person.person_id, v: a.version_id }))[0];
    const tries = e ? await db.query('SELECT * FROM {S}.attempt WHERE enrolment_id = @e AND assessment_id = @a ORDER BY started_at', { e: e.enrolment_id, a: a.assessment_id }) : [];
    const qs = await questionsOf(a.assessment_id);
    const rules = ctx.rulesFor ? await ctx.rulesFor(qs.map((q) => ({ rules: q.rules.split(',') })), a.programme_id) : [];
    return reply(200, {
      assessment: { id: a.assessment_id, title: a.title, description: a.description, versionId: a.version_id, programmeId: a.programme_id, edition: a.edition, versionState: a.version_state, questions: qs.length },
      policy: { passMark: a.pass_mark, maxAttempts: a.max_attempts, retakeWaitHours: a.retake_wait_hours, completionRule: a.completion_rule },
      questions: canEdit ? qs.map((q) => qView(q, true)) : [], rules,
      attempts: tries.map((t) => ({ id: t.attempt_id, result: t.result, percent: t.max_score ? Math.round((100 * t.score) / t.max_score) : null, startedAt: t.started_at, submittedAt: t.submitted_at })),
      may: await mayAttempt(a, e), can: { edit: canEdit && a.version_state === 'draft' },
    });
  }
  async function startAttempt(w, id) {
    const a = await assessmentById(id); if (!a) return reply(404, { error: 'No such assessment' });
    const e = (await db.query("SELECT TOP 1 * FROM {S}.enrolment WHERE person_id = @p AND version_id = @v AND state <> 'withdrawn'", { p: w.person.person_id, v: a.version_id }))[0];
    const may = await mayAttempt(a, e); if (!may.ok) return reply(409, { error: may.why });
    if (may.resume) return getAttempt(w, may.resume);
    const qs = await questionsOf(a.assessment_id); if (!qs.length) return reply(409, { error: 'This assessment has no questions yet' });
    const tid = uuid();
    await db.tx(async (q) => {
      await q('INSERT INTO {S}.attempt (attempt_id, person_id, enrolment_id, assessment_id, version_id, programme_id, pass_mark) VALUES (@id, @p, @e, @a, @v, @prog, @pass)',
        { id: tid, p: w.person.person_id, e: e.enrolment_id, a: a.assessment_id, v: a.version_id, prog: a.programme_id, pass: a.pass_mark });
      await audit(q, w, 'attempt.start', 'attempt', tid, { assessment: a.title }, { programmeId: a.programme_id });
    });
    return getAttempt(w, tid);
  }
  /** an attempt, as its owner (or an assessor, an admin, their coordinator) may see it: answers and feedback once submitted */
  async function getAttempt(w, id) {
    const t = await attemptById(id); if (!t) return reply(404, { error: 'No such attempt' });
    const own = t.person_id === w.person.person_id;
    const may = own || P.can(w.grants, 'assess', { programmeId: t.programme_id }) || P.can(w.grants, 'report.read', { programmeId: t.programme_id, regionId: t.region_id || undefined });
    if (!may) return reply(404, { error: 'No such attempt' });
    const qs = await questionsOf(t.assessment_id), answers = JSON.parse(t.answers || '[]'), done = t.result !== 'open';
    const rules = ctx.rulesFor ? await ctx.rulesFor(qs.map((q) => ({ rules: q.rules.split(',') })), t.programme_id) : [];
    return reply(200, { attempt: {
      id: t.attempt_id, assessmentId: t.assessment_id, title: t.assessment_title, programmeId: t.programme_id, programmeTitle: t.programme_title, versionId: t.version_id,
      person: own ? null : { name: t.legal_name, publicId: t.public_id }, result: t.result, score: t.score, maxScore: t.max_score, passMark: t.pass_mark,
      percent: t.max_score ? Math.round((100 * t.score) / t.max_score) : null, startedAt: t.started_at, submittedAt: t.submitted_at, assessorNote: t.assessor_note || '', decidedAt: t.decided_at,
      questions: qs.map((q) => { const v = qView(q, done); const a = answers.find((x) => x.questionId.toLowerCase() === q.question_id.toLowerCase()); return { ...v, answer: a ? { chosen: a.chosen, reason: a.reason || '', correct: a.correct, decided: !!a.decided } : null }; }),
    }, rules, credential: done ? await credentialFor(t) : null });
  }
  async function credentialFor(t) {
    const c = (await db.query(`${credQuery} WHERE c.attempt_id = @a`, { a: t.attempt_id }))[0];
    return credView(c);
  }
  /** marks one answer: right, wrong, or (needs an assessor) null for now */
  function mark(q, chosen) {
    const right = JSON.parse(q.options).filter((o) => o.correct).map((o) => o.id).sort();
    const got = [...new Set(chosen)].sort();
    const correct = right.length === got.length && right.every((x, i) => x === got[i]);
    return q.needs_assessor ? null : correct;
  }
  async function score(q, t, answers) {
    const max = answers.length, right = answers.filter((a) => a.correct === true).length, waiting = answers.filter((a) => a.correct === null).length;
    const percent = max ? Math.round((100 * right) / max) : 0, best = max ? Math.round((100 * (right + waiting)) / max) : 0;
    // an assessor is only asked when their decision could change the result
    const result = best < t.pass_mark ? 'fail' : waiting ? 'pending' : percent >= t.pass_mark ? 'pass' : 'fail';
    await q('UPDATE {S}.attempt SET answers = @ans, score = @s, max_score = @m, result = @r WHERE attempt_id = @id', { ans: JSON.stringify(answers), s: right, m: max, r: result, id: t.attempt_id });
    return { result, percent };
  }
  async function submit(w, id, b) {
    const t = await attemptById(id); if (!t || t.person_id !== w.person.person_id) return reply(404, { error: 'No such attempt' });
    if (t.result !== 'open') return reply(409, { error: 'That attempt has been submitted: its answers can\'t change' });
    const qs = await questionsOf(t.assessment_id), given = b?.answers && typeof b.answers === 'object' ? b.answers : {};
    const answers = qs.map((q) => {
      const raw = given[q.question_id] ?? given[q.question_id.toLowerCase()] ?? {};
      const options = JSON.parse(q.options).map((o) => o.id);
      const chosen = (Array.isArray(raw.chosen) ? raw.chosen : []).map(String).filter((x) => options.includes(x)).slice(0, q.type === 'multiple' ? 8 : 1);
      return { questionId: q.question_id, lineageId: q.lineage_id, versionNo: q.version_no, rules: q.rules.split(',').filter(Boolean), type: q.type, chosen, reason: text(raw.reason, 1000), correct: mark(q, chosen), provisional: mark({ ...q, needs_assessor: 0 }, chosen) };
    });
    let out, enrolment, late = false;
    await db.tx(async (q) => {
      // submitted once: a second submit (a double tap) finds it no longer open and changes nothing
      const took = await q("UPDATE {S}.attempt SET submitted_at = SYSUTCDATETIME() OUTPUT inserted.attempt_id WHERE attempt_id = @id AND result = 'open' AND submitted_at IS NULL", { id: t.attempt_id });
      if (!took.length) { late = true; return; }
      out = await score(q, t, answers);
      await audit(q, w, 'attempt.submit', 'attempt', t.attempt_id, { assessment: t.assessment_title, result: out.result, percent: out.percent, passMark: t.pass_mark }, { programmeId: t.programme_id });
      if (out.result === 'pass') enrolment = await ctx.checkCompletion(q, t.enrolment_id, w);
    });
    if (late) return reply(409, { error: 'That attempt has been submitted: its answers can\'t change' });
    const r = await getAttempt(w, t.attempt_id);
    return reply(200, { ...r.body, enrolment: enrolment ? { state: enrolment.state } : null });
  }

  // ------------------------------------------------------------------ assessors
  async function assessing(w) {
    const progs = await db.query('SELECT programme_id FROM {S}.programme');
    const mine = progs.map((p) => p.programme_id).filter((id) => P.can(w.grants, 'assess', { programmeId: id }));
    if (!mine.length) return reply(403, { error: 'Only assessors decide assessments' });
    const rows = await db.query(`SELECT t.*, a.title, r.legal_name, r.public_id FROM {S}.attempt t JOIN {S}.assessment a ON a.assessment_id = t.assessment_id JOIN {S}.person r ON r.person_id = t.person_id
      WHERE t.result = 'pending' AND t.programme_id IN (${mine.map((_, i) => `@p${i}`).join(', ')}) ORDER BY t.submitted_at`, Object.fromEntries(mine.map((id, i) => [`p${i}`, id])));
    return reply(200, { attempts: rows.map((t) => ({ id: t.attempt_id, title: t.title, programmeId: t.programme_id, person: { name: t.legal_name, publicId: t.public_id }, submittedAt: t.submitted_at })) });
  }
  async function decide(w, id, b) {
    const t = await attemptById(id); if (!t) return reply(404, { error: 'No such attempt' });
    if (!P.can(w.grants, 'assess', { programmeId: t.programme_id })) return reply(403, { error: 'Only the programme\'s assessors decide its assessments' });
    if (t.person_id === w.person.person_id) return reply(403, { error: 'You can\'t decide your own attempt' });
    if (t.result !== 'pending') return reply(409, { error: 'That attempt isn\'t waiting for a decision' });
    const decisions = b?.decisions || {}, answers = JSON.parse(t.answers);
    for (const a of answers.filter((x) => x.correct === null)) {
      const d = decisions[a.questionId] ?? decisions[a.questionId.toLowerCase()];
      if (typeof d !== 'boolean') return reply(400, { error: 'Decide every answer that needs it' });
      a.correct = d; a.decided = true;
    }
    let out, enrolment, late = false;
    await db.tx(async (q) => {
      // decided once: a second assessor at the same moment finds it no longer pending
      const took = await q("UPDATE {S}.attempt SET assessor_id = @by, assessor_note = @note, decided_at = SYSUTCDATETIME() OUTPUT inserted.attempt_id WHERE attempt_id = @id AND result = 'pending' AND decided_at IS NULL", { by: w.person.person_id, note: text(b?.note, 1000) || null, id: t.attempt_id });
      if (!took.length) { late = true; return; }
      out = await score(q, t, answers);
      await audit(q, w, 'attempt.decide', 'attempt', t.attempt_id, { person: t.public_id, decisions, result: out.result, percent: out.percent }, { programmeId: t.programme_id, regionId: t.region_id });
      if (out.result === 'pass') {
        // the credential is issued as the learner's, by the assessor's decision
        enrolment = await ctx.checkCompletion(q, t.enrolment_id, w);
      }
    });
    if (late) return reply(409, { error: 'That attempt has just been decided' });
    return reply(200, { result: out.result, percent: out.percent, enrolment: enrolment ? { state: enrolment.state } : null });
  }

  // ------------------------------------------------------------------ credentials
  async function getCredential(w, id) {
    const c = isUuid(id) && (await db.query(`${credQuery} WHERE c.credential_id = @id`, { id }))[0];
    if (!c || !(c.person_id === w.person.person_id || P.can(w.grants, 'person.read', { regionId: c.region_id || undefined }) || P.can(w.grants, 'credential.change', { programmeId: c.programme_id }))) return reply(404, { error: 'No such credential' });
    const history = (await db.query("SELECT e.action, e.summary, e.at, a.legal_name, s.legal_name AS as_name FROM {S}.audit_event e LEFT JOIN {S}.person a ON a.person_id = e.actor_id LEFT JOIN {S}.person s ON s.person_id = e.acting_as WHERE e.entity_type = 'credential' AND e.entity_id = @id ORDER BY e.audit_id", { id: c.credential_id }))
      .map((h) => ({ action: h.action, summary: JSON.parse(h.summary || '{}'), at: h.at, by: h.legal_name ? `${h.legal_name}${h.as_name ? ` as ${h.as_name}` : ''}` : 'the platform' }));
    return reply(200, { credential: credView(c), history, canChange: P.can(w.grants, 'credential.change', { programmeId: c.programme_id }) });
  }
  async function credentialStatus(w, id, b) {
    const c = isUuid(id) && (await db.query(`${credQuery} WHERE c.credential_id = @id`, { id }))[0]; if (!c) return reply(404, { error: 'No such credential' });
    if (!P.can(w.grants, 'credential.change', { programmeId: c.programme_id })) return reply(403, { error: 'Only the programme\'s owner or an admin changes a credential' });
    const status = String(b?.status || ''), reason = text(b?.reason, 400);
    if (!['active', 'suspended', 'revoked'].includes(status)) return reply(400, { error: 'A credential can be made active, suspended or revoked' });
    if (!reason) return reply(400, { error: 'Say why: it\'s kept in the audit log' });
    if (c.status === 'revoked') return reply(409, { error: 'A revoked credential stays revoked' });
    if (c.status === 'superseded') return reply(409, { error: 'A newer credential replaced this one: change that one instead' });
    await db.tx(async (q) => {
      await q('UPDATE {S}.credential SET status = @s, status_reason = @r, updated_at = SYSUTCDATETIME() WHERE credential_id = @id', { s: status, r: reason, id: c.credential_id });
      await audit(q, w, 'credential.status', 'credential', c.credential_id, { publicId: c.public_id, before: c.status, after: status, reason }, { programmeId: c.programme_id, regionId: c.region_id });
    });
    return getCredential(w, c.credential_id);
  }

  async function route(w, method, parts, body) {
    const [, a, b, c] = parts;
    if (a === 'versions' && b && c === 'assessments' && method === 'POST') return addAssessment(w, b, body);
    if (a === 'assessments' && b && !c && method === 'GET') return getAssessment(w, b);
    if (a === 'assessments' && b && c === 'questions' && method === 'POST') return addQuestion(w, b, body);
    if (a === 'assessments' && b && c === 'attempts' && method === 'POST') return startAttempt(w, b);
    if (a === 'questions' && b && !c && method === 'DELETE') return deleteQuestion(w, b);
    if (a === 'attempts' && b && !c && method === 'GET') return getAttempt(w, b);
    if (a === 'attempts' && b && c === 'submit' && method === 'POST') return submit(w, b, body);
    if (a === 'attempts' && b && c === 'decide' && method === 'POST') return decide(w, b, body);
    if (a === 'assessing' && !b && method === 'GET') return assessing(w);
    if (a === 'credentials' && b && !c && method === 'GET') return getCredential(w, b);
    if (a === 'credentials' && b && c === 'status' && method === 'POST') return credentialStatus(w, b, body);
    return null;
  }
  return { route };
}

module.exports = { createAssess };
