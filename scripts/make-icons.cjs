// Draws the app icon (a white helmet on a red disc, on black) as PNGs at the sizes the app stores and phones want.
//   node scripts/make-icons.cjs <out folder>
const fs = require('fs'), path = require('path'), zlib = require('zlib');

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // 4x4 supersampling for smooth edges
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) { const c = pixel((x + (sx + 0.5) / 4) / size, (y + (sy + 0.5) / 4) / size); r += c[0]; g += c[1]; b += c[2]; }
      const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r / 16; raw[o + 1] = g / 16; raw[o + 2] = b / 16; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const BLACK = [11, 11, 11], RED = [226, 35, 26], WHITE = [255, 255, 255];
// pad: 0..1, how much the art shrinks (maskable icons need a safe zone)
const icon = (pad) => (u, v) => {
  const x = (u - 0.5) / (1 - pad) + 0.5, y = (v - 0.5) / (1 - pad) + 0.5;
  const d = Math.hypot(x - 0.5, y - 0.5);
  if (d > 0.44) return BLACK;
  // helmet: a dome and cheek guards, with a T-shaped opening; a crest along the top
  const dome = Math.hypot(x - 0.5, y - 0.47) < 0.205 && y < 0.5;
  const guards = x > 0.295 && x < 0.705 && y >= 0.47 && y < 0.72 && !(y > 0.66 && Math.abs(x - 0.5) < 0.12);
  const slot = (Math.abs(x - 0.5) < 0.035 && y > 0.5 && y < 0.72) || (x > 0.35 && x < 0.65 && y > 0.5 && y < 0.565);
  const crest = Math.abs(x - 0.5) < 0.05 && y > 0.17 && y < 0.3;
  if (crest) return WHITE;
  if ((dome || guards) && !slot) return WHITE;
  return RED;
};
module.exports = { png, icon };
if (require.main === module) {
  const out = process.argv[2] || 'icons';
  fs.mkdirSync(out, { recursive: true });
  for (const [name, size, pad] of [['icon-180.png', 180, 0.08], ['icon-192.png', 192, 0.08], ['icon-512.png', 512, 0.08], ['icon-maskable-512.png', 512, 0.22], ['icon-1024.png', 1024, 0.08]]) {
    fs.writeFileSync(path.join(out, name), png(size, icon(pad)));
    console.log('wrote', name);
  }
}
