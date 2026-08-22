/**
 * Draws the application icons.
 *
 * They are generated rather than committed as binaries so the brand
 * colour lives in one place: change BRAND below and every size, the
 * maskable variant and the favicon follow. No image library is
 * involved - a PNG is a zlib stream with a CRC per chunk, and the mark
 * is simple enough to rasterise directly.
 *
 *   node scripts/icons/generate.mjs
 */
import { deflateSync } from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "..", "public", "icons");
fs.mkdirSync(out, { recursive: true });

// The sidebar mark's green, and the ink it sits on.
const BRAND = [15, 92, 66];
const INK = [255, 255, 255];

// ---------------------------------------------------------------- PNG
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** RGBA pixels to a PNG buffer. */
function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // truecolour with alpha
  // Each scanline is prefixed with its filter type; 0 means none, which
  // costs a little size and saves implementing the filters.
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------ drawing
const dist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

/**
 * The mark: a rounded square in the brand green carrying a "G".
 *
 * Rendered by asking, for each sample, how far it is from the shapes -
 * which gives clean edges at any size without a font or a rasteriser.
 * Four samples per pixel is enough to remove the stair-stepping.
 */
function drawIcon(size, { maskable = false } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const S = 2;                                   // supersampling factor
  // A maskable icon may be cropped to a circle by the launcher, so the
  // artwork is drawn smaller inside its safe zone.
  const inset = maskable ? size * 0.18 : size * 0.06;
  const radius = maskable ? size * 0.5 : size * 0.22;
  const cx = size / 2, cy = size / 2;

  const ringR = (size - inset * 2) * 0.27;
  const stroke = Math.max(1.5, size * 0.075);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S;
          const py = y + (sy + 0.5) / S;

          // Rounded-square background.
          const qx = Math.max(inset + radius - px, 0, px - (size - inset - radius));
          const qy = Math.max(inset + radius - py, 0, py - (size - inset - radius));
          if (Math.hypot(qx, qy) <= radius) bg++;

          // The "G": an open ring with a bar into the centre.
          const r = Math.hypot(px - cx, py - cy);
          const angle = Math.atan2(py - cy, px - cx);
          const onRing =
            Math.abs(r - ringR) <= stroke / 2 &&
            // Opening on the right, between roughly -35 and +35 degrees.
            !(angle > -0.6 && angle < 0.6);
          const onBar =
            dist(px, py, cx + ringR * 0.05, cy + ringR * 0.34,
                 cx + ringR * Math.cos(0.6), cy + ringR * Math.sin(0.6)) <= stroke / 2;
          if (onRing || onBar) fg++;
        }
      }

      const total = S * S;
      const i = (y * size + x) * 4;
      const bgA = bg / total;
      const fgA = fg / total;

      // Foreground over background, background over nothing.
      const a = Math.max(bgA, 0);
      const mix = (c1, c2) => Math.round(c1 * (1 - fgA) + c2 * fgA);
      rgba[i] = mix(BRAND[0], INK[0]);
      rgba[i + 1] = mix(BRAND[1], INK[1]);
      rgba[i + 2] = mix(BRAND[2], INK[2]);
      rgba[i + 3] = Math.round(255 * a);
    }
  }
  return png(size, size, rgba);
}

const written = [];
for (const size of [192, 512]) {
  const file = path.join(out, `icon-${size}.png`);
  fs.writeFileSync(file, drawIcon(size));
  written.push(`icon-${size}.png`);
}
fs.writeFileSync(path.join(out, "icon-maskable-512.png"), drawIcon(512, { maskable: true }));
written.push("icon-maskable-512.png");

// iOS ignores the manifest for the home-screen icon and uses this.
fs.writeFileSync(path.join(out, "apple-touch-icon.png"), drawIcon(180));
written.push("apple-touch-icon.png");

fs.writeFileSync(path.join(out, "favicon-32.png"), drawIcon(32));
written.push("favicon-32.png");

console.log(`wrote ${written.length} icons to public/icons:`);
for (const w of written) {
  const { size } = fs.statSync(path.join(out, w));
  console.log(`  ${w}  ${(size / 1024).toFixed(1)} KB`);
}
