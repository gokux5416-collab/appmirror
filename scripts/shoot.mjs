#!/usr/bin/env node
// Screenshots of the generated clone (Expo Web) with Playwright, at iPhone size.
//
//   screens:   one capture per screen of app-map.json
//   animation: captures of one animation at exact instants. The browser clock is
//              paused and advanced by hand, so "t = 500 ms" really means 500 ms
//              after the page finished loading, whatever the machine speed.
//
// Usage:
//   node scripts/shoot.mjs screens --base-url http://localhost:8081 --map app-map.json [--out captures]
//   node scripts/shoot.mjs animation --url http://localhost:8081/ --id mascot --times 0,33,67 [--clip x,y,w,h] [--out captures]
//
// A screen is opened at "/" if its id is "home" or "index", else at "/<id>".

import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const WIDTH = 390;
const HEIGHT = 844;
const pad = (n, width) => String(n).padStart(width, '0');

async function withPage({ width, height, scale }, fn) {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
    });
    const page = await context.newPage();
    return await fn(page);
  } finally {
    await browser.close();
  }
}

async function open(page, url, waitUntil) {
  let response;
  try {
    response = await page.goto(url, { waitUntil, timeout: 30000 });
  } catch (err) {
    throw new Error(`cannot open ${url}: ${err.message.split('\n')[0]}`);
  }
  if (response && response.status() >= 400) {
    throw new Error(`page returned ${response.status()}: ${url}`);
  }
}

export async function shootScreens({
  baseUrl,
  screens,
  outDir = './captures',
  width = WIDTH,
  height = HEIGHT,
  scale = 1,
  settleMs = 300,
}) {
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  return withPage({ width, height, scale }, async (page) => {
    const results = [];
    for (const s of screens) {
      await open(page, new URL(s.path, baseUrl).href, 'networkidle');
      if (settleMs) await page.waitForTimeout(settleMs); // let entrance animations finish
      const file = join(out, `${s.id}.png`);
      await page.screenshot({ path: file });
      results.push({ id: s.id, file });
    }
    return results;
  });
}

export async function shootAnimation({
  url,
  id,
  times,
  outDir = './captures',
  clip,
  width = WIDTH,
  height = HEIGHT,
  scale = 1,
}) {
  if (!times?.length || times.some((t, i) => i > 0 && t < times[i - 1])) {
    throw new Error('times must be a non-empty list in ascending order (ms)');
  }
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  return withPage({ width, height, scale }, async (page) => {
    await page.clock.install({ time: 0 });
    await open(page, url, 'load');
    // Freeze time: t = 0 is the moment the page finished loading.
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 1);

    const results = [];
    let elapsed = 0;
    for (const t of times) {
      await page.clock.runFor(t - elapsed);
      elapsed = t;
      const file = join(out, `${id}_${pad(t, 6)}ms.png`);
      await page.screenshot({
        path: file,
        clip: clip ? { x: clip.x, y: clip.y, width: clip.w, height: clip.h } : undefined,
      });
      results.push({ timeMs: t, file });
    }
    return results;
  });
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'base-url': { type: 'string' },
      map: { type: 'string' },
      url: { type: 'string' },
      id: { type: 'string', default: 'animation' },
      times: { type: 'string' },
      clip: { type: 'string' },
      out: { type: 'string', default: './captures' },
    },
  });
  const [command] = positionals;
  const usage = () => {
    console.error(
      'Usage:\n  node scripts/shoot.mjs screens --base-url <url> --map app-map.json [--out dir]\n' +
        '  node scripts/shoot.mjs animation --url <url> --id <name> --times 0,33,67 [--clip x,y,w,h] [--out dir]',
    );
    process.exit(2);
  };
  let job;
  if (command === 'screens' && values['base-url'] && values.map) {
    const map = JSON.parse(readFileSync(values.map, 'utf8'));
    const screens = map.screens.map((s) => ({
      id: s.id,
      path: s.id === 'home' || s.id === 'index' ? '/' : `/${s.id}`,
    }));
    job = shootScreens({ baseUrl: values['base-url'], screens, outDir: values.out });
  } else if (command === 'animation' && values.url && values.times) {
    let clip;
    if (values.clip) {
      const [x, y, w, h] = values.clip.split(',').map(Number);
      clip = { x, y, w, h };
    }
    job = shootAnimation({
      url: values.url,
      id: values.id,
      times: values.times.split(',').map(Number),
      clip,
      outDir: values.out,
    });
  } else {
    usage();
  }
  job
    .then((res) => console.log(JSON.stringify(res, null, 2)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
