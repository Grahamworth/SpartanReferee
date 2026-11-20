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
   GET  /api/learn/assessing/lesson-tests?programme= -> { people, programmes }  assessors: every lesson test each person has taken, with
        their success rate (how many lessons right first time, how many tries in all)
   POST /api/learn/attempts/<id>/decide {decisions: {questionId: true|false}, note}   assessors
   GET  /api/learn/credentials/<id>                 -> { credential }  POST /api/learn/credentials/<id>/status {status, reason}
   Scoring: a single-choice question is right when the right option is chosen; a multiple-choice one when exactly the right ones
   are; a video judgement as either, and when it needs an assessor, they confirm it with the learner's reasons. */
const TYPES = ['single', 'multiple', 'video'];

function createAssess(ctx) {
  const { db, reply, P, audit, uuid, text, isUuid } = ctx;
  // the final assessment's settings are the programme's own (20 November 2026): on or off, its pass mark, how many questions each
  // attempt draws from the pool, and how many attempts before the programme is done again
  const withSettings = (r) => r && ({ ...r, version_pass_mark: r.pass_mark, pass_mark: r.assessment_pass_mark, max_attempts: r.assessment_attempts, draw: r.assessment_questions, on: r.assessment_on !== false });
  const assessmentById = async (id) => (isUuid(id) ? withSettings((await db.query(`SELECT a.*, v.programme_id, v.state AS version_state, v.edition, v.pass_mark, v.max_attempts, v.retake_wait_hours, v.completion_rule,
      p.assessment_on, p.assessment_pass_mark, p.assessment_questions, p.assessment_attempts
    FROM {S}.assessment a JOIN {S}.programme_version v ON v.version_id = a.version_id JOIN {S}.programme p ON p.programme_id = v.programme_id WHERE a.assessment_id = @id`, { id }))[0] || null) : null);
  const questionsOf = async (aid) => db.query('SELECT * FROM {S}.question WHERE assessment_id = @a ORDER BY seq', { a: aid });
  /** the pool an attempt draws from: every question of the assessment (a video judgement too, which an assessor may confirm) */
  const poolOf = async (aid) => questionsOf(aid);
  /** an attempt's questions: those it drew, in that order (every question, for attempts from before the pool) */
  const attemptQuestions = async (t) => {
    const all = await questionsOf(t.assessment_id);
    if (!t.question_ids) return all;
    const byId = new Map(all.map((q) => [String(q.question_id).toLowerCase(), q]));
    return JSON.parse(t.question_ids).map((id) => byId.get(String(id).toLowerCase())).filter(Boolean);
  };
  /** this round's attempts: those since the programme was last started again */
  const thisRound = (tries, e) => tries.filter((t) => !e?.restarted_at || new Date(t.started_at) > new Date(e.restarted_at));
  const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  /** n questions for a new attempt: those this person has seen least (never, first), spread across the programme's topics, at random */
  function draw(pool, tries, n) {
    const seen = new Map();
    for (const t of tries) for (const id of JSON.parse(t.question_ids || '[]')) seen.set(String(id).toLowerCase(), (seen.get(String(id).toLowerCase()) || 0) + 1);
    const tiers = new Map();
    for (const q of pool) { const c = seen.get(String(q.question_id).toLowerCase()) || 0; if (!tiers.has(c)) tiers.set(c, []); tiers.get(c).push(q); }
    const picked = [];
    for (const c of [...tiers.keys()].sort((x, y) => x - y)) {
      const byTopic = new Map();
      for (const q of shuffle(tiers.get(c))) { const k = q.topic || ''; if (!byTopic.has(k)) byTopic.set(k, []); byTopic.get(k).push(q); }
      const queues = shuffle([...byTopic.values()]);
      while (picked.length < n && queues.some((x) => x.length)) for (const x of queues) if (x.length && picked.length < n) picked.push(x.shift());
      if (picked.length >= n) break;
    }
    return picked.sort((x, y) => x.seq - y.seq); // in the programme's order
  }
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
    const st = (await db.query('SELECT assessment_on, assessment_pass_mark, assessment_questions, assessment_attempts FROM {S}.programme WHERE programme_id = @p', { p: p.programme_id }))[0] || {};
    const pool = async (aid) => (await poolOf(aid)).length;
    const pools = Object.fromEntries(await Promise.all(list.map(async (a) => [a.assessment_id, await pool(a.assessment_id)])));
    return { ...base, finalAssessment: { on: st.assessment_on !== false, passMark: st.assessment_pass_mark, perAttempt: st.assessment_questions, attempts: st.assessment_attempts, restarts: e?.restarts || 0 },
      assessments: (st.assessment_on === false ? [] : list).map((a) => ({ id: a.assessment_id, title: a.title, description: a.description, questions: a.questions, pool: pools[a.assessment_id], perAttempt: Math.min(st.assessment_questions || 10, pools[a.assessment_id]),
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
    if (!a.on) return { ok: false, why: 'This programme has no final assessment' };
    if (!e || e.state === 'withdrawn') return { ok: false, why: 'Enrol in the programme to take its assessment' };
    if (!['published', 'superseded'].includes(a.version_state)) return { ok: false, why: 'The assessment opens once the programme is published' };
    const tries = thisRound(await db.query("SELECT * FROM {S}.attempt WHERE enrolment_id = @e AND assessment_id = @a ORDER BY started_at", { e: e.enrolment_id, a: a.assessment_id }), e);
    if (tries.some((t) => t.result === 'pass')) return { ok: false, why: 'You\'ve passed it already', passed: true };
    if (tries.some((t) => t.result === 'pending')) return { ok: false, why: 'An assessor is checking your last attempt' };
    const open = tries.find((t) => t.result === 'open'); if (open) return { ok: true, resume: open.attempt_id };
    // the lessons first: it's the programme's final assessment (unless the version completes on its assessment alone)
    if (a.completion_rule !== 'assessment') {
      const countable = await ctx.countableLessons(a.version_id);
      const done = new Set((await db.query('SELECT DISTINCT lesson_id FROM {S}.completion WHERE enrolment_id = @e AND preview = 0', { e: e.enrolment_id })).map((r) => r.lesson_id));
      const left = countable.filter((id) => !done.has(id)).length;
      if (left) return { ok: false, why: `Complete the ${left === 1 ? 'lesson' : `${left} lessons`} first (in an approved language)` };
    }
    const failed = tries.filter((t) => t.result === 'fail');
    if (a.max_attempts && failed.length >= a.max_attempts) return { ok: false, why: `All ${a.max_attempts} attempts used: the programme starts again` };
    return { ok: true, used: failed.length, left: a.max_attempts ? a.max_attempts - failed.length : null };
  }
  async function getAssessment(w, id) {
    const a = await assessmentById(id); if (!a) return reply(404, { error: 'No such assessment' });
    const canEdit = ctx.editor(w, a.programme_id);
    if (!canEdit && !['published', 'superseded'].includes(a.version_state)) return reply(404, { error: 'No such assessment' });
    const e = (await db.query("SELECT TOP 1 * FROM {S}.enrolment WHERE person_id = @p AND version_id = @v AND state <> 'withdrawn'", { p: w.person.person_id, v: a.version_id }))[0];
    const tries = e ? await db.query('SELECT * FROM {S}.attempt WHERE enrolment_id = @e AND assessment_id = @a ORDER BY started_at', { e: e.enrolment_id, a: a.assessment_id }) : [];
    const qs = await questionsOf(a.assessment_id), pool = qs;
    const rules = ctx.rulesFor ? await ctx.rulesFor(qs.map((q) => ({ rules: q.rules.split(',') })), a.programme_id) : [];
    return reply(200, {
      assessment: { id: a.assessment_id, title: a.title, description: a.description, versionId: a.version_id, programmeId: a.programme_id, edition: a.edition, versionState: a.version_state, questions: qs.length },
      policy: { passMark: a.pass_mark, maxAttempts: a.max_attempts, perAttempt: Math.min(a.draw, pool.length), pool: pool.length, on: a.on, restarts: e?.restarts || 0, completionRule: a.completion_rule },
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
    const pool = await poolOf(a.assessment_id); if (!pool.length) return reply(409, { error: 'This assessment has no questions yet' });
    // the questions this person has seen least, every round counted, so an attempt repeats none while the pool lasts
    const before = await db.query('SELECT question_ids FROM {S}.attempt WHERE person_id = @p AND assessment_id = @a', { p: w.person.person_id, a: a.assessment_id });
    const chosen = draw(pool, before, Math.min(a.draw || 10, pool.length));
    const tid = uuid();
    await db.tx(async (q) => {
      await q('INSERT INTO {S}.attempt (attempt_id, person_id, enrolment_id, assessment_id, version_id, programme_id, pass_mark, question_ids) VALUES (@id, @p, @e, @a, @v, @prog, @pass, @qs)',
        { id: tid, p: w.person.person_id, e: e.enrolment_id, a: a.assessment_id, v: a.version_id, prog: a.programme_id, pass: a.pass_mark, qs: JSON.stringify(chosen.map((x) => x.question_id)) });
      await audit(q, w, 'attempt.start', 'attempt', tid, { assessment: a.title, questions: chosen.length, pool: pool.length }, { programmeId: a.programme_id });
    });
    return getAttempt(w, tid);
  }
  /** after a failed attempt: how many are left this round, or whether the programme started again because of it */
  async function afterFail(t) {
    const e = (await db.query('SELECT * FROM {S}.enrolment WHERE enrolment_id = @e', { e: t.enrolment_id }))[0];
    if (e?.restarted_at && t.submitted_at && new Date(e.restarted_at) >= new Date(t.submitted_at)) return { restarted: true, left: 0 };
    const a = await assessmentById(t.assessment_id), may = a && e ? await mayAttempt(a, e) : {};
    return { restarted: false, left: may.left ?? null };
  }
  /** an attempt, as its owner (or an assessor, an admin, their coordinator) may see it: answers and feedback once submitted */
  async function getAttempt(w, id) {
    const t = await attemptById(id); if (!t) return reply(404, { error: 'No such attempt' });
    const own = t.person_id === w.person.person_id;
    const may = own || P.can(w.grants, 'assess', { programmeId: t.programme_id }) || P.can(w.grants, 'report.read', { programmeId: t.programme_id, regionId: t.region_id || undefined });
    if (!may) return reply(404, { error: 'No such attempt' });
    const qs = await attemptQuestions(t), answers = JSON.parse(t.answers || '[]'), done = t.result !== 'open';
    const rules = ctx.rulesFor ? await ctx.rulesFor(qs.map((q) => ({ rules: q.rules.split(',') })), t.programme_id) : [];
    return reply(200, { attempt: {
      id: t.attempt_id, assessmentId: t.assessment_id, title: t.assessment_title, programmeId: t.programme_id, programmeTitle: t.programme_title, versionId: t.version_id,
      person: own ? null : { name: t.legal_name, publicId: t.public_id }, result: t.result, score: t.score, maxScore: t.max_score, passMark: t.pass_mark,
      percent: t.max_score ? Math.round((100 * t.score) / t.max_score) : null, startedAt: t.started_at, submittedAt: t.submitted_at, assessorNote: t.assessor_note || '', decidedAt: t.decided_at,
      after: own && t.result === 'fail' ? await afterFail(t) : null,
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
  /** after a failed attempt: with every attempt of this round used, the programme is done again. Its finished lessons move to
   *  completion_archive (kept, not counted), where each lesson was is forgotten, and the attempts start counting afresh */
  async function maybeRestart(q, t, w) {
    const e = (await q('SELECT e.*, p.assessment_attempts FROM {S}.enrolment e JOIN {S}.programme p ON p.programme_id = e.programme_id WHERE e.enrolment_id = @e', { e: t.enrolment_id }))[0];
    if (!e || !e.assessment_attempts) return false;
    const fails = thisRound(await q("SELECT started_at, result FROM {S}.attempt WHERE enrolment_id = @e AND assessment_id = @a", { e: e.enrolment_id, a: t.assessment_id }), e).filter((x) => x.result === 'fail').length;
    if (fails < e.assessment_attempts) return false;
    const n = (e.restarts || 0) + 1;
    await q(`INSERT INTO {S}.completion_archive (completion_id, person_id, enrolment_id, programme_id, version_id, lesson_id, content_id, content_version, locale, preview, completed_at, restart_no)
             SELECT completion_id, person_id, enrolment_id, programme_id, version_id, lesson_id, content_id, content_version, locale, preview, completed_at, @n FROM {S}.completion WHERE enrolment_id = @e`, { e: e.enrolment_id, n });
    const moved = await q('DELETE FROM {S}.completion OUTPUT deleted.completion_id WHERE enrolment_id = @e', { e: e.enrolment_id });
    await q('DELETE FROM {S}.lesson_progress WHERE person_id = @p AND lesson_id IN (SELECT lesson_id FROM {S}.lesson WHERE version_id = @v)', { p: e.person_id, v: e.version_id });
    await q("UPDATE {S}.enrolment SET restarted_at = SYSUTCDATETIME(), restarts = @n, state = 'active', completed_at = NULL WHERE enrolment_id = @e", { e: e.enrolment_id, n });
    await audit(q, w, 'enrolment.restart', 'enrolment', e.enrolment_id, { reason: `${fails} attempts at the final assessment not passed`, lessonsArchived: moved.length, restart: n }, { programmeId: e.programme_id });
    return true;
  }
  async function submit(w, id, b) {
    const t = await attemptById(id); if (!t || t.person_id !== w.person.person_id) return reply(404, { error: 'No such attempt' });
    if (t.result !== 'open') return reply(409, { error: 'That attempt has been submitted: its answers can\'t change' });
    const qs = await attemptQuestions(t), given = b?.answers && typeof b.answers === 'object' ? b.answers : {};
    const answers = qs.map((q) => {
      const raw = given[q.question_id] ?? given[q.question_id.toLowerCase()] ?? {};
      const options = JSON.parse(q.options).map((o) => o.id);
      const chosen = (Array.isArray(raw.chosen) ? raw.chosen : []).map(String).filter((x) => options.includes(x)).slice(0, q.type === 'multiple' ? 8 : 1);
      return { questionId: q.question_id, lineageId: q.lineage_id, versionNo: q.version_no, rules: q.rules.split(',').filter(Boolean), type: q.type, chosen, reason: text(raw.reason, 1000), correct: mark(q, chosen), provisional: mark({ ...q, needs_assessor: 0 }, chosen) };
    });
    let out, enrolment, late = false, restarted = false;
    await db.tx(async (q) => {
      // submitted once: a second submit (a double tap) finds it no longer open and changes nothing
      const took = await q("UPDATE {S}.attempt SET submitted_at = SYSUTCDATETIME() OUTPUT inserted.attempt_id WHERE attempt_id = @id AND result = 'open' AND submitted_at IS NULL", { id: t.attempt_id });
      if (!took.length) { late = true; return; }
      out = await score(q, t, answers);
      await audit(q, w, 'attempt.submit', 'attempt', t.attempt_id, { assessment: t.assessment_title, result: out.result, percent: out.percent, passMark: t.pass_mark }, { programmeId: t.programme_id });
      if (out.result === 'pass') enrolment = await ctx.checkCompletion(q, t.enrolment_id, w);
      if (out.result === 'fail') restarted = await maybeRestart(q, t, w);
    });
    if (late) return reply(409, { error: 'That attempt has been submitted: its answers can\'t change' });
    const r = await getAttempt(w, t.attempt_id);
    return reply(200, { ...r.body, enrolment: enrolment ? { state: enrolment.state } : null, restarted });
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
  /** assessors: how each person is doing with the tests at the end of lessons, in the programmes they assess (20 November 2026) */
  async function lessonTests(w, query) {
    const progs = await db.query('SELECT programme_id, title FROM {S}.programme');
    const mine = progs.filter((p) => P.can(w.grants, 'assess', { programmeId: p.programme_id }));
    if (!mine.length) return reply(403, { error: 'Only assessors see the lesson tests' });
    const pick = text(query?.programme, 32), ids = pick && mine.some((p) => p.programme_id === pick) ? [pick] : mine.map((p) => p.programme_id);
    const rows = await db.query(`SELECT t.person_id, t.lesson_id, t.programme_id, t.attempt_no, t.right_count, t.question_count, t.passed, t.at, r.legal_name, r.preferred_name, r.public_id, l.title AS lesson
      FROM {S}.lesson_test t JOIN {S}.person r ON r.person_id = t.person_id JOIN {S}.lesson l ON l.lesson_id = t.lesson_id
      WHERE t.programme_id IN (${ids.map((_, i) => `@p${i}`).join(', ')}) ORDER BY t.at`, Object.fromEntries(ids.map((id, i) => [`p${i}`, id])));
    const people = new Map();
    for (const r of rows) {
      if (!people.has(r.person_id)) people.set(r.person_id, { id: r.person_id, name: r.preferred_name || r.legal_name, publicId: r.public_id, lessons: new Map() });
      const p = people.get(r.person_id), key = r.lesson_id;
      if (!p.lessons.has(key)) p.lessons.set(key, { lessonId: key, title: r.lesson, programmeId: r.programme_id, tries: [] });
      p.lessons.get(key).tries.push({ no: r.attempt_no, right: r.right_count, of: r.question_count, passed: !!r.passed, at: r.at });
    }
    const out = [...people.values()].map((p) => {
      const lessons = [...p.lessons.values()].map((l) => ({ ...l, passed: l.tries.some((x) => x.passed), firstTime: !!l.tries[0]?.passed, triesToPass: (l.tries.findIndex((x) => x.passed) + 1) || null }));
      const tries = lessons.flatMap((l) => l.tries), right = tries.reduce((n, x) => n + x.right, 0), asked = tries.reduce((n, x) => n + x.of, 0);
      return { id: p.id, name: p.name, publicId: p.publicId, lessons, summary: { lessons: lessons.length, passed: lessons.filter((l) => l.passed).length, firstTime: lessons.filter((l) => l.firstTime).length,
        tries: tries.length, answersRight: asked ? Math.round((100 * right) / asked) : 0, lastAt: tries.length ? tries[tries.length - 1].at : null } };
    }).sort((a, b) => a.name.localeCompare(b.name));
    return reply(200, { people: out, programmes: mine.map((p) => ({ id: p.programme_id, title: p.title })), programme: pick || '' });
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

  async function route(w, method, parts, body, query) {
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
    if (a === 'assessing' && b === 'lesson-tests' && method === 'GET') return lessonTests(w, query);
    if (a === 'credentials' && b && !c && method === 'GET') return getCredential(w, b);
    if (a === 'credentials' && b && c === 'status' && method === 'POST') return credentialStatus(w, b, body);
    return null;
  }
  return { route };
}

module.exports = { createAssess };
