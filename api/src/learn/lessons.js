'use strict';
/* Lessons (step 3): a lesson's content in a language, the bookmark, completing it, writing and approving content versions and
   translations, narration, and the media settings (LRN-02..05, LRN-07, CNT-01, NFR-05, NFR-06, AT-04, AT-05, AT-11).

   GET  /api/learn/lessons/<id>?locale=&content=   -> { lesson, module, programme, version, content, locales, media, progress, completion, nav }
   PUT  /api/learn/lessons/<id>/progress {contentId, slide}     the bookmark
   POST /api/learn/lessons/<id>/complete {contentId}            -> { completion, enrolment }   enrolled learners
   POST /api/learn/lessons/<id>/content {locale, slides, sources, translationOf?, translatedBy?}  a new draft content version (editors)
   PUT  /api/learn/content/<id> {slides, sources}               a draft only
   POST /api/learn/content/<id>/state {to}                      draft -> review -> published (owner; never the one who sent it), -> draft
   GET  /api/learn/content/<id>/narration/<slide>               -> { url }   that slide's narration (Azure AI Speech), made once
   GET  /api/learn/media                                        -> { configs, providers, voices }   PUT /api/learn/media/<scope> {provider, voices}
   Learners see published content; a translation sent for review shows as a Preview translation (NFR-06), and completing a lesson
   in one is recorded but doesn't count towards a credential until done in an approved language. */
const crypto = require('node:crypto');
const { createMedia, PROVIDERS, VOICES } = require('./media');

