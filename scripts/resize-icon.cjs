// Draws the app icon (the Spartans helmet: white on a red disc, on black) at one size into each file given (the Android launcher sizes).
//   node scripts/resize-icon.cjs <source> <size> <out.png> [more.png ...]      (source is ignored: there's one icon)
const fs = require('fs');
const { png, icon } = require('./make-icons.cjs');
const [, , , size, ...outs] = process.argv;
const data = png(+size, icon(0.08));
for (const o of outs) fs.writeFileSync(o, data);
