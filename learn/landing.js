// Learning's overview is where everyone lands after signing in, and where the installed app opens (19 November 2026). So it also has
// what the home page (home.html) had: the referee's next events, the ways to the cameras and (admins) the admin page, and the
// "Install the app" card. The events come from /api/home, as on the home page (kept for offline use like everything else).
import { $, esc, t, hooks } from './core.js';
import { call as siteCall } from '../api-base.js';
import { viaCache, installCard } from '../offline.js';

const lang = () => (window.SR_I18N && SR_I18N.lang) || undefined;
// an event's dates are its own local dates, shown as they are whatever this device's timezone
const dayOf = (d) => new Date(`${d}T12:00:00Z`);
function datesOf(e) {
  const f = new Intl.DateTimeFormat(lang(), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  return e.endDate && e.endDate !== e.startDate && f.formatRange ? f.formatRange(dayOf(e.startDate), dayOf(e.endDate)) : f.format(dayOf(e.startDate));
}
const ARROW = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';

hooks.overview.unshift(async () => { // first, before Keep sharp
  let h; try { h = await viaCache('site/home', () => siteCall('home')); } catch { return ''; }
  const now = Date.now(), next = (h.events || []).filter((e) => !e.until || e.until > now).slice(0, 3);
  const more = (h.events || []).length > next.length;
  return `<section class="card landing"><h2>Your events</h2>
      ${next.length ? `<ul class="events">${next.map((e) => `<li><a href="../event.html?id=${encodeURIComponent(e.id)}"><span><b>${esc(e.name)}</b>
        <small>${esc([datesOf(e), [e.city, e.country].filter(Boolean).join(', ')].filter(Boolean).join(' · '))}</small>
        <span class="chips">${e.role === 'head' ? '<span class="chip head">Head referee</span>' : '<span class="chip">Referee</span>'}${e.from <= now && now < e.until ? '<span class="chip now">On now</span>' : ''}</span></span>${ARROW}</a></li>`).join('')}</ul>`
    : `<p class="note">${esc(t('No events assigned to you yet. An admin assigns referees to Spartan\'s events, and they\'ll show here.'))}</p>`}
      <div class="btnRow landingLinks">${more ? '<a class="btnLink" href="../home.html">All your events</a>' : ''}<a class="btnLink" href="../console.html">Cameras</a>${h.admin ? '<a class="btnLink" href="../customers.html">Admin</a>' : ''}</div>
    </section>
    <section class="card installCard" id="installCard" hidden>
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M12 7v7M9 11l3 3 3-3M10 18h4"/></svg>
      <div>
        <h2>Install the app</h2>
        <p class="note">SpartanReferee on your home screen, full screen. Lessons, the rules and the handbook you save keep working with no signal at the venue.</p>
        <p class="note" data-how hidden>On an iPhone or iPad: tap Share in Safari, then Add to Home Screen.</p>
        <div class="btnRow"><button class="small primaryish" type="button" data-install hidden>Install</button><button class="small" type="button" data-later>Not now</button></div>
      </div>
    </section>`;
});

export const views = {};
export function wire() { if ($('installCard') && !$('installCard').dataset.wired) { $('installCard').dataset.wired = '1'; installCard($('installCard')); } }
