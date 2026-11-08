// Draws the app icon at one size into each file given (the Android launcher sizes).
//   node scripts/resize-icon.cjs <source> <size> <out.png> [more.png ...]
// The source only says which icon: one from icons/headjudge is HeadJudge's HJ, anything else the Spartans helmet.
const fs = require('fs');
const { png, icon } = require('./make-icons.cjs');
const { hjIcon } = require('./make-hj-icons.cjs');
const [, , source, size, ...outs] = process.argv;
const data = png(+size, /headjudge/i.test(source || '') ? hjIcon(0.08) : icon(0.08));
for (const o of outs) fs.writeFileSync(o, data);
