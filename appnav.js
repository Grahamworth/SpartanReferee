// The app's tabs and profile icon in the header of the pages outside the app (19 November 2026): Config, the cameras (watch and
// review, booking), results and the camera setup guide, so the menu never goes away. A page asks for them with
// <header class="top" data-tab="..."> (the tab to mark as the one you're on: config, events). The tabs are read from
// learn/index.html, so there is one list; which ones show follows the same rule as in the app (each tab's data-show: the roles that
// see it), from your roles in the learning platform, remembered for this visit so the header doesn't flicker page to page.
import { call, signedIn } from './api-base.js';

const KEY = 'sr_nav_roles';
const kept = () => { try { return JSON.parse(sessionStorage.getItem(KEY)); } catch { return null; } };
const keep = (r) => { try { sessionStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private mode */ } };

async function appNav() {
  const top = document.querySelector('header.top[data-tab]');
  if (!top || !signedIn()) return;
  const root = new URL('./', import.meta.url); // the site's root: appnav.js sits there
  let doc;
  try { doc = new DOMParser().parseFromString(await (await fetch(new URL('learn/index.html', root))).text(), 'text/html'); } catch { return; }
  const nav = doc.getElementById('learnNav'), prof = doc.getElementById('profileBtn');
  if (!nav || !prof) return;
  for (const a of [...nav.querySelectorAll('a'), prof]) {
    const h = a.getAttribute('href');
    a.setAttribute('href', new URL(h.startsWith('#') ? `learn/${h}` : h.replace(/^\.\.\//, ''), root).href);
    a.classList.toggle('on', !!a.dataset.view && a.dataset.view === top.dataset.tab);
  }
  nav.id = 'appNav'; prof.removeAttribute('id');
  const draw = (n, p, roles) => {
    for (const a of n.querySelectorAll('[data-show]')) a.hidden = !a.dataset.show.split(' ').some((r) => roles.includes(r));
    n.hidden = false; p.hidden = false;
  };
  const was = kept();
  // after the name (on some pages it sits inside a wider link): the tabs are the header's own child, as in the app
  ([...top.children].find((c) => c.matches('.mark, .brandline') || c.querySelector('.mark')) || top.firstElementChild).after(document.importNode(nav, true));
  top.append(document.importNode(prof, true));
  const n = top.querySelector('.learnNav'), p = top.querySelector('.profileBtn');
  if (was) draw(n, p, was);
  try {
    const roles = ((await call('learn/me')).grants || []).map((g) => g.role);
    keep(roles); draw(n, p, roles);
  } catch { if (!was) draw(n, p, []); } // not reachable: the tabs everyone has
  // on a phone the tabs are a row to swipe along: bring the one you're on into view
  const on = n.querySelector('a.on');
  if (on && n.scrollWidth > n.clientWidth) n.scrollLeft = Math.max(0, on.offsetLeft - (n.clientWidth - on.offsetWidth) / 2);
}
appNav();
