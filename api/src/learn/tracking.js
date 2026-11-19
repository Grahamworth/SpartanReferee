'use strict';
/* Progress and reminders (19 November 2026): who has done their lessons, for those who look after them, and emailing reminders.
   Admins see everyone; a programme's owners and assessors their programme's people; a regional coordinator the people in their region.
   Filter by programme, region and how they're doing, tick people (or all shown), and email them a reminder to complete by a date: the
   date is kept as their complete-by date, and when they were last reminded is shown.

   GET  /api/learn/tracking?programme=&region=&status=todo|overdue|completed|all&q=   -> { rows, programmes, regions }
   POST /api/learn/tracking/remind {enrolmentIds, due?, message?}                     -> { sent, failed: [{name, error}] } */
const { layout } = require('../mailer');

const MAX = 500;
const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : null);

function createTracking(ctx) {
  const { db, reply, P, audit, text } = ctx;
  const has = (grants, role) => grants.filter((g) => g.role === role);

  /** what this person may see: { all } or the programmes they own or assess and the regions they coordinate */
  function scopeOf(w) {
    const admin = w.grants.some((g) => g.role === 'global_admin');
    return {
      all: admin,
      programmes: [...new Set([...has(w.grants, 'programme_owner'), ...has(w.grants, 'assessor')].map((g) => g.programme_id).filter(Boolean))],
      regions: [...new Set(has(w.grants, 'regional_coordinator').map((g) => g.region_id).filter(Boolean))],
    };
  }
  const inScope = (sc, r) => sc.all || sc.programmes.includes(r.programme_id) || (!!r.region_id && sc.regions.includes(r.region_id));

  async function rowsFor(w, f) {
    const sc = scopeOf(w);
    if (!sc.all && !sc.programmes.length && !sc.regions.length) return { error: reply(403, { error: 'Only admins, assessors, programme owners and regional coordinators see this' }) };
    const where = ["e.state <> 'withdrawn'", 'p.synthetic = 0', "p.status = 'active'"], params = {};
    if (f.programme) { where.push('e.programme_id = @prog'); params.prog = f.programme; }
    if (f.region) { where.push('p.region_id = @region'); params.region = f.region; }
    if (f.q) { where.push('(LOWER(p.legal_name) LIKE @q OR LOWER(p.email) LIKE @q OR LOWER(ISNULL(p.preferred_name, \'\')) LIKE @q)'); params.q = `%${String(f.q).toLowerCase().replace(/[%_[]/g, '')}%`; }
    if (f.ids) { where.push(`e.enrolment_id IN (${f.ids.map((_, i) => `@id${i}`).join(', ')})`); f.ids.forEach((id, i) => { params[`id${i}`] = id; }); }
    const raw = await db.query(`SELECT TOP 3000 e.enrolment_id, e.programme_id, e.version_id, e.state, e.due_date, e.reminded_at, e.enrolled_at, e.completed_at,
        p.person_id, p.legal_name, p.preferred_name, p.email, p.region_id, p.locale, pr.title,
        (SELECT MAX(c.completed_at) FROM {S}.completion c WHERE c.enrolment_id = e.enrolment_id) AS last_lesson
      FROM {S}.enrolment e JOIN {S}.person p ON p.person_id = e.person_id JOIN {S}.programme pr ON pr.programme_id = e.programme_id
      WHERE ${where.join(' AND ')} ORDER BY p.legal_name`, params);
    const visible = raw.filter((r) => inScope(sc, r));
    // every lesson that counts in each version, and everyone's completions in them, in one go each (hundreds of people)
    const versions = [...new Set(visible.map((r) => r.version_id))];
    const countable = new Map(await Promise.all(versions.map(async (v) => [v, new Set(await ctx.countableLessons(v))])));
    const doneBy = new Map();
    if (versions.length) {
      for (const c of await db.query(`SELECT DISTINCT person_id, version_id, lesson_id FROM {S}.completion WHERE version_id IN (${versions.map((_, i) => `@v${i}`).join(', ')})`, Object.fromEntries(versions.map((v, i) => [`v${i}`, v])))) {
        const k = `${c.person_id}|${c.version_id}`; if (!doneBy.has(k)) doneBy.set(k, new Set()); doneBy.get(k).add(c.lesson_id);
      }
    }
    const rows = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const r of visible) {
      const lessons = countable.get(r.version_id), total = lessons.size;
      const done = [...(doneBy.get(`${r.person_id}|${r.version_id}`) || [])].filter((id) => lessons.has(id)).length;
      const due = r.due_date ? new Date(r.due_date).toISOString().slice(0, 10) : '';
      const status = r.state === 'completed' ? 'completed' : due && due < today ? 'overdue' : 'todo';
      rows.push({ enrolmentId: r.enrolment_id, personId: r.person_id, name: r.preferred_name || r.legal_name, email: r.email, regionId: r.region_id || '', locale: r.locale,
        programmeId: r.programme_id, title: r.title, done, total, status, due, remindedAt: r.reminded_at, lastLesson: r.last_lesson, enrolledAt: r.enrolled_at });
    }
    const st = f.status || 'todo';
    return { rows: st === 'all' ? rows : st === 'todo' ? rows.filter((r) => r.status !== 'completed') : rows.filter((r) => r.status === st), sc };
  }

  async function list(w, query) {
    const r = await rowsFor(w, { programme: text(query.programme, 32), region: text(query.region, 32), status: text(query.status, 12), q: text(query.q, 100) });
    if (r.error) return r.error;
    const progs = await db.query("SELECT programme_id, title FROM {S}.programme WHERE status = 'active' ORDER BY title");
    const regions = await db.query('SELECT region_id, name FROM {S}.region ORDER BY name');
    return reply(200, {
      rows: r.rows,
      programmes: progs.filter((p) => r.sc.all || r.sc.programmes.includes(p.programme_id) || r.sc.regions.length).map((p) => ({ id: p.programme_id, title: p.title })),
      regions: regions.filter((g) => r.sc.all || r.sc.programmes.length || r.sc.regions.includes(g.region_id)).map((g) => ({ id: g.region_id, name: g.name })),
    });
  }

  async function remind(w, b) {
    if (!ctx.mailer) return reply(503, { error: 'Email isn\'t set up on the server, so reminders can\'t be sent' });
    const ids = [...new Set((Array.isArray(b?.enrolmentIds) ? b.enrolmentIds : []).filter((x) => ctx.isUuid(x)))];
    if (!ids.length) return reply(400, { error: 'Tick at least one person' });
    if (ids.length > MAX) return reply(400, { error: `Up to ${MAX} at a time` });
    const due = b?.due ? day(b.due) : null;
    if (b?.due && !due) return reply(400, { error: 'That date isn\'t right' });
    const r = await rowsFor(w, { ids, status: 'all' });
    if (r.error) return r.error;
    const rows = r.rows.filter((x) => x.status !== 'completed');
    if (!rows.length) return reply(400, { error: 'Nobody ticked still has lessons to do' });
    const from = w.real.preferred_name || w.real.legal_name, message = text(b?.message, 1000);
    const failed = [];
    let sent = 0, i = 0;
    await Promise.all(Array.from({ length: Math.min(8, rows.length) }, async () => {
      while (i < rows.length) {
        const x = rows[i++], date = due || x.due;
        const when = date ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
        const mail = layout({
          title: date ? `Please complete ${x.title} by ${when}` : `A reminder to complete ${x.title}`,
          lines: [`Hello ${x.name},`, `${from} has asked you to complete ${x.title}${date ? ` by ${when}` : ''}. You've done ${x.done} of ${x.total} lessons so far.`, ...(message ? [message] : [])],
          link: `${ctx.siteUrl}/learn/#/programmes/${encodeURIComponent(x.programmeId)}`, linkText: 'Continue', foot: 'You get this because you are a Spartan referee on SpartanReferee.',
        });
        try {
          await ctx.mailer.send({ to: x.email, subject: date ? `Please complete ${x.title} by ${when}` : `Reminder: ${x.title}`, ...mail });
          await db.query(`UPDATE {S}.enrolment SET reminded_at = SYSUTCDATETIME()${date ? ', due_date = @d' : ''} WHERE enrolment_id = @id`, { id: x.enrolmentId, d: date });
          sent++;
        } catch (e) { failed.push({ name: x.name, error: e.message }); }
      }
    }));
    await audit(db.query, w, 'reminder.send', 'enrolment', rows[0].enrolmentId, { count: sent, due: due || undefined, programmes: [...new Set(rows.map((x) => x.programmeId))] });
    return reply(200, { sent, failed });
  }

  async function route(w, method, parts, body, query) {
    const [, a, b] = parts;
    if (a !== 'tracking') return null;
    if (!b && method === 'GET') return list(w, query);
    if (b === 'remind' && method === 'POST') return remind(w, body);
    return null;
  }
  return { route };
}

module.exports = { createTracking };
