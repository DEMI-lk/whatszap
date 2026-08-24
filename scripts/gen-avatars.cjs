// Generates assets/avatars/a1.png .. a8.png (128x128): simple geometric
// avatar placeholders on colored gradients. No external dependencies.
// Only writes files that don't exist yet (deterministic output).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 128;
const CX = SIZE / 2;
const CY = SIZE / 2;

const COLORS = [
  ['#0e7490', '#164e63'], // cyan
  ['#7c3aed', '#4c1d95'], // violet
  ['#d97706', '#92400e'], // amber
  ['#e11d48', '#881337'], // rose
  ['#059669', '#064e3b'], // emerald
  ['#4f46e5', '#312e81'], // indigo
  ['#ea580c', '#7c2d12'], // orange
  ['#0891b2', '#155e75'], // teal
];

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

const dist = (x, y, cx, cy) => Math.hypot(x - cx, y - cy);

function pointInPolygon(px, py, verts) {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const [xi, yi] = verts[i];
    const [xj, yj] = verts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function starVerts() {
  const v = [];
  for (let i = 0; i < 10; i++) {
    const a = (-90 + i * 36) * (Math.PI / 180);
    const r = i % 2 === 0 ? 38 : 16;
    v.push([CX + r * Math.cos(a), CY + r * Math.sin(a)]);
  }
  return v;
}

const SHAPES = [
  // 1: ring
  (x, y) => { const d = dist(x, y, CX, CY); return d <= 40 && d >= 26; },
  // 2: triangle
  (x, y) => pointInPolygon(x, y, [[CX, 28], [30, 92], [98, 92]]),
  // 3: diamond
  (x, y) => Math.abs(x - CX) + Math.abs(y - CY) <= 34,
  // 4: cross
  (x, y) => (Math.abs(x - CX) <= 11 && Math.abs(y - CY) <= 34) || (Math.abs(y - CY) <= 11 && Math.abs(x - CX) <= 34),
  // 5: crescent
  (x, y) => dist(x, y, CX, CY) <= 38 && dist(x, y, CX + 16, CY - 10) >= 30,
  // 6: star
  (x, y) => pointInPolygon(x, y, starVerts()),
  // 7: heart
  (x, y) =>
    dist(x, y, 49, 52) <= 19 || dist(x, y, 79, 52) <= 19 ||
    pointInPolygon(x, y, [[31, 62], [97, 62], [64, 104]]),
  // 8: target
  (x, y) => { const d = dist(x, y, CX, CY); return d <= 14 || (d <= 40 && d >= 28); },
];

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

function encodePng(pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outDir = path.join(__dirname, '..', 'assets', 'avatars');
fs.mkdirSync(outDir, { recursive: true });

for (let n = 0; n < 8; n++) {
  const outPath = path.join(outDir, `a${n + 1}.png`);
  if (fs.existsSync(outPath)) continue;
  const [tr, tg, tb] = hex(COLORS[n][0]);
  const [br, bg, bb] = hex(COLORS[n][1]);
  const shape = SHAPES[n];
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    const t = y / (SIZE - 1);
    const r = Math.round(tr * (1 - t) + br * t);
    const g = Math.round(tg * (1 - t) + bg * t);
    const b = Math.round(tb * (1 - t) + bb * t);
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const s = shape(x, y);
      pixels[i] = s ? 255 : r;
      pixels[i + 1] = s ? 255 : g;
      pixels[i + 2] = s ? 255 : b;
      pixels[i + 3] = 255;
    }
  }
  fs.writeFileSync(outPath, encodePng(pixels));
  console.log('[gen-avatars] wrote', outPath);
}
console.log('[gen-avatars] done');
