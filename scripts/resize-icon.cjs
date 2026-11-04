// Draws the app icon at one size into each file given (the Android launcher sizes).
//   node scripts/resize-icon.cjs <ignored source> <size> <out.png> [more.png ...]
const fs = require('fs');
const { png, icon } = require('./make-icons.cjs');
const [, , , size, ...outs] = process.argv;
const data = png(+size, icon(0.08));
for (const o of outs) fs.writeFileSync(o, data);
