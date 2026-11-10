#!/usr/bin/env node
// Step 4 of appmirror: one self-contained page that shows the original and the clone
// side by side, with a similarity score per screen (and per instant for animations).
//
// Usage:
//   node scripts/compare-page.mjs --map app-map.json --captures captures [--out compare.html]
//
// For each screen of app-map.json, the original is the file named in `screen.frame`
// (relative to the app-map) and the clone is `<captures>/<screen id>.png`
// (what `shoot.mjs screens` writes). The scores are also saved in `report.json`
// next to the page, so the compare loop can read them.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { diffImages } from './diff.mjs';

export const VALID_SCORE = 85; // a screen under this score is flagged (spec section 6)

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (n) => `${Number(n).toFixed(1)} %`;
const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function screenHtml(s) {
  const low = s.score < VALID_SCORE;
  return `<section id="screen-${esc(s.id)}" class="screen${low ? ' low' : ''}">
  <h2>${esc(s.label ?? s.id)} <span class="score">${pct(s.score)}</span></h2>
  <div class="pair">
    <figure><img alt="Original ${esc(s.id)}" src="${dataUri(s.original)}"><figcaption>Original</figcaption></figure>
    <figure><img alt="Clone ${esc(s.id)}" src="${dataUri(s.clone)}"><figcaption>Clone</figcaption></figure>
  </div>
</section>`;
}

function animationHtml(a) {
  const pairs = a.pairs.map((p) => ({ t: p.timeMs, o: dataUri(p.original), c: dataUri(p.clone), s: p.score ?? null }));
  const json = JSON.stringify(pairs).replace(/</g, '\\u003c');
  const first = pairs[0];
  return `<section id="anim-${esc(a.id)}" class="screen anim">
  <h2>${esc(a.label ?? a.id)} <span class="score">${a.pairs.length} frames</span></h2>
  <div class="pair">
    <figure><img class="o" alt="Original ${esc(a.id)}" src="${first.o}"><figcaption>Original</figcaption></figure>
    <figure><img class="c" alt="Clone ${esc(a.id)}" src="${first.c}"><figcaption>Clone</figcaption></figure>
  </div>
  <div class="ctl"><button type="button" class="play">Play</button>
    <input type="range" min="0" max="${a.pairs.length - 1}" value="0" step="1">
    <span class="t">0 ms</span></div>
  <script type="application/json" class="data">${json}</script>
</section>`;
}

const SCRIPT = `
document.querySelectorAll('.anim').forEach(function (el) {
  var data = JSON.parse(el.querySelector('.data').textContent);
  var range = el.querySelector('input'), o = el.querySelector('.o'), c = el.querySelector('.c'), t = el.querySelector('.t');
  var timer = null;
  function show(i) { var d = data[i]; o.src = d.o; c.src = d.c; t.textContent = d.t + ' ms' + (d.s == null ? '' : ' · ' + d.s.toFixed(1) + ' %'); range.value = i; }
  range.addEventListener('input', function () { show(+range.value); });
  el.querySelector('.play').addEventListener('click', function () {
    if (timer) { clearInterval(timer); timer = null; return; }
    var i = 0; timer = setInterval(function () { show(i); i = (i + 1) % data.length; }, 100);
  });
});`;

