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

test('a given background color works even when the object touches the image border', () => {
  // orange background, a blue object that runs off the top-left edges
  const file = save('touching.png', makePng(40, 40, (x, y) => (x < 20 && y < 20 ? [0, 0, 255] : [252, 137, 0])));
  const out = join(work, 'touching-out.png');
  return removeBackground(file, { outFile: out, method: 'color', bgColor: [252, 137, 0] }).then((res) => {
    assert.deepEqual(res.bgColor, [252, 137, 0]);
    assert.equal(alphaAt(out, 35, 35), 0, 'background removed');
    assert.equal(alphaAt(out, 5, 5), 255, 'object kept');
  });
});

// ---- vertical gradient backgrounds -----------------------------------------
import { detectGradientBackground, simplifyGradient } from '../scripts/remove-bg.mjs';

// background: red goes 255 -> 105 from top to bottom (rows), green 140, blue 0
const gradientBg = (y, h) => [Math.round(255 - (150 * y) / (h - 1)), 140, 0];

test('detectGradientBackground reads the background color of every row', () => {
  const h = 60;
  const png = makePng(40, h, (x, y) => (x >= 12 && x < 28 && y >= 20 && y < 40 ? [0, 0, 255] : gradientBg(y, h)));
  const rows = detectGradientBackground(png);
  assert.equal(rows.length, h);
  for (const y of [0, 20, 30, 59]) {
    const want = gradientBg(y, h);
    assert.ok(Math.abs(rows[y][0] - want[0]) <= 1, `row ${y}: ${rows[y]} vs ${want}`);
  }
});

test('detectGradientBackground gives up when the border is noisy', () => {
  const png = makePng(40, 40, (x, y) => [(x * 53 + y * 97) % 256, (x * 31 + y * 17) % 256, (x * 7 + y * 211) % 256]);
  assert.equal(detectGradientBackground(png), null);
});

test('method "gradient" removes a gradient background and keeps the object', async () => {
  const h = 60;
  // the object is as orange as the background at the TOP, but sits low where the background is darker
  const file = save('grad.png', makePng(40, h, (x, y) => (x >= 12 && x < 28 && y >= 30 && y < 50 ? [255, 140, 0] : gradientBg(y, h))));
  const out = join(work, 'grad-out.png');
  const res = await removeBackground(file, { outFile: out, method: 'gradient' });
  assert.equal(res.method, 'gradient');
  for (const [x, y] of [[2, 2], [2, 58], [37, 30], [20, 5]]) assert.equal(alphaAt(out, x, y), 0, `background at ${x},${y}`);
  assert.equal(alphaAt(out, 20, 40), 255, 'object kept');
});

test('side "right" ignores an object that touches the left edge', async () => {
  const h = 60;
  const file = save('gradleft.png', makePng(40, h, (x, y) => (x < 15 && y >= 20 && y < 40 ? [0, 0, 255] : gradientBg(y, h))));
  const out = join(work, 'gradleft-out.png');
  await removeBackground(file, { outFile: out, method: 'gradient', side: 'right' });
  assert.equal(alphaAt(out, 5, 30), 255, 'object on the left edge kept');
  assert.equal(alphaAt(out, 30, 30), 0, 'background removed');
});

test('simplifyGradient keeps only the stops needed to redraw the gradient', () => {
  const straight = Array.from({ length: 100 }, (_, y) => [255 - y, 140, 0]);
  assert.equal(simplifyGradient(straight).length, 2);
  const kinked = Array.from({ length: 100 }, (_, y) => [y < 50 ? 255 : 255 - (y - 50) * 3, 140, 0]);
  const stops = simplifyGradient(kinked);
  assert.equal(stops.length, 3);
  assert.deepEqual(stops.map((s) => s.y), [0, 50, 99]);
});
