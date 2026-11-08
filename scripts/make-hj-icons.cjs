// Draws HeadJudge's app icon: "HJ" in the site's mark style (a white H and a yellow J, bold, leaning like the italic lettering) above a
// short yellow bar like the line under the site's header, on HeadJudge's dark slate. Used by the Broadcaster app.
//   node scripts/make-hj-icons.cjs [out folder]      (default icons/headjudge)
const fs = require('fs'), path = require('path');
const { png } = require('./make-icons.cjs');
const SLATE = [18, 22, 28], WHITE = [244, 246, 248], YELLOW = [255, 196, 0];
const inBox = (x, y, x0, x1, y0, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;
const TOP = 0.275, BASE = 0.635, STEM = 0.066, LEAN = 0.2;
// pad: 0..1, how much the art shrinks (maskable and launcher icons need a safe zone)
const hjIcon = (pad) => (u, v) => {
  const x0 = (u - 0.5) / (1 - pad) + 0.5, y = (v - 0.5) / (1 - pad) + 0.5;
  if (inBox(x0, y, 0.33, 0.67, 0.695, 0.727)) return YELLOW;
  const x = x0 - (0.455 - y) * LEAN; // leaning right, like italic lettering
  const h = inBox(x, y, 0.285, 0.285 + STEM, TOP, BASE) || inBox(x, y, 0.485 - STEM, 0.485, TOP, BASE) || inBox(x, y, 0.285, 0.485, 0.428, 0.488);
  if (h) return WHITE;
  const j = inBox(x, y, 0.715 - STEM, 0.715, TOP, BASE) || inBox(x, y, 0.535, 0.715, BASE - 0.062, BASE) || inBox(x, y, 0.535, 0.535 + STEM, 0.52, BASE);
  if (j) return YELLOW;
  return SLATE;
};
module.exports = { hjIcon };
if (require.main === module) {
  const out = process.argv[2] || path.join(__dirname, '..', 'icons', 'headjudge');
  fs.mkdirSync(out, { recursive: true });
  for (const [name, size, pad] of [['icon-180.png', 180, 0], ['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['icon-maskable-512.png', 512, 0.18], ['icon-1024.png', 1024, 0]]) {
    fs.writeFileSync(path.join(out, name), png(size, hjIcon(pad)));
    console.log('wrote', name);
  }
}
