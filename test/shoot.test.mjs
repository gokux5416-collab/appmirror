import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { shootScreens, shootAnimation } from '../scripts/shoot.mjs';

// A tiny local site standing in for Expo Web:
//   /        red page
//   /lesson  blue page
//   /anim    white page with a red 30px square moving right at 100 px/s (driven by rAF)
const PAGES = {
  '/': '<body style="margin:0;background:#f00">',
  '/lesson': '<body style="margin:0;background:#00f">',
  '/anim': `<body style="margin:0;background:#fff">
    <div id="s" style="position:absolute;top:90px;left:0;width:30px;height:30px;background:#f00"></div>
    <script>
      let start = null;
      function f(ts) {
        if (start === null) start = ts;
        document.getElementById('s').style.left = ((ts - start) / 10) + 'px';
        requestAnimationFrame(f);
      }
      requestAnimationFrame(f);
    </script>`,
  // Nothing moves until #go is clicked; then a red square moves right at 100 px/s.
  '/click-anim': `<body style="margin:0;background:#fff">
    <div id="go" style="position:absolute;top:300px;left:0;width:60px;height:30px;background:#0a0"></div>
    <div id="s" style="display:none;position:absolute;top:90px;left:0;width:30px;height:30px;background:#f00"></div>
    <script>
      document.getElementById('go').onclick = () => {
        const sq = document.getElementById('s');
        sq.style.display = 'block';
        let start = null;
        function f(ts) {
          if (start === null) start = ts;
          sq.style.left = ((ts - start) / 10) + 'px';
          requestAnimationFrame(f);
        }
        requestAnimationFrame(f);
      };
    </script>`,
};

let server;
let base;
let work;

before(async () => {
  work = mkdtempSync(join(tmpdir(), 'appmirror-shoot-'));
  server = createServer((req, res) => {
    const html = PAGES[req.url];
    if (!html) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end(html);
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((ok) => server.close(ok));
  rmSync(work, { recursive: true, force: true });
});

function readPng(file) {
  return PNG.sync.read(readFileSync(file));
}
function pixel(png, x, y) {
  const i = (y * png.width + x) * 4;
  return [png.data[i], png.data[i + 1], png.data[i + 2]];
}

test('screens are captured at 390x844 with the right content', async () => {
  const res = await shootScreens({
    baseUrl: base,
    screens: [
      { id: 'home', path: '/' },
      { id: 'lesson', path: '/lesson' },
    ],
    outDir: join(work, 'screens'),
  });
  assert.deepEqual(res.map((r) => r.id), ['home', 'lesson']);
  const home = readPng(res[0].file);
  const lesson = readPng(res[1].file);
  assert.equal(home.width, 390);
  assert.equal(home.height, 844);
  assert.deepEqual(pixel(home, 200, 400), [255, 0, 0]);
  assert.deepEqual(pixel(lesson, 200, 400), [0, 0, 255]);
});

test('an animation is captured at exact instants (the clock is controlled)', async () => {
  const res = await shootAnimation({
    url: `${base}/anim`,
    id: 'square',
    times: [0, 500, 1000],
    outDir: join(work, 'anim'),
  });
  assert.deepEqual(res.map((r) => r.timeMs), [0, 500, 1000]);
  const [t0, t500, t1000] = res.map((r) => readPng(r.file));
  // The square moves 100 px per second, so its left edge is at 0, ~50 and ~100.
  assert.deepEqual(pixel(t0, 15, 105), [255, 0, 0]);
  assert.deepEqual(pixel(t0, 65, 105), [255, 255, 255]);
  assert.deepEqual(pixel(t500, 65, 105), [255, 0, 0]);
  assert.deepEqual(pixel(t500, 15, 105), [255, 255, 255]);
  assert.deepEqual(pixel(t1000, 115, 105), [255, 0, 0]);
  assert.deepEqual(pixel(t1000, 65, 105), [255, 255, 255]);
});

test('an animation capture can be limited to a zone', async () => {
  const res = await shootAnimation({
    url: `${base}/anim`,
    id: 'zone',
    times: [0],
    clip: { x: 0, y: 80, w: 200, h: 60 },
    outDir: join(work, 'zone'),
  });
  const png = readPng(res[0].file);
  assert.equal(png.width, 200);
  assert.equal(png.height, 60);
});

test('fails with a clear message when the site cannot be opened', async () => {
  await assert.rejects(
    shootScreens({
      baseUrl: 'http://127.0.0.1:9',
      screens: [{ id: 'home', path: '/' }],
      outDir: join(work, 'down'),
    }),
    /cannot open http:\/\/127\.0\.0\.1:9/i,
  );
});

test('fails with a clear message when a page returns an error', async () => {
  await assert.rejects(
    shootScreens({
      baseUrl: base,
      screens: [{ id: 'missing', path: '/missing' }],
      outDir: join(work, 'err'),
    }),
    /404/,
  );
  assert.equal(existsSync(join(work, 'err', 'missing.png')), false);
});

test('an animation can start with a click: t = 0 is the moment of the click', async () => {
  const res = await shootAnimation({
    url: `${base}/click-anim`,
    id: 'clicked',
    click: '#go',
    times: [0, 500, 1000],
    outDir: join(work, 'click'),
  });
  const at = (i) => {
    const png = readPng(res[i].file);
    for (let x = 0; x < 300; x++) if (pixel(png, x, 105)[0] === 255 && pixel(png, x, 105)[1] === 0) return x;
    return -1;
  };
  assert.ok(at(0) >= 0 && at(0) < 10, `at 0 ms: ${at(0)}`);
  assert.ok(Math.abs(at(1) - 50) <= 6, `at 500 ms: ${at(1)}`);
  assert.ok(Math.abs(at(2) - 100) <= 6, `at 1000 ms: ${at(2)}`);
});
