// Home (#/): where everyone lands after signing in. Your name with your badges under it, your next event (it opens the event, where
// its cameras are), your programmes and how far you are in each (each opens the programme), a nudge to keep sharp, the way to the
// organiser's tools for those who have them, and the card to install the app.
import { $, S, call, esc, t, bar, day, has, isAdmin } from './core.js';
import { call as siteCall } from '../api-base.js';
import { viaCache } from '../offline.js';
import { badgeIcon } from './sharp.js';
import { assistantStatus } from './assistant.js';

const lang = () => (window.SR_I18N && SR_I18N.lang) || undefined;
const dayOf = (d) => new Date(`${d}T12:00:00Z`);
export function datesOf(e) {
  const f = new Intl.DateTimeFormat(lang(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return e.endDate && e.endDate !== e.startDate && f.formatRange ? f.formatRange(dayOf(e.startDate), dayOf(e.endDate)) : f.format(dayOf(e.startDate));
}
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
export const eventRow = (e, now = Date.now()) => `<li><a href="#/events/${encodeURIComponent(e.id)}"><span><b>${esc(e.name)}</b>
  <small>${esc([datesOf(e), [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small>
  <span class="chips">${e.role === 'head' ? '<span class="chip head">Head referee</span>' : '<span class="chip">Referee</span>'}${e.from && e.from <= now && now < e.until ? '<span class="chip now">On now</span>' : ''}${e.canBook ? '<span class="chip">Books the cameras</span>' : ''}</span></span>${ARROW}</a></li>`;
const overdue = (due) => due && due < new Date().toISOString().slice(0, 10);

// the Assistant's button (21 November 2026): for whoever it's switched on for (learn/assistant.js)
const ASK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H9l-5 4V5z"/><path d="M9 9.5h6M9 12.5h4"/></svg>';

async function homeView() {
  const p = S.me.person;
  const [home, prog, rec] = await Promise.all([
    viaCache('site/home', () => siteCall('home')).catch(() => null),
    call('progress').catch(() => null),
    call(`people/${encodeURIComponent(p.id)}/record`).catch(() => null),
  ]);
  const helper = S.me.actingAs ? null : await assistantStatus().catch(() => null);
  const earned = (prog?.badges || []).filter((b) => b.earned);
  const events = S.me.actingAs ? [] : home?.events || [];
  const next = events[0];
  const enrol = (rec?.enrolments || []).filter((e) => e.state !== 'withdrawn');
  const due = (prog?.refresher || []).reduce((n, r) => n + r.due, 0);
  const soon = next && next.from > Date.now() && next.from - Date.now() < 10 * 864e5;
  const tools = [
    isAdmin() ? ['#/invites', 'Invite people'] : null,
    isAdmin() || has('regional_coordinator') ? ['#/manage', 'Manage Events'] : null,
    isAdmin() || has('regional_coordinator') || has('assessor') || has('programme_owner') ? ['#/people', 'People and their progress'] : null,
    isAdmin() ? ['#/config', 'Config'] : null,
  ].filter(Boolean);
  return `<section class="homeHello"><h1>${esc(p.preferredName || p.legalName)}</h1>
      ${helper?.allowed ? `<a class="btnLink primaryLink homeAssistant" href="#/assistant">${ASK_ICON}<span>${esc(t('Assistant'))}</span></a>` : ''}
      ${earned.length ? `<a class="homeBadges" href="#/badges" aria-label="${esc(t('Your badges'))}">${earned.slice(-10).map((b) => badgeIcon(b, 'sm')).join('')}</a>` : ''}</section>
    <section class="card"><h2>Your next event</h2>
      ${next ? `<ul class="events">${eventRow(next)}</ul>${events.length > 1 ? `<p class="note"><a href="#/events">${esc(t(events.length === 2 ? 'And 1 more event' : 'And {n} more events', { n: events.length - 1 }))}</a></p>` : ''}`
    : `<p class="note">${esc(t('No events assigned to you yet. When an organiser adds you to one, it shows here: open it for its details, the other referees and its cameras.'))}</p>`}
    </section>
    ${soon || due ? `<section class="card sharpNudge"><p>${esc(soon ? t('Your next event is {date}: a five-minute refresher keeps the rules fresh.', { date: datesOf(next) }) : t('{n} refresher questions are due.', { n: due }))}</p>
      <a class="btnLink primaryLink" href="#/refresh${due ? '' : '?more=1'}">Start a refresher</a></section>` : ''}
    <section class="card"><h2>Your learning</h2>
      <ul class="homeProgs">${enrol.map((e) => `<li><a href="#/programmes/${esc(e.programmeId)}"><span class="enrolTop"><b>${esc(e.title)}</b>${e.state === 'completed' ? '<span class="badge s-completed">Completed</span>' : ''}</span>
        ${bar(e.done || 0, e.lessons || 0)}<small><span>${esc(t('{done} of {total} lessons', { done: e.done || 0, total: e.lessons || 0 }))}</span>${e.due && e.state !== 'completed' ? ` · <span class="${overdue(e.due) ? 'badText' : ''}">${esc(t(overdue(e.due) ? 'was due {date}' : 'complete by {date}', { date: day(e.due) }))}</span>` : ''}</small></a></li>`).join('')
      || `<li class="muted">${esc(t('No programmes yet: your organisers assign them, or see Learning.'))}</li>`}</ul>
      <p><a class="btnLink" href="#/programmes">Learning</a></p></section>
    ${tools.length ? `<section class="card"><h2>Organiser tools</h2><div class="btnRow">${tools.map(([href, text]) => `<a class="btnLink" href="${href}">${esc(text)}</a>`).join('')}</div></section>` : ''}`;
}

export const views = { home: homeView };
