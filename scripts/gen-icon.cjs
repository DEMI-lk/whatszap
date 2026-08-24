// Generates assets/icon.png (256x256) without external dependencies:
// a WhatsApp-green disc with a white speech-bubble "tail" and a phone glyph,
// encoded as a valid PNG via zlib (Node built-in).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 256;
const CX = SIZE / 2;
const CY = SIZE / 2 - 6;
const R = SIZE * 0.42;

function inDisc(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function roundedRect(x, y, rx, ry, w, h, rad) {
  if (x < rx || x >= rx + w || y < ry || y >= ry + h) return false;
  const nx = Math.max(rx + rad, Math.min(x, rx + w - rad));
  const ny = Math.max(ry + rad, Math.min(y, ry + h - rad));
  const dx = x - nx, dy = y - ny;
  return dx === 0 || dy === 0 || dx * dx + dy * dy <= rad * rad;
}

const pixels = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const i = (y * SIZE + x) * 4;
    let r = 0, g = 0, b = 0, a = 0;

    // Green disc with subtle vertical gradient
    if (inDisc(x, y, CX, CY, R)) {
      const t = y / SIZE;
      r = Math.round(37 * (1 - t) + 18 * t);
      g = Math.round(211 * (1 - t) + 140 * t);
      b = Math.round(102 * (1 - t) + 60 * t);
      a = 255;

      // White bubble cutout
      const bx = SIZE * 0.30, by = SIZE * 0.26, bw = SIZE * 0.40, bh = SIZE * 0.36, brad = SIZE * 0.10;
      const tail =
        y > by + bh - 2 && y < by + bh + SIZE * 0.09 &&
        x > bx + SIZE * 0.02 && x < bx + SIZE * 0.14 &&
        x + (y - (by + bh)) * 0.9 > bx + SIZE * 0.02;
      if (roundedRect(x, y, bx, by, bw, bh, brad) || tail) {
        r = g = b = 255; a = 255;
      }
    }

    pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
  }
}

// PNG encoding -------------------------------------------------------------
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // RGBA

// Raw scanlines: each prefixed with filter byte 0.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const outDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'icon.png');
if (!fs.existsSync(outPath)) {
  fs.writeFileSync(outPath, png);
  console.log('[gen-icon] wrote', outPath);
} else {
  console.log('[gen-icon] icon already exists');
}
