// The tabs along the top of a company's pages, the same five as the video review's on their servers:
//   Booking and History  here on the console (console.html, console.html#history)
//   Live and Cameras     on the company's servers, while they're on: the review opens on that tab, in this browser tab
//   Results              on the servers while they're on (live, previous recordings, uploads); otherwise the saved results (results.html)
// Someone who's never booked sees only Booking. The review's own Booking and History come back here.
import { call } from './api-base.js';
import { tabsFor } from './apptabs-core.js';

const ICONS = {
  booking: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  live: '<circle cx="12" cy="12" r="3.2" fill="currentColor"/><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4"/>',
  results: '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/>',
  cameras: '<rect x="3" y="7" width="13" height="10" rx="1.5"/><path d="M16 11l5-3v8l-5-3"/>',
  history: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};
const TABS = [['booking', 'Booking'], ['cameras', 'Cameras'], ['live', 'Live'], ['results', 'Results'], ['history', 'History']];

export { tabsFor };

/** Opens the company's server n on one of the review's tabs, in this browser tab. Throws with a message to show. */
export async function openServer(tab, n = 1) {
  let unit = ''; try { unit = localStorage.getItem('sr_unit') || ''; } catch { /* private mode */ } // the booking chosen on the console
  const { url } = await call('servers/mine/open', { method: 'POST', body: { n, tab, ...(unit ? { unit } : {}) } });
  const lang = window.SR_I18N ? SR_I18N.lang : 'en'; // the server's review opens in the language picked here
  let look = ''; try { look = localStorage.getItem('sr_look') || ''; } catch { /* private mode */ } // and in the Look picked here (look.js)
  location.assign(`${url}${lang === 'en' ? '' : `&lang=${lang}`}${look === 'light' || look === 'dark' ? `&look=${look}` : '&look=auto'}`);
}

let drawn = '';
/**
 * Draws the tabs into el. active: this page's tab. local(tab): handles a tab this page shows itself (return true), e.g. the console's
 * Booking and History. onError(message): when a server couldn't be opened.
 */
export function drawAppTabs(el, { active, server, hasBookings, local = () => false, onError = () => {} }) {
  const t = tabsFor(server, hasBookings, active);
  const key = JSON.stringify([active, t]);
  if (key === drawn && el.childElementCount) return;
  drawn = key;
  el.innerHTML = TABS.filter(([k]) => t.show[k]).map(([k, label]) => `<button type="button" data-app-tab="${k}"${k === active ? ' class="on" aria-current="page"' : ''}${t.waiting[k] ? ' disabled title="Your server is starting: this opens once it\'s on"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span>${label}</span></button>`).join('');
  el.hidden = false;
  el.onclick = async (e) => {
    const b = e.target.closest('button[data-app-tab]'); if (!b || b.disabled) return;
    const tab = b.dataset.appTab;
    if (tab === active || local(tab)) return;
    if (t.onServer[tab]) { b.disabled = true; try { await openServer(tab); } catch (err) { onError(err.message); b.disabled = false; } return; }
    location.assign(tab === 'results' ? 'results.html' : tab === 'history' ? 'console.html#history' : 'console.html');
  };
}
