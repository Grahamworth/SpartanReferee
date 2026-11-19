'use strict';
/* Programs (19 November 2026): admins, programme owners and content editors / translators change a programme in place, and a
   programme owner (or an admin) publishes it. What learners see doesn't change until then.
   - A lesson's slides (heading, bullet points, picture, narration, notes) and its quick-check questions, in English or a translation,
     are a draft: one content_version per lesson and language in state 'draft', its body { slides, checks }. Saving again updates it.
   - Quick-check questions are written in English (prompt, options, the right one, feedback); a translation gives the same questions'
     words in its language, kept with the question when published ({ tr: { fr: {...} } }), so the right answer is always the English one.
   - A new lesson order waits in pending_order (migration 008) for the version learners are on.
   - Publish: every draft of the programme's current version (English first, then translations) and the order, at once.

   GET    /api/learn/authoring                                 -> { programmes }   the ones you can change
   GET    /api/learn/authoring/<programmeId>                   -> { programme, version, modules, order, drafts, can }
   GET    /api/learn/authoring/lessons/<lessonId>?locale=xx    -> { lesson, programme, locales, english, draft, published, can }
   PUT    /api/learn/authoring/lessons/<lessonId>/<locale> {slides, checks}   save the draft
   DELETE /api/learn/authoring/lessons/<lessonId>/<locale>     throw the draft away
   PUT    /api/learn/authoring/<programmeId>/order {modules: [{id, lessons: [ids]}]}
   POST   /api/learn/authoring/<programmeId>/publish           programme owners and admins
   POST   /api/learn/authoring/<programmeId>/discard           every draft and the new order go */

const MAX_CHECKS = 8;