const MAX_SLIDES = 40;
const ACTIONS = ['free-camera', 'practice-camera'];
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createLessons(ctx, { speech, mediaSigner }) {
  const { db, reply, P, audit, uuid, text, isUuid } = ctx;
  const media = createMedia({ db, speech, signer: mediaSigner });
  ctx.media = media;
  const lessonById = async (id) => (isUuid(id) ? (await db.query(`SELECT l.*, m.title AS module_title, m.code AS module_code, m.seq AS module_seq, v.programme_id, v.state AS version_state, v.edition, p.title AS programme_title, p.demo, p.locales
      FROM {S}.lesson l JOIN {S}.module m ON m.module_id = l.module_id JOIN {S}.programme_version v ON v.version_id = l.version_id JOIN {S}.programme p ON p.programme_id = v.programme_id
      WHERE l.lesson_id = @id`, { id }))[0] || null : null);
  const contentById = async (id) => (isUuid(id) ? (await db.query('SELECT * FROM {S}.content_version WHERE content_id = @id', { id }))[0] || null : null);
  const isPreview = (c) => !!c.translation_of && c.state === 'review';
  const contentView = (c) => c && ({ id: c.content_id, lessonId: c.lesson_id, locale: c.locale, versionNo: c.version_no, state: c.state, preview: isPreview(c),
    translationOf: c.translation_of || '', slides: JSON.parse(c.body).slides || [], sources: c.sources, translatedBy: c.translated_by || '',
    sourceHash: c.source_hash, createdAt: c.created_at, submittedAt: c.submitted_at, approvedAt: c.approved_at });
  ctx.contentView = contentView; ctx.contentById = contentById; ctx.lessonById = lessonById;

  /** content a learner may see for a lesson: published, or a translation in review (a preview) */
  async function learnerContent(lessonId) {
    return db.query("SELECT * FROM {S}.content_version WHERE lesson_id = @l AND (state = 'published' OR (state = 'review' AND translation_of IS NOT NULL)) ORDER BY version_no DESC", { l: lessonId });
  }
  /** lessons that count: those with published content (a shell still being written doesn't) */
  async function countableLessons(versionId) {
    return (await db.query("SELECT DISTINCT l.lesson_id FROM {S}.lesson l JOIN {S}.content_version c ON c.lesson_id = l.lesson_id AND c.state = 'published' WHERE l.version_id = @v", { v: versionId })).map((r) => r.lesson_id);
  }
  ctx.countableLessons = countableLessons;
  async function doneLessons(personId, versionId, { counting = false } = {}) {
    return (await db.query(`SELECT DISTINCT c.lesson_id FROM {S}.completion c WHERE c.person_id = @p AND c.version_id = @v${counting ? ' AND c.preview = 0' : ''}`, { p: personId, v: versionId })).map((r) => r.lesson_id);
  }

  // progress on a programme's page, the record and the overview (programmes.js asks through these hooks)
  ctx.progressOf = async (e) => {
    const total = await countableLessons(e.version_id), done = new Set(await doneLessons(e.person_id, e.version_id));
    return { lessons: total.length, done: total.filter((id) => done.has(id)).length };
  };
  const prevExtras = ctx.programmeExtras;
  ctx.programmeExtras = async (w, p, v, e) => {
    const base = prevExtras ? await prevExtras(w, p, v, e) : {};
    const countable = new Set(await countableLessons(v.version_id));
    const done = e && e.version_id === v.version_id ? await doneLessons(w.person.person_id, v.version_id) : [];
    const lessons = await db.query('SELECT l.lesson_id FROM {S}.lesson l JOIN {S}.module m ON m.module_id = l.module_id WHERE l.version_id = @v ORDER BY m.seq, l.seq', { v: v.version_id });
    const lessonNotes = Object.fromEntries(lessons.filter((l) => !countable.has(l.lesson_id)).map((l) => [l.lesson_id, 'being written']));
    const next = lessons.find((l) => countable.has(l.lesson_id) && !done.includes(l.lesson_id));
    return { ...base, completed: done, lessonNotes, progress: e ? { done: done.filter((id) => countable.has(id)).length, total: countable.size } : null, nextLesson: next?.lesson_id || null };
  };
  // a new programme version takes the content too: the same published content, carried over to the new lessons
  const prevCopy = ctx.copyVersionExtras;
  ctx.copyVersionExtras = async (q, from, vid, moduleMap, lessonMap) => {
    if (prevCopy) await prevCopy(q, from, vid, moduleMap, lessonMap);
    const contents = await q("SELECT * FROM {S}.content_version WHERE lesson_id IN (SELECT lesson_id FROM {S}.lesson WHERE version_id = @v) AND state IN ('published', 'review')", { v: from.version_id });
    const ids = new Map();
    // a translation whose English wasn't copied (it was superseded) points at the copied published English of its lesson
    const englishFor = (c) => { const en = contents.find((x) => x.lesson_id === c.lesson_id && x.locale === 'en' && x.state === 'published'); return en ? ids.get(en.content_id) || null : null; };
    for (const c of contents.sort((a, b) => (a.translation_of ? 1 : 0) - (b.translation_of ? 1 : 0))) {
      const nid = uuid(); ids.set(c.content_id, nid);
      await q(`INSERT INTO {S}.content_version (content_id, lesson_id, locale, version_no, state, translation_of, body, source_hash, sources, translated_by, author_id, approved_by, approved_at, submitted_by, submitted_at)
               VALUES (@id, @l, @loc, @no, @state, @tr, @body, @hash, @src, @tb, @a, @ab, @at, @sb, @sat)`,
      { id: nid, l: lessonMap.get(c.lesson_id), loc: c.locale, no: c.version_no, state: c.state, tr: c.translation_of ? ids.get(c.translation_of) || englishFor(c) : null, body: c.body, hash: c.source_hash, src: c.sources, tb: c.translated_by, a: c.author_id, ab: c.approved_by, at: c.approved_at, sb: c.submitted_by, sat: c.submitted_at });
    }
  };
  const prevDelete = ctx.beforeDeleteLessons;
  ctx.beforeDeleteLessons = async (q, ids) => {
    if (prevDelete) await prevDelete(q, ids);
    for (const id of ids) {
      await q('DELETE FROM {S}.media_asset WHERE content_id IN (SELECT content_id FROM {S}.content_version WHERE lesson_id = @id)', { id });
      await q('DELETE FROM {S}.lesson_progress WHERE lesson_id = @id', { id });
      await q('DELETE FROM {S}.completion WHERE lesson_id = @id', { id });
      await q('DELETE FROM {S}.content_version WHERE lesson_id = @id', { id });
    }
  };

  /** has this enrolment met its programme's completion rule? If so it's marked completed, and onComplete (credentials) runs */
  ctx.checkCompletion = async (q, enrolmentId, w) => {
    const e = (await q('SELECT e.*, v.completion_rule FROM {S}.enrolment e JOIN {S}.programme_version v ON v.version_id = e.version_id WHERE e.enrolment_id = @id', { id: enrolmentId }))[0];
    if (!e || e.state !== 'active') return e;
    const rule = e.completion_rule;
    const countable = await countableLessons(e.version_id), done = new Set(await doneLessons(e.person_id, e.version_id, { counting: true }));
    const lessonsOk = countable.length > 0 && countable.every((id) => done.has(id));
    const assessOk = ctx.assessmentPassed ? await ctx.assessmentPassed(q, e) : false;
    const complete = rule === 'lessons' ? lessonsOk : rule === 'assessment' ? assessOk : lessonsOk && assessOk;
    if (!complete) return e;
    const moved = await q("UPDATE {S}.enrolment SET state = 'completed', completed_at = SYSUTCDATETIME() OUTPUT inserted.enrolment_id WHERE enrolment_id = @id AND state = 'active'", { id: e.enrolment_id });
    if (!moved.length) return { ...e, state: 'completed' }; // someone else's request completed it just now
    await audit(q, w, 'enrolment.complete', 'enrolment', e.enrolment_id, { rule }, { programmeId: e.programme_id });
    if (ctx.onComplete) await ctx.onComplete(q, { ...e, state: 'completed' }, w);
    return { ...e, state: 'completed' };
  };

  // ------------------------------------------------------------------ one lesson
  async function getLesson(w, id, query) {
    const l = await lessonById(id); if (!l) return reply(404, { error: 'No such lesson' });
    const canEdit = ctx.editor(w, l.programme_id), canApprove = P.can(w.grants, 'content.approve', { programmeId: l.programme_id });
    if (!canEdit && !['published', 'superseded'].includes(l.version_state)) return reply(404, { error: 'No such lesson' });
    const visible = canEdit ? await db.query('SELECT * FROM {S}.content_version WHERE lesson_id = @l ORDER BY version_no DESC', { l: l.lesson_id }) : await learnerContent(l.lesson_id);
    const forLearners = await learnerContent(l.lesson_id);
    // the best content in each language: published, then a preview translation (and for editors, the newest draft)
    const best = (locale, list) => list.filter((c) => c.locale === locale).sort((a, b) => (a.state === 'published' ? -1 : 0) - (b.state === 'published' ? -1 : 0) || b.version_no - a.version_no)[0];
    const locales = [...new Set(forLearners.map((c) => c.locale))].sort((a, b) => (a === "en" ? -1 : b === "en" ? 1 : a.localeCompare(b))).map((loc) => { const c = best(loc, forLearners); return { locale: loc, contentId: c.content_id, state: c.state, preview: isPreview(c), versionNo: c.version_no }; });
    const person = w.person, wanted = String(query.locale || '') || (locales.some((x) => x.locale === person.locale) ? person.locale : 'en');
    let c = query.content && canEdit ? visible.find((x) => x.content_id.toLowerCase() === String(query.content).toLowerCase()) : null;
    c = c || best(wanted, forLearners) || best('en', forLearners) || (canEdit ? visible[0] : null);
    const e = (await db.query("SELECT TOP 1 * FROM {S}.enrolment WHERE person_id = @p AND version_id = @v AND state <> 'withdrawn'", { p: person.person_id, v: l.version_id }))[0];
    const progress = (await db.query('SELECT * FROM {S}.lesson_progress WHERE person_id = @p AND lesson_id = @l', { p: person.person_id, l: l.lesson_id }))[0];
    const completions = await db.query('SELECT * FROM {S}.completion WHERE person_id = @p AND lesson_id = @l ORDER BY completed_at', { p: person.person_id, l: l.lesson_id });
    // the lessons before and after, in programme order
    const order = await db.query('SELECT l.lesson_id, l.title FROM {S}.lesson l JOIN {S}.module m ON m.module_id = l.module_id WHERE l.version_id = @v ORDER BY m.seq, l.seq', { v: l.version_id });
    const at = order.findIndex((x) => x.lesson_id === l.lesson_id);
    const rules = c && ctx.rulesFor ? await ctx.rulesFor(JSON.parse(c.body).slides || [], l.programme_id) : [];
    return reply(200, {
      lesson: ctx.lessonView(l), module: { title: l.module_title, code: l.module_code || '', seq: l.module_seq },
      programme: { id: l.programme_id, title: l.programme_title, demo: !!l.demo, locales: String(l.locales).split(',') },
      version: { id: l.version_id, edition: l.edition, state: l.version_state },
      content: contentView(c), locales, media: c ? await media.plan(c, l.programme_id) : null, rules,
      progress: progress ? { contentId: progress.content_id, slide: progress.slide, locale: progress.locale } : null,
      completions: completions.map((x) => ({ at: x.completed_at, locale: x.locale, preview: !!x.preview, versionNo: x.content_version })),
      enrolled: !!e, enrolmentState: e?.state || '',
      nav: { prev: order[at - 1]?.lesson_id || null, next: order[at + 1]?.lesson_id || null, nextTitle: order[at + 1]?.title || '' },
      drafts: canEdit ? visible.map((x) => ({ id: x.content_id, locale: x.locale, versionNo: x.version_no, state: x.state, preview: isPreview(x), translationOf: x.translation_of || '', submittedBy: x.submitted_by || '', createdAt: x.created_at })) : [],
      can: { edit: canEdit, approve: canApprove },
      extra: ctx.lessonExtras ? await ctx.lessonExtras(w, l, c) : {},
    });
  }

  async function saveProgress(w, id, b) {
    const l = await lessonById(id); const c = await contentById(b?.contentId);
    if (!l || !c || c.lesson_id !== l.lesson_id) return reply(404, { error: 'No such lesson' });
    const slide = Math.max(0, Math.min(MAX_SLIDES, Math.floor(Number(b?.slide) || 0)));
    await db.query(`MERGE {S}.lesson_progress AS t USING (SELECT @p AS person_id, @l AS lesson_id) AS s ON t.person_id = s.person_id AND t.lesson_id = s.lesson_id
      WHEN MATCHED THEN UPDATE SET content_id = @c, locale = @loc, slide = @slide, updated_at = SYSUTCDATETIME()
      WHEN NOT MATCHED THEN INSERT (person_id, lesson_id, content_id, locale, slide) VALUES (@p, @l, @c, @loc, @slide);`, { p: w.person.person_id, l: l.lesson_id, c: c.content_id, loc: c.locale, slide });
    return reply(200, { ok: true });
  }

  async function complete(w, id, b) {
    const l = await lessonById(id), c = await contentById(b?.contentId);
    if (!l || !c || c.lesson_id !== l.lesson_id) return reply(404, { error: 'No such lesson' });
    if (!(c.state === 'published' || isPreview(c))) return reply(409, { error: 'Only published content can be completed' });
    const e = (await db.query("SELECT TOP 1 * FROM {S}.enrolment WHERE person_id = @p AND version_id = @v AND state <> 'withdrawn'", { p: w.person.person_id, v: l.version_id }))[0];
    if (!e) return reply(403, { error: 'Enrol in the programme to record your progress' });
    const had = (await db.query('SELECT * FROM {S}.completion WHERE person_id = @p AND lesson_id = @l AND locale = @loc', { p: w.person.person_id, l: l.lesson_id, loc: c.locale }))[0];
    let enrolment = e;
    await db.tx(async (q) => {
      if (had && had.preview && !isPreview(c)) {
        await q('UPDATE {S}.completion SET preview = 0, content_id = @c, content_version = @cv, source_hash = @hash, completed_at = SYSUTCDATETIME() WHERE completion_id = @id', { c: c.content_id, cv: c.version_no, hash: c.source_hash, id: had.completion_id });
        await audit(q, w, 'lesson.complete', 'completion', had.completion_id, { lesson: l.title, locale: c.locale, contentVersion: c.version_no, preview: false, wasPreview: true }, { programmeId: l.programme_id });
      }
      if (!had) {
        const cid = uuid();
        await q(`INSERT INTO {S}.completion (completion_id, person_id, enrolment_id, programme_id, version_id, lesson_id, content_id, content_version, source_hash, locale, preview)
                 VALUES (@id, @p, @e, @prog, @v, @l, @c, @cv, @hash, @loc, @prev)`,
        { id: cid, p: w.person.person_id, e: e.enrolment_id, prog: l.programme_id, v: l.version_id, l: l.lesson_id, c: c.content_id, cv: c.version_no, hash: c.source_hash, loc: c.locale, prev: isPreview(c) ? 1 : 0 });
        await audit(q, w, 'lesson.complete', 'completion', cid, { lesson: l.title, locale: c.locale, contentVersion: c.version_no, preview: isPreview(c) }, { programmeId: l.programme_id });
      }
      enrolment = await ctx.checkCompletion(q, e.enrolment_id, w);
    });
    return reply(200, { completed: true, preview: isPreview(c), enrolment: { id: e.enrolment_id, state: enrolment?.state || e.state } });
  }

  // ------------------------------------------------------------------ writing and approving content
  function readSlides(raw) {
    if (!Array.isArray(raw) || !raw.length || raw.length > MAX_SLIDES) return { error: `A lesson has 1 to ${MAX_SLIDES} slides` };
    const slides = raw.map((s) => ({
      heading: text(s?.heading, 160), points: (Array.isArray(s?.points) ? s.points : []).map((p) => text(p, 400)).filter(Boolean).slice(0, 12),
      narration: String(s?.narration ?? '').replace(/[\u0000-\u0008\u000b-\u001f]/g, ' ').trim().slice(0, 3000),
      rules: (Array.isArray(s?.rules) ? s.rules : []).map((r) => text(r, 60)).filter(Boolean).slice(0, 10),
      figure: text(s?.figure, 40) || '', note: text(s?.note, 600) || '', review: text(s?.review, 600) || '',
      // a box under the slide: the free camera, or booking a practice server (the camera course's last lesson)
      ...(ACTIONS.includes(s?.action) ? { action: s.action } : {}),
    }));
    if (slides.some((s) => !s.heading)) return { error: 'Every slide needs a heading' };
    return { slides };
  }
  async function newContent(w, id, b) {
    const l = await lessonById(id); if (!l) return reply(404, { error: 'No such lesson' });
    if (!P.can(w.grants, 'content.draft', { programmeId: l.programme_id })) return reply(403, { error: 'Only the programme\'s editors write content' });
    const locale = String(b?.locale || 'en');
    if (!String(l.locales).split(',').includes(locale)) return reply(400, { error: 'The programme isn\'t offered in that language' });
    const s = readSlides(b?.slides); if (s.error) return reply(400, { error: s.error });
    let translationOf = null;
    if (locale !== 'en') {
      const src = b?.translationOf ? await contentById(b.translationOf) : (await db.query("SELECT TOP 1 * FROM {S}.content_version WHERE lesson_id = @l AND locale = 'en' AND state = 'published' ORDER BY version_no DESC", { l: l.lesson_id }))[0];
      if (!src || src.lesson_id !== l.lesson_id || src.locale !== 'en') return reply(409, { error: 'A translation needs published English content to translate' });
      translationOf = src.content_id;
    }
    const body = JSON.stringify({ slides: s.slides }), cid = uuid();
    const no = ((await db.query('SELECT MAX(version_no) AS n FROM {S}.content_version WHERE lesson_id = @l AND locale = @loc', { l: l.lesson_id, loc: locale }))[0].n || 0) + 1;
    await db.tx(async (q) => {
      await q(`INSERT INTO {S}.content_version (content_id, lesson_id, locale, version_no, translation_of, body, source_hash, sources, translated_by, author_id)
               VALUES (@id, @l, @loc, @no, @tr, @body, @hash, @src, @tb, @a)`,
      { id: cid, l: l.lesson_id, loc: locale, no, tr: translationOf, body, hash: hash(body), src: text(b?.sources, 1000), tb: translationOf ? text(b?.translatedBy, 80) || null : null, a: w.person.person_id });
      await audit(q, w, 'content.create', 'content_version', cid, { lesson: l.title, locale, versionNo: no, translationOf }, { programmeId: l.programme_id });
    });
    return reply(200, { content: contentView(await contentById(cid)) });
  }
  async function editContent(w, id, b) {
    const c = await contentById(id); if (!c) return reply(404, { error: 'No such content' });
    const l = await lessonById(c.lesson_id);
    if (!P.can(w.grants, 'content.draft', { programmeId: l.programme_id })) return reply(403, { error: 'Only the programme\'s editors write content' });
    if (c.state !== 'draft') return reply(409, { error: `This content is ${c.state}: only a draft changes. Make a new version instead` });
    const s = b?.slides !== undefined ? readSlides(b.slides) : { slides: JSON.parse(c.body).slides };
    if (s.error) return reply(400, { error: s.error });
    const body = JSON.stringify({ slides: s.slides });
    await db.tx(async (q) => {
      await q('UPDATE {S}.content_version SET body = @body, source_hash = @hash, sources = @src WHERE content_id = @id', { body, hash: hash(body), src: b?.sources !== undefined ? text(b.sources, 1000) : c.sources, id: c.content_id });
      await audit(q, w, 'content.edit', 'content_version', c.content_id, { lesson: l.title, locale: c.locale, versionNo: c.version_no, before: c.source_hash.slice(0, 12), after: hash(body).slice(0, 12) }, { programmeId: l.programme_id });
    });
    return reply(200, { content: contentView(await contentById(c.content_id)) });
  }
  async function contentState(w, id, b) {
    const c = await contentById(id); if (!c) return reply(404, { error: 'No such content' });
    const l = await lessonById(c.lesson_id), to = String(b?.to || ''), pid = l.programme_id;
    const allowed = { draft: ['review'], review: ['published', 'draft'], published: [], superseded: [] }[c.state] || [];
    if (!allowed.includes(to)) return reply(409, { error: `${c.state} content can't become ${to}` });
    if (to === 'review' && !P.can(w.grants, 'content.draft', { programmeId: pid })) return reply(403, { error: 'Only the programme\'s editors send content for review' });
    if (to !== 'review' && !P.can(w.grants, 'content.approve', { programmeId: pid })) return reply(403, { error: 'Only the programme\'s owner or an admin approves content' });
    if (to === 'published' && c.submitted_by === w.person.person_id && !P.can(w.grants, 'programme.create')) return reply(403, { error: 'Someone else must approve what you sent for review' });
    if (to === 'published' && ctx.beforeContentPublish) { const why = await ctx.beforeContentPublish(c, l); if (why) return reply(409, { error: why }); }
    await db.tx(async (q) => {
      if (to === 'review') await q('UPDATE {S}.content_version SET state = @to, submitted_by = @by, submitted_at = SYSUTCDATETIME() WHERE content_id = @id', { to, by: w.person.person_id, id: c.content_id });
      else if (to === 'published') {
        await q("UPDATE {S}.content_version SET state = 'superseded' WHERE lesson_id = @l AND locale = @loc AND state IN ('published', 'review') AND content_id <> @id", { l: c.lesson_id, loc: c.locale, id: c.content_id });
        await q('UPDATE {S}.content_version SET state = @to, approved_by = @by, approved_at = SYSUTCDATETIME() WHERE content_id = @id', { to, by: w.person.person_id, id: c.content_id });
      } else await q('UPDATE {S}.content_version SET state = @to WHERE content_id = @id', { to, id: c.content_id });
      await audit(q, w, `content.${to}`, 'content_version', c.content_id, { lesson: l.title, locale: c.locale, versionNo: c.version_no, from: c.state, sourceHash: c.source_hash.slice(0, 12) }, { programmeId: pid });
    });
    return reply(200, { content: contentView(await contentById(c.content_id)) });
  }

  // ------------------------------------------------------------------ narration and the media settings
  async function narrationLink(w, id, slide, query) {
    const c = await contentById(id); if (!c) return reply(404, { error: 'No such content' });
    const l = await lessonById(c.lesson_id);
    const editor = ctx.editor(w, l.programme_id);
    if (!editor && !((c.state === 'published' || isPreview(c)) && ['published', 'superseded'].includes(l.version_state))) return reply(404, { error: 'No such content' });
    const plan = await media.plan(c, l.programme_id), voice = String(query.voice || plan.voice);
    if (!(VOICES[c.locale] || []).includes(voice)) return reply(400, { error: 'No such voice for this language' });
    const n = Math.floor(Number(slide) || 0);
    if (n < 0 || n >= MAX_SLIDES) return reply(404, { error: 'No such slide' });
    try { return reply(200, { url: await media.narration(c, n, voice), voice }); }
    catch (e) { return reply(e.status || 502, { error: e.status ? e.message : 'The narration couldn\'t be made just now: the captions are below' }); }
  }
  async function mediaSettings(w, method, scope, b) {
    if (method === 'GET') {
      if (!P.can(w.grants, 'programme.create') && !w.grants.some((g) => g.role === 'programme_owner')) return reply(403, { error: 'Only admins and programme owners change the media settings' });
      const rows = await db.query('SELECT * FROM {S}.media_config ORDER BY scope');
      const progs = await db.query('SELECT programme_id, title FROM {S}.programme ORDER BY title');
      const scopes = [{ id: 'default', title: 'Every programme (default)' }, ...progs.map((p) => ({ id: p.programme_id, title: p.title }))];
      return reply(200, { scopes: await Promise.all(scopes.map(async (s) => ({ ...s, set: !!rows.find((r) => r.scope === s.id), ...(await media.configFor(s.id === 'default' ? '' : s.id)) }))),
        providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, ...p })), voices: VOICES, speechOn: media.speechOn });
    }
    if (method !== 'PUT') return null;
    const sc = String(scope || '');
    if (sc === 'default' ? !P.can(w.grants, 'programme.create') : !(await ctx.progById(sc)) || !P.can(w.grants, 'programme.edit', { programmeId: sc })) return reply(403, { error: 'You can\'t change that programme\'s media' });
    if (!PROVIDERS[b?.provider]) return reply(400, { error: 'No such provider' });
    const voices = {};
    for (const [loc, v] of Object.entries(b?.voices || {})) if ((VOICES[loc] || []).includes(v)) voices[loc] = v;
    const before = await media.configFor(sc === 'default' ? '' : sc);
    await db.tx(async (q) => {
      await q(`MERGE {S}.media_config AS t USING (SELECT @s AS scope) AS s ON t.scope = s.scope
        WHEN MATCHED THEN UPDATE SET provider = @p, voices = @v, updated_by = @by, updated_at = SYSUTCDATETIME()
        WHEN NOT MATCHED THEN INSERT (scope, provider, voices, updated_by) VALUES (@s, @p, @v, @by);`, { s: sc, p: b.provider, v: JSON.stringify(voices), by: w.person.person_id });
      await audit(q, w, 'media.config', 'media_config', sc, { before: { provider: before.provider, voices: before.voices }, after: { provider: b.provider, voices } }, { programmeId: sc === 'default' ? null : sc });
    });
    return mediaSettings(w, 'GET');
  }

  async function route(w, method, parts, body, query) {
    const [, a, b, c, d] = parts;
    if (a === 'lessons' && b && !c && method === 'GET') return getLesson(w, b, query);
    if (a === 'lessons' && b && c === 'progress' && method === 'PUT') return saveProgress(w, b, body);
    if (a === 'lessons' && b && c === 'complete' && method === 'POST') return complete(w, b, body);
    if (a === 'lessons' && b && c === 'content' && method === 'POST') return newContent(w, b, body);
    if (a === 'content' && b && !c && method === 'PUT') return editContent(w, b, body);
    if (a === 'content' && b && c === 'state' && method === 'POST') return contentState(w, b, body);
    if (a === 'content' && b && c === 'narration' && d !== undefined && method === 'GET') return narrationLink(w, b, d, query);
    if (a === 'media') return mediaSettings(w, method, b, body);
    return null;
  }
  return { route };
}

module.exports = { createLessons };
