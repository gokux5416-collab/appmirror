import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { diffImages } from '../scripts/diff.mjs';

let work;
before(() => {
  work = mkdtempSync(join(tmpdir(), 'appmirror-diff-'));
});
after(() => rmSync(work, { recursive: true, force: true }));

// Write a w x h PNG. `paint(x, y)` returns [r, g, b].
function makePng(name, w, h, paint) {
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
  const file = join(work, name);
  writeFileSync(file, PNG.sync.write(png));
  return file;
}

const black = () => [0, 0, 0];
const white = () => [255, 255, 255];

test('two identical images score exactly 100', async () => {
  const a = makePng('same-a.png', 40, 80, black);
  const b = makePng('same-b.png', 40, 80, black);
  const res = await diffImages(a, b);
  assert.equal(res.score, 100);
  assert.equal(res.diffPixels, 0);
});

test('a black image against a white image scores 0', async () => {
  const a = makePng('black.png', 40, 80, black);
  const b = makePng('white.png', 40, 80, white);
  const res = await diffImages(a, b);
  assert.equal(res.score, 0);
});

test('an image where the top half differs scores 50', async () => {
  const a = makePng('half-a.png', 40, 80, black);
  const b = makePng('half-b.png', 40, 80, (x, y) => (y < 40 ? [255, 255, 255] : [0, 0, 0]));
  const res = await diffImages(a, b);
  assert.equal(res.score, 50);
  assert.equal(res.diffPixels, 40 * 40);
  assert.equal(res.totalPixels, 40 * 80);
});

test('writes a diff image when asked', async () => {
  const a = makePng('out-a.png', 40, 80, black);
  const b = makePng('out-b.png', 40, 80, white);
  const outFile = join(work, 'diff-out.png');
  await diffImages(a, b, { outFile });
  assert.ok(existsSync(outFile));
});

test('scales the second image to the size of the first (original vs clone screenshot)', async () => {
  const original = makePng('big.png', 200, 400, black); // e.g. a phone recording frame
  const clone = makePng('small.png', 100, 200, black); // e.g. a browser screenshot
  const res = await diffImages(original, clone);
  assert.equal(res.width, 200);
  assert.equal(res.height, 400);
  assert.equal(res.resized, true);
  assert.equal(res.score, 100);
});

test('refuses to compare images with very different shapes', async () => {
  const a = makePng('tall.png', 100, 200, black);
  const b = makePng('wide.png', 200, 100, black);
  await assert.rejects(diffImages(a, b), /aspect ratio/i);
});

test('fails with a clear message when a file does not exist', async () => {
  const a = makePng('exists.png', 10, 10, black);
  await assert.rejects(diffImages(a, join(work, 'nope.png')), /image not found/i);
});
