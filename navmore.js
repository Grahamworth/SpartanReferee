// The app's tabs on a phone (22 November 2026): a bar along the bottom with Home, Events, Learning, Obstacles and Rules, and for
// people who have more (managing, admin) a More button that opens the list of those, just above the bar. On wider screens the tabs
// stay along the top and More isn't there (study.css). Used by the app (learn/learn.js) and the pages outside it (appnav.js).

/** Shows More only when some of its tabs are yours, lit when the page you're on is one of them. Call after the tabs change. */
export function refreshMore(nav) {
  const btn = nav?.querySelector('.navMoreBtn'); if (!btn) return;
  btn.hidden = !nav.querySelector('.navMore a:not([hidden])');
  btn.classList.toggle('on', !!nav.querySelector('.navMore a.on'));
  if (btn.hidden) close(nav);
}

function close(nav) {
  nav.classList.remove('moreOpen');
  nav.querySelector('.navMoreBtn')?.setAttribute('aria-expanded', 'false');
}

/** More opens and closes its list; a tap on one of them, anywhere else, Escape or going to another page closes it. */
export function wireMore(nav) {
  const btn = nav?.querySelector('.navMoreBtn'); if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => {
    const open = !nav.classList.contains('moreOpen');
    nav.classList.toggle('moreOpen', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) nav.querySelector('.navMore a:not([hidden])')?.focus({ preventScroll: true });
  });
  nav.querySelector('.navMore')?.addEventListener('click', (e) => { if (e.target.closest('a')) close(nav); });
  document.addEventListener('click', (e) => { if (!nav.contains(e.target)) close(nav); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && nav.classList.contains('moreOpen')) { close(nav); btn.focus(); } });
  window.addEventListener('hashchange', () => close(nav));
  refreshMore(nav);
}