export function buildComparePage({ title = 'appmirror', screens = [], animations = [] }) {
  const avg = mean(screens.map((s) => s.score));
  const ok = screens.filter((s) => s.score >= VALID_SCORE).length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · original vs clone</title>
<style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e8eaed}
header{padding:28px 24px 8px;max-width:1100px;margin:0 auto}
h1{margin:0 0 6px;font-size:28px}
.avg{margin:0;color:#9aa0a6}
main{max-width:1100px;margin:0 auto;padding:8px 24px 48px}
.screen{background:#171a21;border:1px solid #262b36;border-radius:14px;padding:16px 18px;margin:18px 0}
.screen.low{border-color:#c0392b}
h2{margin:0 0 12px;font-size:18px;display:flex;justify-content:space-between;align-items:center}
.score{font-size:14px;background:#1f6f43;color:#fff;border-radius:999px;padding:3px 10px}
.low .score{background:#c0392b}
.pair{display:flex;gap:16px;justify-content:center;flex-wrap:wrap}
figure{margin:0;text-align:center}
img{width:240px;max-width:100%;border-radius:10px;border:1px solid #262b36;background:#fff}
figcaption{margin-top:6px;font-size:13px;color:#9aa0a6}
.ctl{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:12px}
.ctl input{flex:1;max-width:420px}
button{background:#2d6cdf;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer}
</style></head><body>
<header><h1>${esc(title)}</h1>
<p class="avg">Average score ${pct(avg)} · ${ok}/${screens.length} screens at ${VALID_SCORE} % or more</p></header>
<main>
${screens.map(screenHtml).join('\n')}
${animations.map(animationHtml).join('\n')}
</main>
<script>${SCRIPT}</script>
</body></html>`;
}

async function scoreAnimation(a, baseDir) {
  const pairs = [];
  for (const p of a.pairs) {
    const original = resolve(baseDir, p.original);
    const clone = resolve(baseDir, p.clone);
    const score = p.score ?? (await diffImages(original, clone)).score;
    pairs.push({ ...p, original, clone, score });
  }
  return { ...a, pairs };
}

export async function comparePage({ map, captures, outFile = 'compare.html', animations = [] }) {
  if (!map || !existsSync(map)) throw new Error(`app-map not found: ${map}`);
  const mapDir = dirname(resolve(map));
  const data = JSON.parse(readFileSync(map, 'utf8'));
  const screens = [];
  for (const s of data.screens ?? []) {
    const original = resolve(mapDir, s.frame ?? '');
    const clone = resolve(captures, `${s.id}.png`);
    if (!s.frame || !existsSync(original)) throw new Error(`original frame missing for screen "${s.id}": ${original}`);
    if (!existsSync(clone)) throw new Error(`capture missing for screen "${s.id}": ${clone}`);
    const { score } = await diffImages(original, clone);
    screens.push({ id: s.id, original, clone, score });
  }
  const scoredAnimations = [];
  for (const a of animations) scoredAnimations.push(await scoreAnimation(a, mapDir));
  const title = data.app?.name ?? 'appmirror';
  const out = resolve(outFile);
  writeFileSync(out, buildComparePage({ title, screens, animations: scoredAnimations }));
  const average = mean(screens.map((s) => s.score));
  const report = {
    title,
    average,
    screens: screens.map(({ id, score }) => ({ id, score })),
    animations: scoredAnimations.map((a) => ({ id: a.id, scores: a.pairs.map((p) => ({ timeMs: p.timeMs, score: p.score })) })),
  };
  writeFileSync(join(dirname(out), 'report.json'), JSON.stringify(report, null, 2));
  return { outFile: out, average, screens, animations: scoredAnimations };
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      map: { type: 'string' },
      captures: { type: 'string' },
      out: { type: 'string', default: 'compare.html' },
      animations: { type: 'string' }, // optional JSON file: [{id,label,fps,pairs:[{timeMs,original,clone}]}]
    },
  });
  if (!values.map || !values.captures) {
    console.error('Usage: node scripts/compare-page.mjs --map app-map.json --captures captures [--out compare.html] [--animations anim.json]');
    process.exit(2);
  }
  const animations = values.animations ? JSON.parse(readFileSync(values.animations, 'utf8')) : [];
  comparePage({ map: values.map, captures: values.captures, outFile: values.out, animations })
    .then((r) => {
      for (const s of r.screens) console.log(`${s.id}: ${pct(s.score)}${s.score < VALID_SCORE ? '  (under 85 %)' : ''}`);
      console.log(`average: ${pct(r.average)}\n${r.outFile}`);
    })
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
