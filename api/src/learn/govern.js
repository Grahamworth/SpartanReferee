'use strict';
/* Governance (step 5): rule references and their versions, what links to each, review items, and the handbook (RUL-01..04, CNT-01,
   LRN-06, AT-06, AT-07).

   GET  /api/learn/rules?programme=                  -> { documents, rules }   every rule reference, its current version and links
   GET  /api/learn/rules/<rule id>                   -> { rule, versions, links, reviews }
   POST /api/learn/rules {programmeId, docId, ruleId, section, title, excerpt, citation}   a new rule reference (draft)
   POST /api/learn/rules/<rule id>/versions {title, excerpt, effectiveDate, changeNote}    a change: a draft version, and a review item
                                                     listing every lesson and question it affects. Published content stays as it is.
   POST /api/learn/rule-versions/<key>/state {to: approved | withdrawn}   approvers; never the person who drafted it (unless an admin)
   GET  /api/learn/reviews?programme=&state=         -> { reviews }    POST /api/learn/reviews/<id> {state: resolved | dismissed, resolution}
   GET  /api/learn/handbook/<programme id>?locale=   -> the published programme as a handbook: its lessons, rule references and open
                                                     review items, stamped with edition, language, approval state and date (the page
                                                     makes the PDF) */
function createGovern(ctx) {
  const { db, reply, P, audit, uuid, text, isUuid } = ctx;
  const RULE_ID = /^[A-Z]{2,8}-\d{4}-[\w.]{1,20}$/;
  const DOC_STATE = { baseline: '2026 baseline: not approved for 2027', approved: 'Approved', draft: 'Draft' };

  // ------------------------------------------------------------------ links: rebuilt from what content and questions say they teach
  async function syncLinks(q = db.query) {
    const current = new Map((await q("SELECT rule_id, MAX(version_no) AS v FROM {S}.rule_ref WHERE state = 'approved' GROUP BY rule_id")).map((r) => [r.rule_id, r.v]));
    const latest = new Map((await q('SELECT rule_id, MAX(version_no) AS v FROM {S}.rule_ref GROUP BY rule_id')).map((r) => [r.rule_id, r.v]));
    const want = [];
    for (const c of await q("SELECT c.content_id, c.lesson_id, c.body, l.version_id FROM {S}.content_version c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id WHERE c.state IN ('draft', 'review', 'published')")) {
      const ids = new Set((JSON.parse(c.body).slides || []).flatMap((s) => s.rules || []));
      for (const id of ids) want.push({ rule: id, type: 'content', target: c.content_id, lesson: c.lesson_id, version: c.version_id });
    }
    for (const qu of await q('SELECT q.question_id, q.rules, a.version_id FROM {S}.question q JOIN {S}.assessment a ON a.assessment_id = q.assessment_id')) {
      for (const id of qu.rules.split(',').filter(Boolean)) want.push({ rule: id, type: 'question', target: qu.question_id, lesson: null, version: qu.version_id });
    }
    const have = new Set((await q('SELECT rule_id, target_type, target_id FROM {S}.rule_link')).map((r) => `${r.rule_id}|${r.target_type}|${String(r.target_id).toLowerCase()}`));
    const keep = new Set(), add = [];
    for (const w of want) {
      const k = `${w.rule}|${w.type}|${String(w.target).toLowerCase()}`; keep.add(k);
      if (!have.has(k)) { have.add(k); add.push(w); }
    }
    // new links go in batches (every translation of a lesson cites its rules, so there can be thousands), each row on its own only
    // when a batch meets one that's there already (another rebuild got there first)
    const one = async (w) => {
      try { await q('INSERT INTO {S}.rule_link (rule_id, rule_version, target_type, target_id, lesson_id, version_id) VALUES (@r, @rv, @t, @id, @l, @v)', { r: w.rule, rv: current.get(w.rule) || latest.get(w.rule) || 0, t: w.type, id: w.target, l: w.lesson, v: w.version }); }
      catch (e) { if (e.number !== 2627) throw e; }
    };
    for (let i = 0; i < add.length; i += 300) {
      const batch = add.slice(i, i + 300), p = {};
      const rows = batch.map((w, j) => { Object.assign(p, { [`r${j}`]: w.rule, [`rv${j}`]: current.get(w.rule) || latest.get(w.rule) || 0, [`t${j}`]: w.type, [`id${j}`]: w.target, [`l${j}`]: w.lesson, [`v${j}`]: w.version }); return `(@r${j}, @rv${j}, @t${j}, @id${j}, @l${j}, @v${j})`; });
      try { await q(`INSERT INTO {S}.rule_link (rule_id, rule_version, target_type, target_id, lesson_id, version_id) VALUES ${rows.join(', ')}`, p); }
      catch (e) { if (e.number !== 2627) throw e; for (const w of batch) await one(w); }
    }
    for (const k of have) if (!keep.has(k)) { const [r, t, id] = k.split('|'); await q('DELETE FROM {S}.rule_link WHERE rule_id = @r AND target_type = @t AND target_id = @id', { r, t, id }); }
  }
  // one rebuild at a time, after anything that changes content or questions (index.js), and once when this process first shows rules
  let syncing = Promise.resolve(), firstSync = null;
  const syncLinksSafe = () => (syncing = syncing.then(() => syncLinks()).catch((e) => console.error(`rule links: ${e.message}`)));
  ctx.syncLinks = syncLinksSafe;
  const linksReady = () => (firstSync = firstSync || syncLinksSafe());
  /** everything that teaches or tests a rule, with where it sits */
  async function affectedBy(ruleId, q = db.query) {
    // with the lesson's module and programme, so a rule's page can say where it applies in words (20 November 2026)
    const content = await q(`SELECT k.rule_version, c.content_id, c.locale, c.version_no, c.state, l.lesson_id, l.title, l.seq, m.title AS module, m.seq AS mseq, p.title AS programme,
        v.version_id, v.edition, v.state AS vstate, v.programme_id
      FROM {S}.rule_link k JOIN {S}.content_version c ON c.content_id = k.target_id JOIN {S}.lesson l ON l.lesson_id = c.lesson_id JOIN {S}.module m ON m.module_id = l.module_id
        JOIN {S}.programme_version v ON v.version_id = l.version_id JOIN {S}.programme p ON p.programme_id = v.programme_id
      WHERE k.rule_id = @r AND k.target_type = 'content'`, { r: ruleId });
    const questions = await q(`SELECT k.rule_version, qu.question_id, qu.prompt, a.title AS assessment, a.assessment_id, p.title AS programme, v.version_id, v.edition, v.state AS vstate, v.programme_id
      FROM {S}.rule_link k JOIN {S}.question qu ON qu.question_id = k.target_id JOIN {S}.assessment a ON a.assessment_id = qu.assessment_id JOIN {S}.programme_version v ON v.version_id = a.version_id
        JOIN {S}.programme p ON p.programme_id = v.programme_id
      WHERE k.rule_id = @r AND k.target_type = 'question'`, { r: ruleId });
    return [
      ...content.map((c) => ({ type: 'lesson', id: c.lesson_id, contentId: c.content_id, title: `${c.title} (${c.locale} v${c.version_no}, ${c.state})`, edition: c.edition, programmeVersion: c.version_id, versionState: c.vstate, ruleVersion: c.rule_version,
        lessonTitle: c.title, lessonSeq: c.seq, module: c.module, moduleSeq: c.mseq, programme: c.programme, programmeId: c.programme_id, locale: c.locale, contentState: c.state })),
      ...questions.map((x) => ({ type: 'question', id: x.question_id, assessmentId: x.assessment_id, title: `${x.assessment}: ${x.prompt.slice(0, 90)}`, edition: x.edition, programmeVersion: x.version_id, versionState: x.vstate, ruleVersion: x.rule_version,
        prompt: x.prompt, assessment: x.assessment, programme: x.programme, programmeId: x.programme_id })),
    ];
  }
  const ruleView = (r, doc, open = 0) => r && ({ key: r.rule_key, id: r.rule_id, versionNo: r.version_no, programmeId: r.programme_id, docId: r.doc_id, section: r.section, title: r.title,
    excerpt: r.excerpt, citation: r.citation, effectiveDate: r.effective_date, ruleState: r.state, changeNote: r.change_note, createdAt: r.created_at, approvedAt: r.approved_at,
    docTitle: doc?.title || '', docApproval: doc?.approval || '', openReviews: open,
    state: open ? 'under_review' : doc?.approval === 'baseline' ? 'baseline' : r.state, stateText: open ? 'Under review' : doc?.approval === 'baseline' ? DOC_STATE.baseline : r.state });
  /** the rules a lesson's slides or a question cite, with their state, for the rule chips */
  ctx.rulesFor = async (slides, programmeId) => {
    const ids = [...new Set(slides.flatMap((s) => s.rules || []).filter(Boolean))]; if (!ids.length) return [];
    const rows = await db.query(`SELECT r.*, d.title AS doc_title, d.approval, (SELECT COUNT(*) FROM {S}.review_item i WHERE i.rule_id = r.rule_id AND i.state = 'open') AS open_reviews
      FROM {S}.rule_ref r JOIN {S}.rule_document d ON d.doc_id = r.doc_id WHERE r.programme_id = @p AND r.rule_id IN (${ids.map((_, i) => `@r${i}`).join(', ')}) AND r.state IN ('approved', 'draft')`,
    { p: programmeId, ...Object.fromEntries(ids.map((id, i) => [`r${i}`, id])) });
    return ids.map((id) => { const r = rows.filter((x) => x.rule_id === id).sort((a, b) => (a.state === 'approved' ? -1 : 1) - (b.state === 'approved' ? -1 : 1) || b.version_no - a.version_no)[0]; return r ? ruleView(r, { title: r.doc_title, approval: r.approval }, r.open_reviews) : { id, title: id, state: 'unknown', stateText: 'Not in the rule references' }; });
  };
  // a lesson's open review items, shown on it (RUL-04)
  const prevLessonExtras = ctx.lessonExtras;
  ctx.lessonExtras = async (w, l, c) => {
    const base = prevLessonExtras ? await prevLessonExtras(w, l, c) : {};
    const items = (await db.query("SELECT * FROM {S}.review_item WHERE programme_id = @p AND state = 'open' ORDER BY created_at", { p: l.programme_id }))
      .filter((i) => JSON.parse(i.affected).some((a) => a.type === 'lesson' && String(a.id).toLowerCase() === String(l.lesson_id).toLowerCase()));
    return { ...base, reviews: items.map((i) => ({ id: i.review_id, kind: i.kind, title: i.title, ruleId: i.rule_id })) };
  };

  // ------------------------------------------------------------------ rules
  async function listRules(w, query) {
    const pid = text(query.programme, 32) || 'ocr-referee';
    await linksReady();
    const docs = await db.query('SELECT * FROM {S}.rule_document WHERE programme_id = @p ORDER BY doc_id', { p: pid });
    const rows = await db.query("SELECT r.*, (SELECT COUNT(*) FROM {S}.rule_link k WHERE k.rule_id = r.rule_id) AS links, (SELECT COUNT(*) FROM {S}.review_item i WHERE i.rule_id = r.rule_id AND i.state = 'open') AS open_reviews FROM {S}.rule_ref r WHERE r.programme_id = @p AND r.state IN ('approved', 'draft') ORDER BY r.rule_id, r.version_no", { p: pid });
    const byId = new Map();
    for (const r of rows) { const had = byId.get(r.rule_id); if (!had || r.state === 'approved' || (had.state !== 'approved' && r.version_no > had.version_no)) byId.set(r.rule_id, r); }
    const drafts = new Set(rows.filter((r) => r.state === 'draft' && byId.get(r.rule_id) !== r).map((r) => r.rule_id));
    const sortKey = (s) => s.split('.').map((n) => String(n).padStart(4, '0')).join('.');
    return reply(200, {
      documents: docs.map((d) => ({ id: d.doc_id, title: d.title, edition: d.edition, approval: d.approval, approvalText: DOC_STATE[d.approval] || d.approval, note: d.note })),
      rules: [...byId.values()].sort((a, b) => sortKey(a.section).localeCompare(sortKey(b.section))).map((r) => ({ ...ruleView(r, docs.find((d) => d.doc_id === r.doc_id), r.open_reviews), links: r.links, draftChange: drafts.has(r.rule_id) })),
      can: { draft: P.can(w.grants, 'content.draft', { programmeId: pid }), approve: P.can(w.grants, 'content.approve', { programmeId: pid }) },
    });
  }
  async function getRule(w, ruleId) {
    await linksReady();
    const versions = await db.query('SELECT * FROM {S}.rule_ref WHERE rule_id = @r ORDER BY version_no DESC', { r: ruleId });
    if (!versions.length) return reply(404, { error: 'No such rule reference' });
    const doc = (await db.query('SELECT * FROM {S}.rule_document WHERE doc_id = @d', { d: versions[0].doc_id }))[0];
    const reviews = await db.query('SELECT * FROM {S}.review_item WHERE rule_id = @r ORDER BY created_at DESC', { r: ruleId });
    const open = reviews.filter((i) => i.state === 'open').length, pid = versions[0].programme_id;
    const current = versions.find((v) => v.state === 'approved') || versions[0];
    return reply(200, { rule: ruleView(current, doc, open), versions: versions.map((v) => ruleView(v, doc, 0)), links: await affectedBy(ruleId), reviews: reviews.map(reviewView),
      can: { draft: P.can(w.grants, 'content.draft', { programmeId: pid }), approve: P.can(w.grants, 'content.approve', { programmeId: pid }) } });
  }
  async function newRule(w, b) {
    const pid = text(b?.programmeId, 32), ruleId = String(b?.ruleId || '').trim();
    if (!P.can(w.grants, 'content.draft', { programmeId: pid })) return reply(403, { error: 'Only the programme\'s editors add rule references' });
    if (!RULE_ID.test(ruleId)) return reply(400, { error: 'A rule id looks like OCR-2027-4.2.13' });
    if ((await db.query('SELECT 1 AS x FROM {S}.rule_ref WHERE rule_id = @r', { r: ruleId })).length) return reply(409, { error: 'That rule reference exists: change it with a new version' });
    const doc = (await db.query('SELECT * FROM {S}.rule_document WHERE doc_id = @d AND programme_id = @p', { d: text(b?.docId, 40), p: pid }))[0];
    if (!doc) return reply(400, { error: 'Choose the source document' });
    const key = uuid();
    await db.tx(async (q) => {
      await q('INSERT INTO {S}.rule_ref (rule_key, rule_id, version_no, programme_id, doc_id, section, title, excerpt, citation, created_by) VALUES (@k, @r, 1, @p, @d, @s, @t, @e, @c, @by)',
        { k: key, r: ruleId, p: pid, d: doc.doc_id, s: text(b?.section, 20), t: text(b?.title, 200), e: String(b?.excerpt || '').slice(0, 8000), c: text(b?.citation, 300), by: w.person.person_id });
      await audit(q, w, 'rule.create', 'rule_ref', key, { ruleId, title: text(b?.title, 200) }, { programmeId: pid });
    });
    return getRule(w, ruleId);
  }
  // a rule changes: a draft version, and a review item for everything it affects; nothing published changes (RUL-03, AT-07)
  async function changeRule(w, ruleId, b) {
    const versions = await db.query('SELECT * FROM {S}.rule_ref WHERE rule_id = @r ORDER BY version_no DESC', { r: ruleId });
    if (!versions.length) return reply(404, { error: 'No such rule reference' });
    const pid = versions[0].programme_id;
    if (!P.can(w.grants, 'content.draft', { programmeId: pid })) return reply(403, { error: 'Only the programme\'s editors draft rule changes' });
    if (versions.some((v) => v.state === 'draft')) return reply(409, { error: 'There is a draft change already: approve or withdraw it first' });
    const cur = versions.find((v) => v.state === 'approved') || versions[0];
    const excerpt = String(b?.excerpt ?? cur.excerpt).slice(0, 8000), note = text(b?.changeNote, 600);
    if (!note) return reply(400, { error: 'Say what changed: it goes on the review item' });
    if (b?.effectiveDate && !/^\d{4}-\d{2}-\d{2}$/.test(b.effectiveDate)) return reply(400, { error: 'A date like 2027-01-01' });
    const key = uuid(), reviewId = uuid();
    await syncLinksSafe();
    await db.tx(async (q) => {
      await q(`INSERT INTO {S}.rule_ref (rule_key, rule_id, version_no, programme_id, doc_id, section, title, excerpt, citation, effective_date, change_note, created_by)
               VALUES (@k, @r, @n, @p, @d, @s, @t, @e, @c, @eff, @note, @by)`,
      { k: key, r: ruleId, n: versions[0].version_no + 1, p: pid, d: cur.doc_id, s: cur.section, t: text(b?.title, 200) || cur.title, e: excerpt, c: text(b?.citation, 300) || cur.citation, eff: b?.effectiveDate || null, note, by: w.person.person_id });
      const affected = await affectedBy(ruleId, q);
      await q(`INSERT INTO {S}.review_item (review_id, programme_id, kind, rule_id, rule_key, title, detail, affected, created_by)
               VALUES (@id, @p, 'rule_change', @r, @k, @t, @d, @a, @by)`,
      { id: reviewId, p: pid, r: ruleId, k: key, t: `Rule ${cur.section} (${cur.title}) is changing`, d: note, a: JSON.stringify(affected), by: w.person.person_id });
      await audit(q, w, 'rule.change', 'rule_ref', key, { ruleId, versionNo: versions[0].version_no + 1, note, affected: affected.length, review: reviewId }, { programmeId: pid });
    });
    return getRule(w, ruleId);
  }
  async function ruleState(w, key, b) {
    const r = isUuid(key) && (await db.query('SELECT * FROM {S}.rule_ref WHERE rule_key = @k', { k: key }))[0]; if (!r) return reply(404, { error: 'No such rule version' });
    const to = String(b?.to || '');
    if (r.state !== 'draft' || !['approved', 'withdrawn'].includes(to)) return reply(409, { error: `A ${r.state} rule version can't become ${to}` });
    if (!P.can(w.grants, 'content.approve', { programmeId: r.programme_id })) return reply(403, { error: 'Only the programme\'s owner or an admin approves rule changes' });
    if (to === 'approved' && r.created_by === w.person.person_id && !P.can(w.grants, 'programme.create')) return reply(403, { error: 'Someone else must approve a change you drafted' });
    await db.tx(async (q) => {
      if (to === 'approved') {
        await q("UPDATE {S}.rule_ref SET state = 'superseded', superseded_by = @k WHERE rule_id = @r AND state = 'approved'", { k: r.rule_key, r: r.rule_id });
        await q("UPDATE {S}.rule_ref SET state = 'approved', approved_by = @by, approved_at = SYSUTCDATETIME() WHERE rule_key = @k", { k: r.rule_key, by: w.person.person_id });
      } else await q("UPDATE {S}.rule_ref SET state = 'withdrawn' WHERE rule_key = @k", { k: r.rule_key });
      await audit(q, w, `rule.${to}`, 'rule_ref', r.rule_key, { ruleId: r.rule_id, versionNo: r.version_no }, { programmeId: r.programme_id });
    });
    return getRule(w, r.rule_id);
  }

  // ------------------------------------------------------------------ review items
  const reviewView = (i) => ({ id: i.review_id, programmeId: i.programme_id, kind: i.kind, ruleId: i.rule_id || '', title: i.title, detail: i.detail, affected: JSON.parse(i.affected || '[]'),
    state: i.state, createdAt: i.created_at, resolvedAt: i.resolved_at, resolution: i.resolution || '' });
  async function listReviews(w, query) {
    const pid = text(query.programme, 32), state = ['open', 'resolved', 'dismissed'].includes(query.state) ? query.state : 'open';
    const mayRead = (prog) => P.can(w.grants, 'content.draft', { programmeId: prog }) || P.can(w.grants, 'content.approve', { programmeId: prog });
    if (pid ? !mayRead(pid) : !w.grants.some((g) => ['global_admin', 'programme_owner', 'content_editor'].includes(g.role))) return reply(403, { error: 'Review items are for the programme\'s editors and owners' });
    const rows = await db.query(`SELECT * FROM {S}.review_item WHERE state = @s${pid ? ' AND programme_id = @p' : ''} ORDER BY created_at DESC`, { s: state, p: pid });
    return reply(200, { reviews: rows.map(reviewView), can: { decide: rows.length ? P.can(w.grants, 'content.approve', { programmeId: rows[0].programme_id }) : P.can(w.grants, 'programme.create') } });
  }
  async function decideReview(w, id, b) {
    const i = isUuid(id) && (await db.query('SELECT * FROM {S}.review_item WHERE review_id = @id', { id }))[0]; if (!i) return reply(404, { error: 'No such review item' });
    if (!P.can(w.grants, 'content.approve', { programmeId: i.programme_id })) return reply(403, { error: 'Only the programme\'s owner or an admin closes review items' });
    const state = String(b?.state || ''), resolution = text(b?.resolution, 1000);
    if (!['resolved', 'dismissed'].includes(state)) return reply(400, { error: 'A review item is resolved or dismissed' });
    if (!resolution) return reply(400, { error: 'Say how it was resolved: it\'s kept with the item' });
    if (i.state !== 'open') return reply(409, { error: 'That review item is closed already' });
    await db.tx(async (q) => {
      await q('UPDATE {S}.review_item SET state = @s, resolution = @r, resolved_by = @by, resolved_at = SYSUTCDATETIME() WHERE review_id = @id', { s: state, r: resolution, by: w.person.person_id, id });
      await audit(q, w, `review.${state}`, 'review_item', id, { title: i.title, resolution }, { programmeId: i.programme_id });
    });
    return reply(200, { review: reviewView((await db.query('SELECT * FROM {S}.review_item WHERE review_id = @id', { id }))[0]) });
  }

  // ------------------------------------------------------------------ the handbook (LRN-06, AT-06)
  async function handbook(w, programmeId, query) {
    const p = await ctx.progById(programmeId); if (!p) return reply(404, { error: 'No such programme' });
    const canEdit = ctx.editor(w, programmeId);
    const v = query.version && canEdit ? await ctx.versionById(query.version) : await ctx.currentVersion(programmeId);
    if (!v || v.programme_id !== programmeId) return reply(404, { error: 'That programme has no published version' });
    const locale = String(query.locale || 'en'), modules = await ctx.curriculum(v.version_id);
    const contents = await db.query(`SELECT c.* FROM {S}.content_version c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id WHERE l.version_id = @v
      AND (c.state = 'published' OR (c.state = 'review' AND c.translation_of IS NOT NULL))`, { v: v.version_id });
    let preview = false, fallback = false;
    const pick = (lessonId) => {
      const mine = contents.filter((c) => c.lesson_id === lessonId);
      const inLocale = mine.filter((c) => c.locale === locale).sort((a, b) => (a.state === 'published' ? -1 : 1) - (b.state === 'published' ? -1 : 1))[0];
      if (inLocale) { if (inLocale.state !== 'published') preview = true; return inLocale; }
      const en = mine.find((c) => c.locale === 'en' && c.state === 'published'); if (en && locale !== 'en') fallback = true; return en || null;
    };
    const sections = modules.map((m) => ({ title: m.title, source: m.sourceSection, summary: m.summary, lessons: m.lessons.map((l) => {
      const c = pick(l.id); const slides = c ? JSON.parse(c.body).slides : [];
      return { title: l.title, summary: l.summary, written: !!c, locale: c?.locale || '', contentVersion: c?.version_no || 0, preview: !!c && c.state !== 'published', sourceHash: c?.source_hash?.slice(0, 12) || '', sources: c?.sources || '',
        slides: slides.map((s) => ({ heading: s.heading, points: s.points, review: s.review || '', rules: s.rules || [] })) };
    }) }));
    const ruleIds = [...new Set(sections.flatMap((m) => m.lessons.flatMap((l) => l.slides.flatMap((s) => s.rules))))];
    const rules = await ctx.rulesFor([{ rules: ruleIds }], programmeId);
    const reviews = await db.query("SELECT * FROM {S}.review_item WHERE programme_id = @p AND state = 'open' ORDER BY kind, created_at", { p: programmeId });
    const docs = await db.query('SELECT * FROM {S}.rule_document WHERE programme_id = @p', { p: programmeId });
    await audit(db.query, w, 'handbook.download', 'programme_version', v.version_id, { programme: programmeId, edition: v.edition, locale }, { programmeId });
    return reply(200, {
      programme: { id: p.programme_id, title: p.title, demo: !!p.demo }, version: { id: v.version_id, edition: v.edition, state: v.state, effectiveDate: v.effective_date, publishedAt: v.published_at, qualification: v.qualification },
      locale, language: { preview, fallback, state: preview ? 'Preview translation: not reviewed' : fallback ? `Not yet translated: English shown where there is no ${locale}` : locale === 'en' ? 'English master' : 'Approved translation' },
      generatedAt: new Date().toISOString(), sections, rules, documents: docs.map((d) => ({ title: d.title, edition: d.edition, approval: DOC_STATE[d.approval] || d.approval })),
      reviews: reviews.map((i) => ({ kind: i.kind, title: i.title })),
    });
  }

  async function route(w, method, parts, body, query) {
    const [, a, b, c] = parts;
    if (a === 'rules' && !b && method === 'GET') return listRules(w, query);
    if (a === 'rules' && !b && method === 'POST') return newRule(w, body);
    if (a === 'rules' && b && !c && method === 'GET') return getRule(w, b);
    if (a === 'rules' && b && c === 'versions' && method === 'POST') return changeRule(w, b, body);
    if (a === 'rule-versions' && b && c === 'state' && method === 'POST') return ruleState(w, b, body);
    if (a === 'reviews' && !b && method === 'GET') return listReviews(w, query);
    if (a === 'reviews' && b && !c && method === 'POST') return decideReview(w, b, body);
    if (a === 'handbook' && b && !c && method === 'GET') return handbook(w, b, query);
    return null;
  }
  return { route };
}

module.exports = { createGovern };