function createAuthoring(ctx) {
  const { db, reply, P, audit, uuid, text, isUuid } = ctx;
  const canEdit = (w, pid) => P.can(w.grants, 'content.draft', { programmeId: pid });
  const canPublish = (w, pid) => P.can(w.grants, 'content.approve', { programmeId: pid });
  const body = (c) => { try { return JSON.parse(c.body); } catch { return {}; } };
  /** the version being edited: the one learners are on (or, before the first is published, the newest) */
  async function versionOf(pid) {
    return (await ctx.currentVersion(pid)) || (await db.query('SELECT TOP 1 * FROM {S}.programme_version WHERE programme_id = @p ORDER BY created_at DESC', { p: pid }))[0] || null;
  }
  const draftsIn = (vid) => db.query(`SELECT c.content_id, c.lesson_id, c.locale FROM {S}.content_version c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id
    WHERE l.version_id = @v AND c.state = 'draft'`, { v: vid });
  const pendingOrder = async (vid) => { const r = (await db.query('SELECT body FROM {S}.pending_order WHERE version_id = @v', { v: vid }))[0]; return r ? JSON.parse(r.body) : null; };
  const latest = async (lessonId, locale, states) => (await db.query(`SELECT TOP 1 * FROM {S}.content_version WHERE lesson_id = @l AND locale = @loc AND state IN (${states.map((s) => `'${s}'`).join(', ')}) ORDER BY version_no DESC`, { l: lessonId, loc: locale }))[0] || null;

  /** quick-check questions from the editor: English ones in full; a translation's, only the words */
  function readChecks(raw, english) {
    if (raw === undefined) return { checks: undefined };
    if (!Array.isArray(raw) || raw.length > MAX_CHECKS) return { error: `A lesson has up to ${MAX_CHECKS} quick-check questions` };
    const checks = raw.map((k) => ({
      key: text(k?.key, 60) || '',
      prompt: text(k?.prompt, 400),
      options: (Array.isArray(k?.options) ? k.options : []).map((o) => text(o, 200)).slice(0, 6),
      feedback: text(k?.feedback, 600) || '',
      ...(english ? { answer: Number.isInteger(k?.answer) ? k.answer : 0, rules: (Array.isArray(k?.rules) ? k.rules : []).map((r) => text(r, 60)).filter(Boolean).slice(0, 6) } : {}),
    }));
    for (const [i, k] of checks.entries()) {
      if (english && !k.prompt) return { error: `Question ${i + 1} needs its question` };
      if (english && (k.options.filter(Boolean).length < 2 || k.options.some((o) => !o))) return { error: `Question ${i + 1} needs at least 2 answers, none empty` };
      if (english && (k.answer < 0 || k.answer >= k.options.length)) return { error: `Question ${i + 1}: choose its right answer` };
    }
    // a translation's question left empty keeps the English (or the site's own translation of it)
    return { checks: english ? checks : checks.filter((k) => k.prompt || k.options.some(Boolean) || k.feedback) };
  }

  async function list(w) {
    const admin = P.can(w.grants, 'programme.create');
    const progs = (await db.query('SELECT * FROM {S}.programme ORDER BY title')).filter((p) => admin || canEdit(w, p.programme_id));
    const out = [];
    for (const p of progs) {
      const v = await versionOf(p.programme_id);
      const drafts = v ? await draftsIn(v.version_id) : [];
      out.push({ id: p.programme_id, title: p.title, status: p.status, locales: String(p.locales).split(','), edition: v?.edition || '', versionState: v?.state || '',
        drafts: drafts.length, lessonsChanged: new Set(drafts.map((d) => d.lesson_id)).size, orderChanged: v ? !!(await pendingOrder(v.version_id)) : false, canPublish: canPublish(w, p.programme_id) });
    }
    return reply(200, { programmes: out });
  }

  async function programme(w, pid) {
    const p = await ctx.progById(pid); if (!p) return reply(404, { error: 'No such programme' });
    if (!canEdit(w, pid)) return reply(403, { error: 'Only the programme\'s owners and editors change it' });
    const v = await versionOf(pid); if (!v) return reply(404, { error: 'This programme has no version yet' });
    const modules = await ctx.curriculum(v.version_id), drafts = await draftsIn(v.version_id);
    const published = await db.query(`SELECT DISTINCT c.lesson_id, c.locale FROM {S}.content_version c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id WHERE l.version_id = @v AND c.state = 'published'`, { v: v.version_id });
    for (const m of modules) for (const l of m.lessons) {
      l.draftLocales = drafts.filter((d) => d.lesson_id === l.id).map((d) => d.locale);
      l.publishedLocales = published.filter((d) => d.lesson_id === l.id).map((d) => d.locale);
    }
    return reply(200, { programme: { id: pid, title: p.title, locales: String(p.locales).split(',') }, version: { id: v.version_id, edition: v.edition, state: v.state },
      modules, order: await pendingOrder(v.version_id), drafts: drafts.length, can: { publish: canPublish(w, pid) } });
  }

  async function lessonFor(w, id) {
    const l = await ctx.lessonById(id); if (!l) return { error: reply(404, { error: 'No such lesson' }) };
    if (!canEdit(w, l.programme_id)) return { error: reply(403, { error: 'Only the programme\'s owners and editors change it' }) };
    const v = await versionOf(l.programme_id);
    if (!v || v.version_id !== l.version_id) return { error: reply(409, { error: 'This lesson is in an older version of the programme' }) };
    return { l };
  }

  async function lesson(w, id, query) {
    const { l, error } = await lessonFor(w, id); if (error) return error;
    const locales = String(l.locales).split(','), locale = locales.includes(query.locale) ? query.locale : 'en';
    const checks = await ctx.checksOf(l.lesson_id);
    const enPub = await latest(l.lesson_id, 'en', ['published']), enDraft = await latest(l.lesson_id, 'en', ['draft']);
    const view = (c, loc) => {
      if (!c) return null;
      const b = body(c);
      return { id: c.content_id, state: c.state, versionNo: c.version_no, slides: b.slides || [],
        // the questions as they'd be published: a draft's own, or (none in it) the published ones, in this language
        checks: b.checks || checks.map((k) => (loc === 'en' ? { key: k.key, prompt: k.prompt, options: k.options, answer: k.answer, feedback: k.feedback, rules: k.rules }
          : { key: k.key, prompt: k.tr[loc]?.prompt || '', options: k.options.map((_, i) => k.tr[loc]?.options?.[i] || ''), feedback: k.tr[loc]?.feedback || '' })) };
    };
    const english = view(enDraft || enPub, 'en');
    const draft = view(await latest(l.lesson_id, locale, ['draft']), locale);
    const published = view(await latest(l.lesson_id, locale, ['published', 'review']), locale);
    return reply(200, { lesson: { id: l.lesson_id, title: l.title, module: l.module_title, programmeId: l.programme_id, programme: l.programme_title },
      locale, locales, english, draft, published, can: { publish: canPublish(w, l.programme_id) } });
  }

  async function saveDraft(w, id, locale, b) {
    const { l, error } = await lessonFor(w, id); if (error) return error;
    if (!String(l.locales).split(',').includes(locale)) return reply(400, { error: 'The programme isn\'t offered in that language' });
    const s = ctx.readSlides(b?.slides); if (s.error) return reply(400, { error: s.error });
    const k = readChecks(b?.checks, locale === 'en'); if (k.error) return reply(400, { error: k.error });
    if (locale !== 'en' && k.checks) {
      const en = await ctx.checksOf(l.lesson_id), enDraft = await latest(l.lesson_id, 'en', ['draft']), keys = (body(enDraft || {}).checks || en).map((x) => x.key);
      k.checks = k.checks.filter((x) => keys.includes(x.key));
    }
    const doc = JSON.stringify({ slides: s.slides, ...(k.checks ? { checks: k.checks } : {}) });
    const had = await latest(l.lesson_id, locale, ['draft']);
    let cid = had?.content_id;
    await db.tx(async (q) => {
      if (had) await q('UPDATE {S}.content_version SET body = @b, source_hash = @h, author_id = @a WHERE content_id = @id', { b: doc, h: ctx.hash(doc), a: w.person.person_id, id: cid });
      else {
        cid = uuid();
        const no = ((await q('SELECT MAX(version_no) AS n FROM {S}.content_version WHERE lesson_id = @l AND locale = @loc', { l: l.lesson_id, loc: locale }))[0].n || 0) + 1;
        const en = locale === 'en' ? null : await latest(l.lesson_id, 'en', ['published']);
        const was = await latest(l.lesson_id, locale, ['published']);
        await q(`INSERT INTO {S}.content_version (content_id, lesson_id, locale, version_no, translation_of, body, source_hash, sources, translated_by, author_id)
                 VALUES (@id, @l, @loc, @no, @tr, @b, @h, @src, @tb, @a)`,
        { id: cid, l: l.lesson_id, loc: locale, no, tr: en?.content_id || null, b: doc, h: ctx.hash(doc), src: was?.sources || '', tb: locale === 'en' ? null : text(w.person.legal_name, 80) || null, a: w.person.person_id });
      }
      await audit(q, w, had ? 'content.edit' : 'content.create', 'content_version', cid, { lesson: l.title, locale, via: 'programs' }, { programmeId: l.programme_id });
    });
    return reply(200, { saved: true, contentId: cid });
  }

  async function discardDraft(w, id, locale) {
    const { l, error } = await lessonFor(w, id); if (error) return error;
    const had = await latest(l.lesson_id, locale, ['draft']); if (!had) return reply(200, { discarded: 0 });
    await db.tx(async (q) => {
      await q('DELETE FROM {S}.media_asset WHERE content_id = @id', { id: had.content_id });
      await q('DELETE FROM {S}.content_version WHERE content_id = @id', { id: had.content_id });
      await audit(q, w, 'content.discard', 'content_version', had.content_id, { lesson: l.title, locale }, { programmeId: l.programme_id });
    });
    return reply(200, { discarded: 1 });
  }

  async function saveOrder(w, pid, b) {
    if (!canEdit(w, pid)) return reply(403, { error: 'Only the programme\'s owners and editors change it' });
    const v = await versionOf(pid); if (!v) return reply(404, { error: 'No such programme' });
    const modules = await ctx.curriculum(v.version_id);
    const want = Array.isArray(b?.modules) ? b.modules : [];
    // the same modules and the same lessons, each lesson staying in its module: only the order changes
    const ok = want.length === modules.length && modules.every((m) => {
      const x = want.find((y) => y?.id === m.id);
      return x && Array.isArray(x.lessons) && x.lessons.length === m.lessons.length && m.lessons.every((l) => x.lessons.includes(l.id));
    });
    if (!ok) return reply(400, { error: 'The order has to list every lesson once, in its own module' });
    const order = modules.map((m) => ({ moduleId: m.id, lessons: want.find((y) => y.id === m.id).lessons }));
    const same = order.every((o) => o.lessons.join() === modules.find((m) => m.id === o.moduleId).lessons.map((l) => l.id).join());
    await db.tx(async (q) => {
      await q('DELETE FROM {S}.pending_order WHERE version_id = @v', { v: v.version_id });
      if (!same) await q('INSERT INTO {S}.pending_order (version_id, body, changed_by) VALUES (@v, @b, @by)', { v: v.version_id, b: JSON.stringify(order), by: w.person.person_id });
      await audit(q, w, 'order.draft', 'programme_version', v.version_id, { programme: pid, changed: !same }, { programmeId: pid });
    });
    return reply(200, { order: same ? null : order });
  }

  async function publish(w, pid) {
    if (!canPublish(w, pid)) return reply(403, { error: 'Only the programme\'s owner or an admin publishes it' });
    const v = await versionOf(pid); if (!v) return reply(404, { error: 'No such programme' });
    const drafts = (await db.query(`SELECT c.* FROM {S}.content_version c JOIN {S}.lesson l ON l.lesson_id = c.lesson_id WHERE l.version_id = @v AND c.state = 'draft'`, { v: v.version_id }))
      .sort((a, b) => (a.locale === 'en' ? 0 : 1) - (b.locale === 'en' ? 0 : 1)); // English first: translations point at it
    const order = await pendingOrder(v.version_id);
    if (!drafts.length && !order) return reply(400, { error: 'Nothing to publish' });
    const blocked = [];
    if (ctx.beforeContentPublish) {
      for (const c of drafts) { const l = await ctx.lessonById(c.lesson_id), why = await ctx.beforeContentPublish(c, l); if (why) blocked.push(`${l.title} (${c.locale}): ${why}`); }
    }
    if (blocked.length) return reply(409, { error: `Not published: ${blocked.join('; ')}` });
    await db.tx(async (q) => {
      const enNow = new Map(); // lesson -> its newly published English
      for (const c of drafts) {
        const b = body(c);
        if (c.locale !== 'en') {
          const en = enNow.get(c.lesson_id) || (await q("SELECT TOP 1 content_id FROM {S}.content_version WHERE lesson_id = @l AND locale = 'en' AND state = 'published' ORDER BY version_no DESC", { l: c.lesson_id }))[0]?.content_id;
          if (en) await q('UPDATE {S}.content_version SET translation_of = @en WHERE content_id = @id', { en, id: c.content_id });
        }
        await q("UPDATE {S}.content_version SET state = 'superseded' WHERE lesson_id = @l AND locale = @loc AND state IN ('published', 'review') AND content_id <> @id", { l: c.lesson_id, loc: c.locale, id: c.content_id });
        await q("UPDATE {S}.content_version SET state = 'published', approved_by = @by, approved_at = SYSUTCDATETIME(), submitted_by = ISNULL(submitted_by, author_id), submitted_at = ISNULL(submitted_at, SYSUTCDATETIME()) WHERE content_id = @id", { by: w.person.person_id, id: c.content_id });
        if (c.locale === 'en') enNow.set(c.lesson_id, c.content_id);
        if (b.checks) await applyChecks(q, c, b.checks);
      }
      if (order) {
        for (const [mi, o] of order.entries()) {
          for (const [li, lessonId] of o.lessons.entries()) await q('UPDATE {S}.lesson SET seq = @s WHERE lesson_id = @id AND module_id = @m', { s: li + 1, id: lessonId, m: o.moduleId });
          void mi;
        }
        await q('DELETE FROM {S}.pending_order WHERE version_id = @v', { v: v.version_id });
      }
      await audit(q, w, 'programme.publish', 'programme_version', v.version_id, { programme: pid, contents: drafts.length, order: !!order }, { programmeId: pid });
    });
    return reply(200, { published: drafts.length, order: !!order });
  }

  /** a published draft's questions become the lesson's quick check: English ones replace it, a translation's words go with each */
  async function applyChecks(q, c, checks) {
    const rows = await q('SELECT * FROM {S}.lesson_check WHERE lesson_id = @l ORDER BY seq', { l: c.lesson_id });
    if (c.locale === 'en') {
      const l = (await q('SELECT code, lineage_id FROM {S}.lesson WHERE lesson_id = @l', { l: c.lesson_id }))[0];
      const base = l.code || String(l.lineage_id).slice(0, 8);
      let n = rows.reduce((m, r) => Math.max(m, Number(/-(\d+)$/.exec(r.check_key)?.[1]) || 0), 0);
      const keep = new Set();
      for (const [i, k] of checks.entries()) {
        const had = rows.find((r) => r.check_key === k.key);
        const tr = had ? JSON.parse(had.body).tr || {} : {};
        const doc = JSON.stringify({ prompt: k.prompt, options: k.options, answer: k.answer, feedback: k.feedback, rules: k.rules || [], tr });
        if (had) { keep.add(had.check_key); await q('UPDATE {S}.lesson_check SET body = @b, seq = @s WHERE check_id = @id', { b: doc, s: i + 1, id: had.check_id }); }
        else { const key = `${base}-${++n}`; keep.add(key); await q('INSERT INTO {S}.lesson_check (check_id, lesson_id, check_key, seq, body) VALUES (@id, @l, @k, @s, @b)', { id: uuid(), l: c.lesson_id, k: key, s: i + 1, b: doc }); }
      }
      // a question taken out: gone from the lesson (what people practised of it stays in their history)
      for (const r of rows) if (!keep.has(r.check_key)) await q('DELETE FROM {S}.lesson_check WHERE check_id = @id', { id: r.check_id });
    } else {
      for (const k of checks) {
        const had = rows.find((r) => r.check_key === k.key); if (!had) continue;
        const b = JSON.parse(had.body);
        b.tr = { ...(b.tr || {}), [c.locale]: { prompt: k.prompt, options: k.options, feedback: k.feedback } };
        await q('UPDATE {S}.lesson_check SET body = @b WHERE check_id = @id', { b: JSON.stringify(b), id: had.check_id });
      }
    }
  }

  async function discardAll(w, pid) {
    if (!canEdit(w, pid)) return reply(403, { error: 'Only the programme\'s owners and editors change it' });
    const v = await versionOf(pid); if (!v) return reply(404, { error: 'No such programme' });
    const drafts = await draftsIn(v.version_id);
    await db.tx(async (q) => {
      for (const d of drafts) { await q('DELETE FROM {S}.media_asset WHERE content_id = @id', { id: d.content_id }); await q('DELETE FROM {S}.content_version WHERE content_id = @id', { id: d.content_id }); }
      await q('DELETE FROM {S}.pending_order WHERE version_id = @v', { v: v.version_id });
      await audit(q, w, 'programme.discard', 'programme_version', v.version_id, { programme: pid, contents: drafts.length }, { programmeId: pid });
    });
    return reply(200, { discarded: drafts.length });
  }

  async function route(w, method, parts, b, query) {
    const [, a, x, y, z] = parts;
    if (a !== 'authoring') return null;
    if (!x && method === 'GET') return list(w);
    if (x === 'lessons' && isUuid(y)) {
      if (!z && method === 'GET') return lesson(w, y, query);
      if (z && method === 'PUT') return saveDraft(w, y, String(z), b);
      if (z && method === 'DELETE') return discardDraft(w, y, String(z));
      return null;
    }
    if (x && !y && method === 'GET') return programme(w, x);
    if (x && y === 'order' && method === 'PUT') return saveOrder(w, x, b);
    if (x && y === 'publish' && method === 'POST') return publish(w, x);
    if (x && y === 'discard' && method === 'POST') return discardAll(w, x);
    return null;
  }
  return { route };
}

module.exports = { createAuthoring };
