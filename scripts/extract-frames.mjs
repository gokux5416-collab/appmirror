#!/usr/bin/env node
// Step 1 of appmirror: split a screen recording into frames.
//
// Default mode: one frame per scene change (+ the first frame), one frame every
// 100 ms during the transition that follows each change, and a contact sheet.
// Full mode (--full): every frame of a time range, optionally cropped to a zone
// (used by step 2b to capture complex animations).
//
// Usage:
//   node scripts/extract-frames.mjs <video> [--out dir] [--scene 0.3]
//   node scripts/extract-frames.mjs <video> --full --start 500 --end 1500 --crop x,y,w,h
// Times are in milliseconds. Prints a JSON summary on stdout.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const TRANSITION_MS = 600; // window after a scene change
const TRANSITION_STEP_MS = 100;
const SCENE_THRESHOLD = 0.3;

const pad = (n, width) => String(n).padStart(width, '0');
const secs = (ms) => (ms / 1000).toFixed(3);

async function ffmpeg(args) {
  try {
    return await run(ffmpegPath, ['-hide_banner', ...args], { maxBuffer: MAX_BUFFER });
  } catch (err) {
    throw new Error(`ffmpeg failed: ${String(err.stderr || err.message).trim().split('\n').slice(-3).join(' | ')}`);
  }
}

async function probe(video) {
  let stderr;
  try {
    ({ stderr } = await run(ffmpegPath, ['-hide_banner', '-i', video], { maxBuffer: MAX_BUFFER }));
  } catch (err) {
    stderr = err.stderr || '';
  }
  const dur = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  const fps = /(\d+(?:\.\d+)?)\s*fps/.exec(stderr);
  if (!dur || !fps) throw new Error(`could not read video info: ${video}`);
  return {
    durationMs: Math.round((Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3])) * 1000),
    fps: Number(fps[1]),
  };
}

async function sceneChangeTimesMs(video, threshold) {
  const { stderr } = await ffmpeg([
    '-i', video,
    '-vf', `select='gt(scene,${threshold})',showinfo`,
    '-an', '-f', 'null', '-',
  ]);
  return [...stderr.matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((m) => Math.round(Number(m[1]) * 1000));
}

const cropFilter = (crop) => (crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}` : null);

async function grabFrame(video, timeMs, file, crop) {
  const args = ['-y', '-loglevel', 'error', '-ss', secs(timeMs), '-i', video, '-frames:v', '1'];
  const vf = cropFilter(crop);
  if (vf) args.push('-vf', vf);
  await ffmpeg([...args, file]);
}

export async function extractFrames({
  video,
  outDir = './frames',
  full = false,
  startMs = 0,
  endMs,
  crop,
  sceneThreshold = SCENE_THRESHOLD,
}) {
  if (!video || !existsSync(video)) throw new Error(`video not found: ${video}`);
  const videoPath = resolve(video);
  const out = resolve(outDir);
  mkdirSync(out, { recursive: true });
  const { durationMs, fps } = await probe(videoPath);
  const to = Math.min(endMs ?? durationMs, durationMs);

  if (full) {
    const stepMs = 1000 / fps;
    const count = Math.round((to - startMs) / stepMs);
    const vf = cropFilter(crop);
    const args = ['-y', '-loglevel', 'error', '-ss', secs(startMs), '-i', videoPath, '-frames:v', String(count)];
    if (vf) args.push('-vf', vf);
    await ffmpeg([...args, '-fps_mode', 'passthrough', join(out, 'full_%05d.png')]);
    const frames = Array.from({ length: count }, (_, i) => ({
      file: join(out, `full_${pad(i + 1, 5)}.png`),
      timeMs: Math.round(startMs + i * stepMs),
    }));
    return { fps, frames };
  }

  const changes = [0, ...(await sceneChangeTimesMs(videoPath, sceneThreshold))].filter(
    (t) => t >= startMs && t <= to,
  );

  const scenes = [];
  const transitions = [];
  const seen = new Set(changes);
  for (const t of changes) {
    const file = join(out, `scene_${pad(t, 6)}ms.png`);
    await grabFrame(videoPath, t, file, crop);
    scenes.push({ file, timeMs: t });
    for (let dt = TRANSITION_STEP_MS; dt <= TRANSITION_MS; dt += TRANSITION_STEP_MS) {
      const tt = t + dt;
      if (tt >= to || seen.has(tt)) continue;
      seen.add(tt);
      const tf = join(out, `trans_${pad(tt, 6)}ms.png`);
      await grabFrame(videoPath, tt, tf, crop);
      transitions.push({ file: tf, timeMs: tt });
    }
  }
  transitions.sort((a, b) => a.timeMs - b.timeMs);

  const contactSheet = join(out, 'contact-sheet.png');
  const cols = Math.min(6, scenes.length);
  const rows = Math.ceil(scenes.length / cols);
  const inputs = scenes.flatMap((s) => ['-i', s.file]);
  const labels = scenes.map((_, i) => `[${i}:v]scale=180:-1[s${i}]`).join(';');
  const stack = scenes.map((_, i) => `[s${i}]`).join('');
  // xstack needs at least 2 inputs; a single scene is just a scaled copy.
  const graph =
    scenes.length === 1
      ? '[0:v]scale=180:-1'
      : `${labels};${stack}xstack=inputs=${scenes.length}:layout=${gridLayout(scenes.length, cols)}`;
  await ffmpeg(['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-frames:v', '1', contactSheet]);

  return { scenes, transitions, contactSheet, rows, cols };
}

// xstack layout string for a cols-wide grid of 180px-wide tiles.
// Heights are equal because all frames share the same size, so we reference
// the first tile's height via h0.
function gridLayout(n, cols) {
  const cells = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    cells.push(`${c === 0 ? '0' : Array.from({ length: c }, (_, k) => `w${k}`).join('+')}_${r === 0 ? '0' : Array.from({ length: r }, () => 'h0').join('+')}`);
  }
  return cells.join('|');
}

// ---- CLI ----
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: './frames' },
      full: { type: 'boolean', default: false },
      start: { type: 'string', default: '0' },
      end: { type: 'string' },
      crop: { type: 'string' },
      scene: { type: 'string', default: String(SCENE_THRESHOLD) },
    },
  });
  const [video] = positionals;
  if (!video) {
    console.error('Usage: node scripts/extract-frames.mjs <video> [--out dir] [--full --start ms --end ms --crop x,y,w,h]');
    process.exit(2);
  }
  let crop;
  if (values.crop) {
    const [x, y, w, h] = values.crop.split(',').map(Number);
    crop = { x, y, w, h };
  }
  extractFrames({
    video,
    outDir: values.out,
    full: values.full,
    startMs: Number(values.start),
    endMs: values.end === undefined ? undefined : Number(values.end),
    crop,
    sceneThreshold: Number(values.scene),
  })
    .then((res) => console.log(JSON.stringify(res, null, 2)))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
