#!/usr/bin/env node
// Remove the background of an image (a mascot or an animated object cut out of a
// video frame). Writes a PNG with a transparent background.
//
// - Solid background: its color is removed. Only pixels connected to the image
//   border are removed, so a same-colored area inside the object is kept (the
//   white of an eye, the hole of a ring). Edge pixels get a partial alpha.
// - Any other background: @imgly/background-removal-node (a neural network).
//   --method forces one or the other; "auto" picks by looking at the border.
//
// Usage:
//   node scripts/remove-bg.mjs frame.png [--out frame-nobg.png] [--method auto|color|ml] [--tolerance 24]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const DEFAULT_TOLERANCE = 24; // RGB distance under which a pixel counts as "background"
const SOLID_SHARE = 0.95; // share of border pixels that must match for a solid background

const dist = (data, i, c) => Math.hypot(data[i] - c[0], data[i + 1] - c[1], data[i + 2] - c[2]);
const median = (values) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function borderIndexes(w, h) {
  const idx = [];
  for (let x = 0; x < w; x++) idx.push(x, (h - 1) * w + x);
  for (let y = 1; y < h - 1; y++) idx.push(y * w, y * w + w - 1);
  return idx;
}

// The background color if the image border is (almost) one color, else null.
export function detectSolidBackground(png, tolerance = DEFAULT_TOLERANCE) {
  const { width: w, height: h, data } = png;
  const border = borderIndexes(w, h);
  const color = [0, 1, 2].map((ch) => median(border.map((p) => data[p * 4 + ch])));
  const matching = border.filter((p) => dist(data, p * 4, color) <= tolerance).length;
  return matching / border.length >= SOLID_SHARE ? color : null;
}

// Make every pixel connected to the border (and close to `bg`) transparent, then
// soften the pixels at the edge of the object.
function removeSolid(png, bg, tolerance) {
  const { width: w, height: h, data } = png;
  const removed = new Uint8Array(w * h);

  // 1. Flood fill from the border (4-connectivity, so it cannot leak diagonally).
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (p) => {
    if (!removed[p] && dist(data, p * 4, bg) <= tolerance) {
      removed[p] = 1;
      queue[tail++] = p;
    }
  };
  for (const p of borderIndexes(w, h)) push(p);
  while (head < tail) {
    const p = queue[head++];
    const x = p % w;
    const y = (p / w) | 0;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (y > 0) push(p - w);
    if (y < h - 1) push(p + w);
  }

  // 2. Edge pixels: kept pixels that touch a removed one.
  const touchesRemoved = (p) => {
    const x = p % w;
    const y = (p / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if ((dx || dy) && nx >= 0 && nx < w && ny >= 0 && ny < h && removed[ny * w + nx]) return true;
      }
    }
    return false;
  };
  const edge = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) if (!removed[p] && touchesRemoved(p)) edge[p] = 1;

  // The object color next to an edge pixel: the nearest interior pixel (not
  // removed, not an edge) within 2 pixels.
  const objectColorNear = (p) => {
    const x = p % w;
    const y = (p / w) | 0;
    let best = -1;
    let bestD = Infinity;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const q = ny * w + nx;
        if (removed[q] || edge[q]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    return best;
  };

  const alphas = new Map();
  for (let p = 0; p < w * h; p++) {
    if (!edge[p]) continue;
    const q = objectColorNear(p);
    if (q < 0) continue; // thin object: keep as is
    const fullDist = dist(data, q * 4, bg);
    if (fullDist <= tolerance) continue;
    const a = Math.min(1, dist(data, p * 4, bg) / fullDist);
    if (a < 0.98) alphas.set(p, a);
  }

  // 3. Write the result.
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (removed[p]) {
      data[i + 3] = 0;
    } else if (alphas.has(p)) {
      const a = alphas.get(p);
      for (let ch = 0; ch < 3; ch++) {
        // Undo the mix with the background: pixel = a * object + (1 - a) * bg.
        data[i + ch] = Math.max(0, Math.min(255, Math.round((data[i + ch] - (1 - a) * bg[ch]) / a)));
      }
      data[i + 3] = Math.round(a * 255);
    }
  }
  return removed.reduce((n, v) => n + v, 0);
}

export async function removeBackground(
  file,
  { outFile, method = 'auto', tolerance = DEFAULT_TOLERANCE, bgColor: given = null } = {},
) {
  if (!file || !existsSync(file)) throw new Error(`image not found: ${file}`);
  if (!['auto', 'color', 'ml'].includes(method)) throw new Error(`unknown method: ${method}`);
  const png = PNG.sync.read(readFileSync(file));
  const out = outFile ?? file.replace(/(\.png)?$/i, '-nobg.png');

  // A color given by the caller wins: needed when the object touches the image border.
  const bgColor = method === 'ml' ? null : given ?? detectSolidBackground(png, tolerance);
  if (!bgColor && method === 'color') throw new Error('the background is not a solid color');

  if (!bgColor) {
    const { width, height } = await removeWithMl(file, out);
    return { outFile: out, method: 'ml', bgColor: null, width, height };
  }

  const removedPixels = removeSolid(png, bgColor, tolerance);
  writeFileSync(out, PNG.sync.write(png));
  return { outFile: out, method: 'color', bgColor, width: png.width, height: png.height, removedPixels };
}

// Fallback for non-solid backgrounds: a neural network (about 5 s per image).
// The package is large, so it is an optional dependency, loaded only when needed.
async function removeWithMl(file, outFile) {
  let imgly;
  try {
    imgly = await import('@imgly/background-removal-node');
  } catch {
    throw new Error(
      'this background is not a solid color, and @imgly/background-removal-node is not installed (npm install @imgly/background-removal-node)',
    );
  }
  const blob = await imgly.removeBackground(pathToFileURL(resolve(file)).href, {
    output: { format: 'image/png' },
  });
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync(outFile, buf);
  const { width, height } = PNG.sync.read(buf);
  return { width, height };
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      method: { type: 'string', default: 'auto' },
      tolerance: { type: 'string', default: String(DEFAULT_TOLERANCE) },
      bg: { type: 'string' }, // background color r,g,b
    },
  });
  const [file] = positionals;
  if (!file) {
    console.error('Usage: node scripts/remove-bg.mjs image.png [--out out.png] [--method auto|color|ml] [--tolerance 24] [--bg r,g,b]');
    process.exit(2);
  }
  removeBackground(file, {
    outFile: values.out,
    method: values.method,
    tolerance: Number(values.tolerance),
    bgColor: values.bg ? values.bg.split(',').map(Number) : null,
  })
    .then((res) => console.log(JSON.stringify(res, null, 2)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
