// A company's colours as the CSS variables its pages use. A brand colour that would be hard to read on the page's background
// keeps its hue but is moved lighter or darker until it can be read; buttons get whichever of black or white reads best on them.
// Used by the registration page, the company's own pages and the Receiver's review page (plain script, and tests require it).
(function (root) {
  const HEADJUDGE = { primary: '#e2231a', accent: '#3ddc97', mode: 'dark' };
  const toRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (rgb) => `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
  const lum = (h) => { const [r, g, b] = toRgb(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const mix = (a, b, t) => { const x = toRgb(a), y = toRgb(b); return toHex(x.map((v, i) => v + (y[i] - v) * t)); };
  /** colour moved towards white or black, only as far as it takes to reach this contrast with bg */
  function readable(colour, bg, need = 3) {
    if (contrast(colour, bg) >= need) return colour;
    const to = lum(bg) < 0.4 ? '#ffffff' : '#000000';
    for (let t = 0.05; t < 1; t += 0.05) { const c = mix(colour, to, t); if (contrast(c, bg) >= need) return c; }
    return to;
  }
  const on = (colour) => (contrast(colour, '#ffffff') >= contrast(colour, '#101010') ? '#ffffff' : '#101010');
  function themeVars(theme) {
    const t = { ...HEADJUDGE, ...(theme || {}) }, dark = t.mode !== 'light';
    const bg = dark ? '#0b0b0b' : '#f5f6f8', panel = dark ? '#161616' : '#ffffff', text = dark ? '#f4f6f8' : '#14181d', muted = dark ? '#a6a6a6' : '#59626d', line = dark ? '#3a3a3a' : '#d6dbe1';
    return {
      '--bg': bg, '--panel': panel, '--text': text, '--muted': muted, '--line': line,
      '--primary': t.primary, '--on-primary': on(t.primary),
      '--primary-text': readable(t.primary, panel, 3), '--accent': readable(t.accent, panel, 3),
    };
  }
  function applyTheme(theme, el) { const r = el || document.documentElement; for (const [k, v] of Object.entries(themeVars(theme))) r.style.setProperty(k, v); r.dataset.mode = theme && theme.mode === 'light' ? 'light' : 'dark'; }
  const api = { HEADJUDGE, contrast, readable, on, themeVars, applyTheme };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.HeadJudgeBrand = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
