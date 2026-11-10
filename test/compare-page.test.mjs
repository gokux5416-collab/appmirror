import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { buildComparePage, comparePage } from '../scripts/compare-page.mjs';

let work;
before(() => { work = mkdtempSync(join(tmpdir(), 'appmirror-cmp-')); });
after(() => rmSync(work, { recursive: true, force: true }));

function png(file, [r, g, b], { w = 20, h = 40, dotAt } = {}) {
  const img = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) { img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
  if (dotAt) for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) { const k = ((dotAt[1] + y) * w + dotAt[0] + x) * 4; img.data[k] = 0; img.data[k + 1] = 0; img.data[k + 2] = 0; }
  writeFileSync(file, PNG.sync.write(img));
}

const report = (extra = {}) => ({
  title: 'Demo app',
  screens: [
    { id: 'home', original: join(work, 'a.png'), clone: join(work, 'b.png'), score: 99.9 },
    { id: 'wifi', original: join(work, 'a.png'), clone: join(work, 'b.png'), score: 70.25 },
  ],
  ...extra,
});

before(() => { png(join(work, 'a.png'), [200, 200, 200]); png(join(work, 'b.png'), [200, 200, 200]); });

test('shows every screen with original, clone and score, in one self-contained file', () => {
  const html = buildComparePage(report());
  assert.match(html, /<title>Demo app/);
  for (const id of ['home', 'wifi']) assert.ok(html.includes(`id="screen-${id}"`), id);
  assert.equal((html.match(/data:image\/png;base64,/g) ?? []).length, 4);
  assert.ok(html.includes('99.9 %') && html.includes('70.3 %'));
  assert.doesNotMatch(html, /src="(?!data:)/, 'no external image');
});

test('shows the average score and marks screens under 85 % as low', () => {
  const html = buildComparePage(report());
  assert.match(html, /Average[^<]*85\.1 %/);
  assert.match(html, /id="screen-wifi"[^>]*class="[^"]*low/);
  assert.doesNotMatch(html, /id="screen-home"[^>]*class="[^"]*low/);
});

test('escapes text coming from the app', () => {
  const html = buildComparePage(report({ title: '<script>alert(1)</script>' }));
  assert.doesNotMatch(html, /<script>alert\(1\)/);
  assert.match(html, /&lt;script&gt;/);
});

test('shows an animation with a slider over its frame pairs', () => {
  const html = buildComparePage(report({
    animations: [{ id: 'slide', label: 'Home to Wi-Fi', fps: 30, pairs: [
      { timeMs: 0, original: join(work, 'a.png'), clone: join(work, 'b.png'), score: 95 },
      { timeMs: 100, original: join(work, 'a.png'), clone: join(work, 'b.png'), score: 90 },
    ] }],
  }));
  assert.ok(html.includes('id="anim-slide"'));
  assert.match(html, /<input type="range"[^>]*max="1"/);
  assert.match(html, /Home to Wi-Fi/);
});

test('comparePage reads an app-map, scores each screen and writes compare.html and report.json', async () => {
  const dir = join(work, 'run');
  mkdirSync(join(dir, 'frames'), { recursive: true });
  mkdirSync(join(dir, 'captures'), { recursive: true });
  png(join(dir, 'frames', 'home.png'), [255, 255, 255]);
  png(join(dir, 'captures', 'home.png'), [255, 255, 255]);
  png(join(dir, 'frames', 'wifi.png'), [255, 255, 255]);
  png(join(dir, 'captures', 'wifi.png'), [255, 255, 255], { dotAt: [2, 2] });
  const map = { app: { name: 'Demo' }, screens: [{ id: 'home', frame: 'frames/home.png' }, { id: 'wifi', frame: 'frames/wifi.png' }], animations: [] };
  writeFileSync(join(dir, 'app-map.json'), JSON.stringify(map));
  const res = await comparePage({ map: join(dir, 'app-map.json'), captures: join(dir, 'captures'), outFile: join(dir, 'compare.html') });
  assert.equal(res.screens.find((s) => s.id === 'home').score, 100);
  assert.ok(res.screens.find((s) => s.id === 'wifi').score < 100);
  assert.ok(existsSync(join(dir, 'compare.html')));
  const saved = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
  assert.equal(saved.screens.length, 2);
  assert.equal(typeof saved.average, 'number');
});

test('comparePage names the screen whose capture is missing', async () => {
  const dir = join(work, 'run2');
  mkdirSync(join(dir, 'frames'), { recursive: true });
  mkdirSync(join(dir, 'captures'), { recursive: true });
  png(join(dir, 'frames', 'home.png'), [255, 255, 255]);
  writeFileSync(join(dir, 'app-map.json'), JSON.stringify({ app: { name: 'D' }, screens: [{ id: 'home', frame: 'frames/home.png' }] }));
  await assert.rejects(comparePage({ map: join(dir, 'app-map.json'), captures: join(dir, 'captures'), outFile: join(dir, 'c.html') }), /home/);
});

test('CLI runs from the command line', () => {
  const dir = join(work, 'run3');
  mkdirSync(join(dir, 'frames'), { recursive: true });
  mkdirSync(join(dir, 'captures'), { recursive: true });
  png(join(dir, 'frames', 'home.png'), [10, 20, 30]);
  png(join(dir, 'captures', 'home.png'), [10, 20, 30]);
  writeFileSync(join(dir, 'app-map.json'), JSON.stringify({ app: { name: 'D' }, screens: [{ id: 'home', frame: 'frames/home.png' }] }));
  const out = execFileSync('node', ['scripts/compare-page.mjs', '--map', join(dir, 'app-map.json'), '--captures', join(dir, 'captures'), '--out', join(dir, 'compare.html')], { encoding: 'utf8' });
  assert.match(out, /100/);
  assert.ok(existsSync(join(dir, 'compare.html')));
});
