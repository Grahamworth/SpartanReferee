// The phone apps' icons and splash screens (scripts/build-app.sh), drawn over the files Capacitor's templates put there, at the
// sizes those files already have: the helmet on its red disc, on SpartanReferee's black.
//   node scripts/app-images.cjs android <android/app/src/main/res>
//   node scripts/app-images.cjs ios <ios/App/App/Assets.xcassets>
const fs = require('fs'), path = require('path');
const { png, pngWH, icon } = require('./make-icons.cjs');

const sizeOf = (f) => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const filesIn = (dir, test) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(test).map((f) => path.join(dir, f)) : []);
// the disc fills (1 - pad) * 0.88 of the picture: a splash shows it at about a third of the screen's shorter side
const SPLASH = icon(0.66);
const splash = (f) => { const [w, h] = sizeOf(f); fs.writeFileSync(f, pngWH(w, h, SPLASH, { alpha: false, ss: w * h > 4e6 ? 1 : 2 })); };

const [, , platform, dir] = process.argv;
let n = 0;
if (platform === 'android') {
  // launcher icons: the full icon for older phones; Android 8+ masks a 108dp layer to a circle or squircle of about 72dp, so
  // the foreground's disc sits inside the middle 66dp, on the black background colour (set in build-app.sh)
  for (const [d, legacy] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    const m = path.join(dir, `mipmap-${d}`);
    if (!fs.existsSync(m)) continue;
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) { fs.writeFileSync(path.join(m, f), png(legacy, icon(0.08))); n++; }
    fs.writeFileSync(path.join(m, 'ic_launcher_foreground.png'), png(legacy * 2.25, icon(0.32))); n++;
  }
  for (const d of fs.readdirSync(dir).filter((x) => x.startsWith('drawable'))) for (const f of filesIn(path.join(dir, d), (x) => x === 'splash.png')) { splash(f); n++; }
} else if (platform === 'ios') {
  for (const f of filesIn(path.join(dir, 'AppIcon.appiconset'), (x) => x.endsWith('.png'))) { fs.writeFileSync(f, pngWH(...sizeOf(f), icon(0.08), { alpha: false })); n++; }
  for (const f of filesIn(path.join(dir, 'Splash.imageset'), (x) => x.endsWith('.png'))) { splash(f); n++; }
} else {
  console.error('usage: node scripts/app-images.cjs android|ios <folder>'); process.exit(1);
}
console.log(`app images: ${n} drawn for ${platform}`);
