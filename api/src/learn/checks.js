'use strict';
/* Keeping sharp (19 November 2026): quick checks at the end of each lesson, refreshers, a weekly streak and badges. Practice only:
   nothing here counts towards a credential (only the assessment does), so the answers travel with the questions and the page marks
   them itself, offline too.
   - A quick check is 2 or 3 questions on what the lesson just taught. A lesson is completed once its check is answered, right or wrong.
   - Every answer puts the question in a box (spaced practice): right moves it up a box, wrong back to the first. The box says when
     it's due again: 1, 3, 7, 21, 60 or 120 days. A refresher is 5 questions that are due: first any whose rule has changed since
     they were last answered (a new approved version), then those missed last time, then the rest by date.
   - The streak counts weeks (Monday to Sunday, UTC) with any learning in them: referees train between events, not every day.
   - Badges, once earned, are kept: per programme (first lesson, halfway, all lessons, every check right, qualified) and overall
     (a 4-week and a 12-week streak, 5 refreshers). There are no leaderboards: officiating isn't a contest.

   POST /api/learn/lessons/<id>/checks {answers: [{key, choice}]}   -> { results: [{key, right}], right, of, passed, attemptNo, badges }
        every try is kept (lesson_test, 009-lesson-tests.sql): the lesson's test can be taken again until every answer is right
   GET  /api/learn/refresher?programme=&more=1                      -> { questions, due, practised, nextDue }   more: fill up to 5
   POST /api/learn/refresher {answers: [{key, choice}], partial}    -> { results, right, of, nextDue, streak, badges }
        partial: one answer of a round answered a question at a time (Learning's Keep sharp bar); the round's last counts as a refresher
   GET  /api/learn/progress                                         -> { streak, badges, refresher: [{programmeId, title, due, practised}] }
        each badge has have and need (how close: "3 of 5 refreshers")
   badges in a reply are the ones just earned. */
const DAYS = [1, 3, 7, 21, 60, 120];
const SIZE = 5;
const KINDS = ['started', 'halfway', 'lessons', 'sharp', 'qualified'];
const OVERALL = ['streak-4', 'streak-12', 'refresher-5'];
const DAY = 864e5;
// Monday-based week numbers since 1970 (which began on a Thursday)
const weekOf = (d) => Math.floor((Math.floor(new Date(d).getTime() / DAY) + 3) / 7);

/** the streak from the days someone learned: weeks in a row up to this one (or last, if this week is still to come), the best run,
 *  and the last 8 weeks for the strip */
function streakFrom(days, now = Date.now()) {
  const weeks = new Set(days.map(weekOf)), w = weekOf(now), thisWeek = weeks.has(w);
  let weeksInRow = 0; for (let x = thisWeek ? w : w - 1; weeks.has(x); x--) weeksInRow++;
  let best = 0, run = 0; for (const x of [...weeks].sort((a, b) => a - b)) { run = weeks.has(x - 1) ? run + 1 : 1; best = Math.max(best, run); }
  return { weeks: weeksInRow, thisWeek, best, recent: Array.from({ length: 8 }, (_, i) => weeks.has(w - 7 + i)) };
}

