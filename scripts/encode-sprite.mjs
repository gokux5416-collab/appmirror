#!/usr/bin/env node
// Pack transparent PNG frames into ONE animated WebP (alpha kept, loops forever).
// Far lighter than a folder of PNGs, and expo-image plays it on iOS and Android.
// Minimum 24 frames per second: below that, motion looks choppy.
//
// Usage:
//   node scripts/encode-sprite.mjs --frames <dir> --fps 30 --out anim.webp [--quality 80]

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
export const MIN_FPS = 24;

export async function encodeSprite({ framesDir, fps = 30, outFile, quality = 80 }) {
  if (!(fps >= MIN_FPS)) throw new Error(`fps must be at least ${MIN_FPS} (got ${fps}): below that the motion looks choppy`);
  let names = [];
  try {
    names = readdirSync(framesDir).filter((n) => n.toLowerCase().endsWith('.png')).sort();
  } catch {
    /* handled below */
  }
  if (!names.length) throw new Error(`no PNG frames found in ${framesDir}`);

  // ffmpeg wants a numbered sequence: link the frames under 00000.png, 00001.png...
  const tmp = mkdtempSync(join(tmpdir(), 'appmirror-sprite-'));
  try {
    names.forEach((n, i) => symlinkSync(resolve(framesDir, n), join(tmp, `${String(i).padStart(5, '0')}.png`)));
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-framerate', String(fps), '-i', join(tmp, '%05d.png'),
      '-c:v', 'libwebp_anim', '-lossless', '0', '-quality', String(quality),
      '-loop', '0', '-pix_fmt', 'yuva420p', resolve(outFile),
    ]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return { outFile: resolve(outFile), fps, frames: names.length, bytes: statSync(outFile).size };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { frames: { type: 'string' }, fps: { type: 'string', default: '30' }, out: { type: 'string' }, quality: { type: 'string', default: '80' } },
  });
  if (!values.frames || !values.out) {
    console.error('usage: encode-sprite.mjs --frames <dir> --fps 30 --out anim.webp [--quality 80]');
    process.exit(2);
  }
  encodeSprite({ framesDir: values.frames, fps: Number(values.fps), outFile: values.out, quality: Number(values.quality) })
    .then((r) => console.log(`${r.frames} frames at ${r.fps} fps -> ${r.outFile} (${(r.bytes / 1024).toFixed(0)} KB)`))
    .catch((e) => {
      console.error(`encode-sprite: ${e.message}`);
      process.exit(1);
    });
}
