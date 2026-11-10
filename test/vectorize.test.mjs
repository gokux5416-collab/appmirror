import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { makeFrame, savePng } from '../testlib/synth.mjs';
import { diffImages } from '../scripts/diff.mjs';
import { vectorize } from '../scripts/vectorize.mjs';

let work;
let browser;
before(async () => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'vec-'));
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
});

// Draw an SVG in a browser on a transparent background and save it as a PNG.
async function render(svgFile, w, h, outFile) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const svg = fs.readFileSync(svgFile);
  await page.setContent(`<body style="margin:0;background:transparent"><img style="display:block" width="${w}" height="${h}" src="data:image/svg+xml;base64,${svg.toString('base64')}"></body>`);
  await page.screenshot({ path: outFile, omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  await page.close();
}

test('a two-colored shape on a transparent background becomes an SVG that looks the same', async () => {
  const png = path.join(work, 'part.png');
  savePng(
    makeFrame(120, 100, [
      { rect: [20, 20, 80, 60], color: [255, 140, 0] },
      { rect: [40, 35, 30, 30], color: [255, 230, 0] },
    ]),
    png,
  );
  const out = path.join(work, 'part.svg');
  const res = await vectorize(png, { outFile: out });
  assert.deepEqual([res.width, res.height], [120, 100]);
  assert.ok(res.paths >= 2, `at least one path per color (got ${res.paths})`);
  const svg = fs.readFileSync(out, 'utf8');
  assert.match(svg, /<svg/);
  const back = path.join(work, 'part-back.png');
  await render(out, 120, 100, back);
  const { score } = await diffImages(png, back);
  assert.ok(score >= 95, `the SVG should look like the image (score ${score})`);
});

test('the transparent area stays transparent (no background shape is drawn)', async () => {
  const png = path.join(work, 'dot.png');
  savePng(makeFrame(80, 80, [{ rect: [30, 30, 20, 20], color: [200, 0, 0] }]), png);
  const out = path.join(work, 'dot.svg');
  await vectorize(png, { outFile: out });
  const back = path.join(work, 'dot-back.png');
  await render(out, 80, 80, back);
  const { PNG } = await import('pngjs');
  const img = PNG.sync.read(fs.readFileSync(back));
  const alphaAt = (x, y) => img.data[(y * img.width + x) * 4 + 3];
  assert.equal(alphaAt(5, 5), 0, 'corner stays transparent');
  assert.equal(alphaAt(40, 40), 255, 'the dot is drawn');
});

test('an image that does not exist fails with a clear message', async () => {
  await assert.rejects(() => vectorize(path.join(work, 'nope.png')), /not found/i);
});
