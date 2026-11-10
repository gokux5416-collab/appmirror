#!/usr/bin/env node
// Similarity score between two images (0 to 100 %), based on pixelmatch.
// The first image is the reference (the original frame). If the second image
// has a different size (a browser screenshot vs a phone recording frame), it is
// scaled to the size of the first one.
//
// Usage:
//   node scripts/diff.mjs original.png clone.png [--out diff.png] [--threshold 0.1] [--json]

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const MAX_ASPECT_GAP = 0.02; // 2 %

function readPng(file) {
  if (!file || !existsSync(file)) throw new Error(`image not found: ${file}`);
  return PNG.sync.read(readFileSync(file));
}

async function scaleTo(file, width, height) {
  const dir = mkdtempSync(join(tmpdir(), 'appmirror-scale-'));
  const out = join(dir, 'scaled.png');
  try {
    await run(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', resolve(file),
      '-vf', `scale=${width}:${height}:flags=lanczos`, '-pix_fmt', 'rgba', out,
    ]);
    return PNG.sync.read(readFileSync(out));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function diffImages(fileA, fileB, { threshold = 0.1, outFile } = {}) {
  const a = readPng(fileA);
  let b = readPng(fileB);

  let resized = false;
  if (a.width !== b.width || a.height !== b.height) {
    const gap = Math.abs(a.width / a.height - b.width / b.height) / (a.width / a.height);
    if (gap > MAX_ASPECT_GAP) {
      throw new Error(
        `aspect ratio differs too much: ${a.width}x${a.height} vs ${b.width}x${b.height}`,
      );
    }
    b = await scaleTo(fileB, a.width, a.height);
    resized = true;
  }

  const { width, height } = a;
  const out = new PNG({ width, height });
  const diffPixels = pixelmatch(a.data, b.data, out.data, width, height, { threshold });
  const totalPixels = width * height;
  if (outFile) writeFileSync(outFile, PNG.sync.write(out));

  return {
    score: Math.round((1 - diffPixels / totalPixels) * 10000) / 100,
    diffPixels,
    totalPixels,
    width,
    height,
    resized,
  };
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      threshold: { type: 'string', default: '0.1' },
      json: { type: 'boolean', default: false },
    },
  });
  const [a, b] = positionals;
  if (!a || !b) {
    console.error('Usage: node scripts/diff.mjs original.png clone.png [--out diff.png] [--threshold 0.1] [--json]');
    process.exit(2);
  }
  diffImages(a, b, { threshold: Number(values.threshold), outFile: values.out })
    .then((res) => console.log(values.json ? JSON.stringify(res, null, 2) : `${res.score}%`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