function createChecks(ctx) {
  const { db, reply, audit, text } = ctx;
  // tr: the question in other languages, written in Programs (authoring.js): { fr: { prompt, options, feedback } }
  const parse = (r) => { const b = JSON.parse(r.body); return { key: r.check_key, prompt: b.prompt, options: b.options, answer: b.answer, feedback: b.feedback || '', rules: b.rules || [], tr: b.tr || {} }; };
  ctx.checksOf = async (lessonId) => checksOf(lessonId);
  const checksOf = async (lessonId) => (await db.query('SELECT * FROM {S}.lesson_check WHERE lesson_id = @l ORDER BY seq', { l: lessonId })).map(parse);

  /** has this person answered every question of this lesson's check? (a lesson with no check: yes) */
  ctx.checksAnswered = async (personId, lessonId) => {
    const r = (await db.query(`SELECT COUNT(*) AS n, SUM(CASE WHEN s.person_id IS NULL THEN 0 ELSE 1 END) AS done FROM {S}.lesson_check c
      LEFT JOIN {S}.check_state s ON s.check_key = c.check_key AND s.person_id = @p WHERE c.lesson_id = @l`, { p: personId, l: lessonId }))[0];
    return !r.n || r.done === r.n;
  };
  /** a day of learning, for the streak */
  ctx.markDay = async (personId, q = db.query) => {
    try { await q('INSERT INTO {S}.learning_day (person_id, day) SELECT @p, CAST(SYSUTCDATETIME() AS DATE) WHERE NOT EXISTS (SELECT 1 FROM {S}.learning_day WHERE person_id = @p AND day = CAST(SYSUTCDATETIME() AS DATE))', { p: personId }); }
    catch (e) { if (e.number !== 2627) throw e; } // the same day, at the same moment
  };
  // a lesson brings its check, and how this person did with each question
  const prevExtras = ctx.lessonExtras;
  ctx.lessonExtras = async (w, l, c) => {
    const base = prevExtras ? await prevExtras(w, l, c) : {};
    const checks = await checksOf(l.lesson_id);
    const states = checks.length ? await db.query(`SELECT check_key, last_right, answered FROM {S}.check_state WHERE person_id = @p AND check_key IN (${checks.map((_, i) => `@k${i}`).join(', ')})`,
      { p: w.person.person_id, ...Object.fromEntries(checks.map((k, i) => [`k${i}`, k.key])) }) : [];
    // this person's tries at the lesson's test: how many, and whether one had every answer right
    const tries = checks.length ? (await db.query('SELECT COUNT(*) AS n, MAX(CAST(passed AS INT)) AS passed FROM {S}.lesson_test WHERE person_id = @p AND lesson_id = @l', { p: w.person.person_id, l: l.lesson_id }))[0] : null;
    return { ...base, checks, checkState: Object.fromEntries(states.map((s) => [s.check_key, { right: !!s.last_right, answered: s.answered }])),
      tests: tries ? { attempts: tries.n, passed: !!tries.passed } : null };
  };

  /** one answer into its box */
  async function record(q, personId, programmeId, key, right) {
    const s = (await q('SELECT * FROM {S}.check_state WHERE person_id = @p AND check_key = @k', { p: personId, k: key }))[0];
    const box = right ? Math.min(DAYS.length - 1, s ? s.box + 1 : 1) : 0;
    const due = new Date(Date.now() + DAYS[box] * DAY);
    if (s) {
      await q(`UPDATE {S}.check_state SET box = @b, answered = answered + 1, right_count = right_count + @r, last_right = @r, last_at = SYSUTCDATETIME(), due_at = @due
               WHERE person_id = @p AND check_key = @k`, { b: box, r: right ? 1 : 0, due, p: personId, k: key });
    } else {
      await q(`INSERT INTO {S}.check_state (person_id, check_key, programme_id, box, answered, right_count, first_right, last_right, due_at)
               VALUES (@p, @k, @prog, @b, 1, @r, @r, @r, @due)`, { p: personId, k: key, prog: programmeId, b: box, r: right ? 1 : 0, due });
    }
  }
  const choiceOf = (a) => (Number.isInteger(a?.choice) ? a.choice : -1);

  // ------------------------------------------------------------------ a lesson's quick check
  async function answerChecks(w, id, b) {
    const l = await ctx.lessonById(id); if (!l) return reply(404, { error: 'No such lesson' });
    if (!ctx.editor(w, l.programme_id) && !['published', 'superseded'].includes(l.version_state)) return reply(404, { error: 'No such lesson' });
    const checks = await checksOf(l.lesson_id); if (!checks.length) return reply(404, { error: 'This lesson has no quick check' });
    const answers = Array.isArray(b?.answers) ? b.answers : [];
    const results = checks.map((k) => { const a = answers.find((x) => x?.key === k.key); return a ? { key: k.key, right: choiceOf(a) === k.answer } : null; }).filter(Boolean);
    if (!results.length) return reply(400, { error: 'No answers' });
    const right = results.filter((r) => r.right).length, passed = results.length === checks.length && right === checks.length;
    let attemptNo = 1;
    await db.tx(async (q) => {
      for (const r of results) await record(q, w.person.person_id, l.programme_id, r.key, r.right);
      await ctx.markDay(w.person.person_id, q);
      await audit(q, w, 'lesson.check', 'lesson', l.lesson_id, { lesson: l.title, right, of: results.length }, { programmeId: l.programme_id });
      // every try is kept, for the assessors' overview (Assessing)
      attemptNo = (await q('SELECT COUNT(*) AS n FROM {S}.lesson_test WITH (UPDLOCK, HOLDLOCK) WHERE person_id = @p AND lesson_id = @l', { p: w.person.person_id, l: l.lesson_id }))[0].n + 1;
      await q(`INSERT INTO {S}.lesson_test (test_id, person_id, lesson_id, programme_id, version_id, attempt_no, right_count, question_count, passed, answers)
               VALUES (NEWID(), @p, @l, @prog, @v, @n, @r, @of, @ok, @ans)`,
      { p: w.person.person_id, l: l.lesson_id, prog: l.programme_id, v: l.version_id, n: attemptNo, r: right, of: checks.length, ok: passed ? 1 : 0,
        ans: JSON.stringify(results.map((x) => ({ key: x.key, choice: choiceOf(answers.find((a) => a?.key === x.key)), right: x.right }))) });
    });
    return reply(200, { results, right, of: results.length, passed, attemptNo, badges: await award(w.person) });
  }

  // ------------------------------------------------------------------ refreshers
  /** the questions someone has practised, newest wording of each, with why each is due (or null) */
  async function practised(personId, programmeId) {
    const states = await db.query(`SELECT * FROM {S}.check_state WHERE person_id = @p${programmeId ? ' AND programme_id = @prog' : ''}`, { p: personId, prog: programmeId || null });
    if (!states.length) return [];
    const progs = [...new Set(states.map((s) => s.programme_id))];
    const rows = await db.query(`SELECT c.check_key, c.body, l.lesson_id, l.title AS lesson_title, v.programme_id, v.published_at FROM {S}.lesson_check c
      JOIN {S}.lesson l ON l.lesson_id = c.lesson_id JOIN {S}.programme_version v ON v.version_id = l.version_id
      WHERE v.state IN ('published', 'superseded') AND v.programme_id IN (${progs.map((_, i) => `@g${i}`).join(', ')}) ORDER BY v.published_at DESC`,
    Object.fromEntries(progs.map((g, i) => [`g${i}`, g])));
    const byKey = new Map(); for (const r of rows) if (!byKey.has(r.check_key)) byKey.set(r.check_key, r);
    const changed = new Map((await db.query("SELECT rule_id, MAX(approved_at) AS at FROM {S}.rule_ref WHERE state = 'approved' AND approved_at IS NOT NULL GROUP BY rule_id")).map((r) => [r.rule_id, new Date(r.at)]));
    const now = Date.now();
    return states.filter((s) => byKey.has(s.check_key)).map((s) => {
      const r = byKey.get(s.check_key), k = parse(r);
      const ruleChanged = k.rules.some((id) => changed.get(id) > new Date(s.last_at));
      const why = ruleChanged ? 'rule' : new Date(s.due_at) <= now ? (s.last_right ? 'due' : 'missed') : null;
      return { ...k, lessonId: r.lesson_id, lessonTitle: r.lesson_title, programmeId: s.programme_id, why, dueAt: s.due_at, lastAt: s.last_at };
    });
  }
  const ORDER = { rule: 0, missed: 1, due: 2 };
  const nextDue = (list) => list.filter((x) => !x.why).map((x) => new Date(x.dueAt)).sort((a, b) => a - b)[0] || null;

  async function getRefresher(w, query) {
    const pid = text(query.programme, 32);
    const all = await practised(w.person.person_id, pid);
    const due = all.filter((x) => x.why).sort((a, b) => ORDER[a.why] - ORDER[b.why] || new Date(a.dueAt) - new Date(b.dueAt));
    let questions = due.slice(0, SIZE);
    if (query.more === '1' && questions.length < SIZE) {
      questions = [...questions, ...all.filter((x) => !x.why).sort((a, b) => new Date(a.lastAt) - new Date(b.lastAt)).slice(0, SIZE - questions.length).map((x) => ({ ...x, why: 'extra' }))];
    }
    return reply(200, { questions: questions.map(({ dueAt, lastAt, ...x }) => x), due: due.length, practised: all.length, nextDue: nextDue(all) });
  }
  async function answerRefresher(w, b) {
    const answers = (Array.isArray(b?.answers) ? b.answers : []).slice(0, 20);
    const all = await practised(w.person.person_id, '');
    const results = answers.map((a) => { const k = all.find((x) => x.key === a?.key); return k ? { key: k.key, programmeId: k.programmeId, right: choiceOf(a) === k.answer } : null; }).filter(Boolean);
    if (!results.length) return reply(400, { error: 'No answers' });
    const right = results.filter((r) => r.right).length;
    await db.tx(async (q) => {
      for (const r of results) await record(q, w.person.person_id, r.programmeId, r.key, r.right);
      await ctx.markDay(w.person.person_id, q);
      await audit(q, w, b?.partial ? 'refresher.answer' : 'refresher.done', 'person', w.person.person_id, { right, of: results.length }, { programmeId: results[0].programmeId });
    });
    const after = await practised(w.person.person_id, '');
    return reply(200, { results: results.map(({ key, right: r }) => ({ key, right: r })), right, of: results.length, nextDue: nextDue(after), due: after.filter((x) => x.why).length, streak: await streakOf(w.person.person_id), badges: await award(w.person) });
  }

  // ------------------------------------------------------------------ streak and badges
  async function streakOf(personId) {
    const days = (await db.query('SELECT day FROM {S}.learning_day WHERE person_id = @p AND day >= DATEADD(day, -900, CAST(SYSUTCDATETIME() AS DATE))', { p: personId })).map((r) => r.day);
    return streakFrom(days);
  }
  /** every badge this person could have now, earned or not */
  async function badgesOf(person) {
    const p = person.person_id;
    const enrolments = await db.query(`SELECT e.programme_id, e.version_id, pr.title FROM {S}.enrolment e JOIN {S}.programme pr ON pr.programme_id = e.programme_id
      WHERE e.person_id = @p AND e.state <> 'withdrawn'`, { p });
    const out = [];
    for (const e of enrolments) {
      const countable = await ctx.countableLessons(e.version_id);
      const done = new Set((await db.query('SELECT DISTINCT lesson_id FROM {S}.completion WHERE person_id = @p AND version_id = @v', { p, v: e.version_id })).map((r) => r.lesson_id));
      const n = countable.filter((id) => done.has(id)).length;
      const checks = await db.query(`SELECT c.check_key, s.right_count FROM {S}.lesson_check c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id
        LEFT JOIN {S}.check_state s ON s.check_key = c.check_key AND s.person_id = @p WHERE l.version_id = @v`, { p, v: e.version_id });
      const qualified = (await db.query("SELECT COUNT(*) AS n FROM {S}.credential WHERE person_id = @p AND programme_id = @g AND status IN ('active', 'due')", { p, g: e.programme_id }))[0].n > 0;
      const has = { started: n > 0, halfway: countable.length > 0 && n * 2 >= countable.length, lessons: countable.length > 0 && n === countable.length, sharp: checks.length > 0 && checks.every((c) => c.right_count > 0), qualified };
      // how close: so Learning's Keep sharp bar can say "3 of 5"
      const rightChecks = checks.filter((c) => c.right_count > 0).length;
      const count = { started: [Math.min(n, 1), 1], halfway: [n, Math.ceil(countable.length / 2)], lessons: [n, countable.length], sharp: [rightChecks, checks.length], qualified: [qualified ? 1 : 0, 1] };
      for (const kind of KINDS) out.push({ id: `${e.programme_id}:${kind}`, kind, programmeId: e.programme_id, programmeTitle: e.title, now: has[kind], have: count[kind][0], need: count[kind][1] });
    }
    const streak = await streakOf(p);
    const refreshers = (await db.query("SELECT COUNT(*) AS n FROM {S}.audit_event WHERE action = 'refresher.done' AND entity_type = 'person' AND entity_id = CONVERT(NVARCHAR(64), @p)", { p }))[0].n;
    const overall = { 'streak-4': streak.best >= 4, 'streak-12': streak.best >= 12, 'refresher-5': refreshers >= 5 };
    const count = { 'streak-4': [streak.best, 4], 'streak-12': [streak.best, 12], 'refresher-5': [refreshers, 5] };
    for (const kind of OVERALL) out.push({ id: kind, kind, programmeId: '', programmeTitle: '', now: overall[kind], have: Math.min(count[kind][0], count[kind][1]), need: count[kind][1] });
    return { list: out, streak };
  }
  /** keeps any badge just earned; returns those (and the full list, for the progress page) */
  async function award(person, full = false) {
    const { list, streak } = await badgesOf(person);
    const kept = new Map((await db.query('SELECT badge_id, earned_at FROM {S}.badge WHERE person_id = @p', { p: person.person_id })).map((r) => [r.badge_id, r.earned_at]));
    const fresh = [];
    for (const x of list.filter((b) => b.now && !kept.has(b.id))) {
      try { await db.query('INSERT INTO {S}.badge (person_id, badge_id, programme_id) VALUES (@p, @b, @g)', { p: person.person_id, b: x.id, g: x.programmeId || null }); fresh.push(x); kept.set(x.id, new Date()); }
      catch (e) { if (e.number !== 2627) throw e; } // earned by another request just now
    }
    const view = ({ now, ...x }) => ({ ...x, earned: kept.has(x.id), earnedAt: kept.get(x.id) || null });
    return full ? { badges: list.map(view), fresh: fresh.map(view), streak } : fresh.map(view);
  }
  ctx.award = (person) => award(person);

  async function progress(w) {
    const { badges, streak } = await award(w.person, true);
    const all = await practised(w.person.person_id, '');
    const progs = await db.query("SELECT e.programme_id, p.title FROM {S}.enrolment e JOIN {S}.programme p ON p.programme_id = e.programme_id WHERE e.person_id = @p AND e.state <> 'withdrawn'", { p: w.person.person_id });
    const refresher = progs.map((g) => { const mine = all.filter((x) => x.programmeId === g.programme_id); return { programmeId: g.programme_id, title: g.title, due: mine.filter((x) => x.why).length, practised: mine.length, nextDue: nextDue(mine) }; });
    return reply(200, { streak, badges, refresher });
  }

  async function route(w, method, parts, body, query) {
    const [, a, b, c] = parts;
    if (a === 'lessons' && b && c === 'checks' && method === 'POST') return answerChecks(w, b, body);
    if (a === 'refresher' && !b && method === 'GET') return getRefresher(w, query);
    if (a === 'refresher' && !b && method === 'POST') return answerRefresher(w, body);
    if (a === 'progress' && !b && method === 'GET') return progress(w);
    return null;
  }
  return { route };
}

module.exports = { createChecks, streakFrom, weekOf, DAYS };
