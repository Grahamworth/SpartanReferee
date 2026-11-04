// The look picked in the profile, set on <html> before the page paints (load this without defer or async).
// Looks: 'slate' (softer dark, the default), 'light', 'classic'. Pages filmed or judged next to a live camera
// (<script src="looks.js" data-dark-only>) show Light as Softer dark, because a dark screen reads better in sun.
(function () {
  var LOOKS = ['slate', 'light', 'classic'];
  var look = 'slate';
  try { var v = localStorage.getItem('spartans.look'); if (LOOKS.indexOf(v) >= 0) look = v; } catch (e) { /* no storage */ }
  var me = document.currentScript;
  if (look === 'light' && me && me.hasAttribute('data-dark-only')) look = 'slate';
  document.documentElement.setAttribute('data-look', look);
  var colours = { slate: '#1f2328', light: '#1c1c1c', classic: '#0b0b0b' };
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colours[look]);
  window.spartansLook = {
    get: function () { try { return LOOKS.indexOf(localStorage.getItem('spartans.look')) >= 0 ? localStorage.getItem('spartans.look') : 'slate'; } catch (e) { return 'slate'; } },
    set: function (v) {
      if (LOOKS.indexOf(v) < 0) return;
      try { localStorage.setItem('spartans.look', v); } catch (e) { /* no storage */ }
      document.documentElement.setAttribute('data-look', v);
      if (meta) meta.setAttribute('content', colours[v]);
    },
  };
})();
