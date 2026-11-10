import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { removeBackground, detectSolidBackground } from '../scripts/remove-bg.mjs';

let work;
before(() => {
  work = mkdtempSync(join(tmpdir(), 'appmirror-bg-'));
});
after(() => rmSync(work, { recursive: true, force: true }));

// Build a PNG in memory. `paint(x, y)` returns [r, g, b].
function makePng(w, h, paint) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      png.data[i] = r;
      png.data[i + 1] = g;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  }
  return png;
}
function save(name, png) {
  const file = join(work, name);
  writeFileSync(file, PNG.sync.write(png));
  return file;
}
function alphaAt(file, x, y) {
  const png = PNG.sync.read(readFileSync(file));
  return png.data[(y * png.width + x) * 4 + 3];
}
function rgbaAt(file, x, y) {
  const png = PNG.sync.read(readFileSync(file));
  const i = (y * png.width + x) * 4;
  return [...png.data.slice(i, i + 4)];
}

const WHITE = [255, 255, 255];
const RED = [255, 0, 0];
const inBox = (x, y, x0, y0, x1, y1) => x >= x0 && x < x1 && y >= y0 && y < y1;

test('a solid background is removed and the object is kept', async () => {
  const input = save('square.png', makePng(60, 60, (x, y) => (inBox(x, y, 20, 20, 40, 40) ? RED : WHITE)));
  const out = join(work, 'square-out.png');
  const res = await removeBackground(input, { outFile: out });
  assert.equal(res.method, 'color');
  assert.deepEqual(res.bgColor, WHITE);
  assert.equal(alphaAt(out, 2, 2), 0);
  assert.equal(alphaAt(out, 57, 57), 0);
  assert.deepEqual(rgbaAt(out, 30, 30), [255, 0, 0, 255]);
});

test('a same-colored area inside the object is kept (a ring around a white center)', async () => {
  const ring = (x, y) => {
    if (!inBox(x, y, 10, 10, 50, 50)) return WHITE; // outside
    if (inBox(x, y, 20, 20, 40, 40)) return WHITE; // hole, same color as the background
    return RED;
  };
  const input = save('ring.png', makePng(60, 60, ring));
  const out = join(work, 'ring-out.png');
  await removeBackground(input, { outFile: out });
  assert.equal(alphaAt(out, 2, 2), 0, 'outside is transparent');
  assert.equal(alphaAt(out, 30, 30), 255, 'the hole inside the ring stays opaque');
});

test('a background with slight noise is still removed', async () => {
  const noisy = (x, y) => {
    if (inBox(x, y, 20, 20, 40, 40)) return RED;
    const n = (x * 7 + y * 13) % 5; // 0..4
    return [255 - n, 255 - n, 255 - n];
  };
  const input = save('noisy.png', makePng(60, 60, noisy));
  const out = join(work, 'noisy-out.png');
  const res = await removeBackground(input, { outFile: out });
  assert.equal(res.method, 'color');
  assert.equal(alphaAt(out, 3, 3), 0);
  assert.equal(alphaAt(out, 30, 30), 255);
});

test('edge pixels between the background and the object get a partial alpha', async () => {
  // A red object (x 20-39, y 10-29) whose left column (x = 20) is halfway
  // between white and red, on a white background.
  const paint = (x, y) => {
    if (!inBox(x, y, 20, 10, 40, 30)) return WHITE;
    return x === 20 ? [255, 128, 128] : RED;
  };
  const input = save('edge.png', makePng(60, 40, paint));
  const out = join(work, 'edge-out.png');
  await removeBackground(input, { outFile: out });
  const a = alphaAt(out, 20, 20);
  assert.ok(a > 0 && a < 255, `edge alpha should be partial, got ${a}`);
});

test('detectSolidBackground returns the color, or null when the border is not uniform', () => {
  const solid = makePng(40, 40, () => [10, 20, 30]);
  assert.deepEqual(detectSolidBackground(solid), [10, 20, 30]);
  const gradient = makePng(40, 40, (x) => [x * 6, x * 6, x * 6]);
  assert.equal(detectSolidBackground(gradient), null);
});

test('a non-solid background goes through the ML fallback (green disc on a gradient)', async () => {
  const paint = (x, y) => {
    if (Math.hypot(x - 128, y - 140) < 70) return [40, 170, 60];
    return [x, 180 - y / 2, 255 - x]; // gradient background
  };
  const input = save('disc.png', makePng(256, 256, paint));
  const out = join(work, 'disc-out.png');
  const res = await removeBackground(input, { outFile: out });
  assert.equal(res.method, 'ml');
  assert.equal(res.width, 256);
  assert.equal(res.height, 256);
  assert.ok(alphaAt(out, 3, 3) < 30, 'background corner should be transparent');
  assert.ok(alphaAt(out, 128, 150) > 225, 'disc center should stay opaque');
});

test('refuses method "color" when the background is not solid', async () => {
  const gradient = save('gradient.png', makePng(40, 40, (x) => [x * 6, x * 6, x * 6]));
  await assert.rejects(
    removeBackground(gradient, { outFile: join(work, 'g.png'), method: 'color' }),
    /not a solid color/i,
  );
});

test('fails with a clear message when the image does not exist', async () => {
  await assert.rejects(removeBackground(join(work, 'nope.png')), /image not found/i);
});
