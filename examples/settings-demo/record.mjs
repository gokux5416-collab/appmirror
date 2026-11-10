#!/usr/bin/env node
// Records examples/settings-demo/original/index.html as a 390x844 screen recording.
// This web page stands in for a phone recording: it is the "original app" of the demo.
// Usage: node examples/settings-demo/record.mjs [out.mp4]
import { mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import ffmpegPath from 'ffmpeg-static';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? join(here, 'settings-demo.mp4'));
const dir = mkdtempSync(join(tmpdir(), 'appmirror-rec-'));
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  recordVideo: { dir, size: { width: 390, height: 844 } },
});
const page = await ctx.newPage();
await page.goto(pathToFileURL(join(here, 'original/index.html')).href);
const wait = (ms) => page.waitForTimeout(ms);
await wait(1500);
await page.click('[data-go=wifi]'); await wait(1400);
await page.click('#wifisw'); await wait(1400);
await page.click('#wifisw'); await wait(1400);
await page.click('#wifi [data-back]'); await wait(1200);
await page.click('[data-go=notif]'); await wait(1400);
await page.click('#notifsw1'); await wait(1400);
await page.click('#notif [data-back]'); await wait(1500);
await ctx.close(); await browser.close();
const webm = join(dir, readdirSync(dir).find((f) => f.endsWith('.webm')));
execFileSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-i', webm, '-r', '30', '-pix_fmt', 'yuv420p', out]);
rmSync(dir, { recursive: true, force: true });
console.log(out);
