// The study look's light or dark (study.css): Auto follows the phone. Loaded in the <head> (not as a module), so the page is drawn in
// the chosen look from the start; the Look button goes in the header once the page is there.
(function () {
  var KEY = 'sr_look', LOOKS = ['auto', 'light', 'dark'];
  var NAMES = { auto: 'Look: auto', light: 'Look: light', dark: 'Look: dark' };
  var ICONS = { auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 000 16z" fill="currentColor"/>', light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>', dark: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>' };
  function get() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply(look) { if (look === 'auto') document.documentElement.removeAttribute('data-look'); else document.documentElement.setAttribute('data-look', look); }
  apply(get());
  function button() {
    var right = document.querySelector('header.top .topRight');
    if (!right || right.querySelector('.lookBtn')) return;
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'lookBtn';
    var draw = function () { var l = get(); b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[l] + '</svg><span></span>'; b.lastChild.textContent = NAMES[l]; };
    b.onclick = function () {
      var next = LOOKS[(LOOKS.indexOf(get()) + 1) % LOOKS.length];
      try { if (next === 'auto') localStorage.removeItem(KEY); else localStorage.setItem(KEY, next); } catch (e) { /* private mode: this page only */ }
      apply(next); draw();
    };
    draw();
    right.insertBefore(b, right.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', button); else button();
  addEventListener('storage', function (e) { if (e.key === KEY) apply(get()); });
}());
