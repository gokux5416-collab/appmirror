#!/usr/bin/env node
// Split a mascot animation into parts and track each part.
//
// Input: a folder of transparent PNG frames (see remove-bg.mjs), all the same size,
// sorted by name. Output, next to --out:
//   parts.json          fps, size, fallback, and for each part its kind
//                       (rigid | deforming | frames), bbox, origin, zIndex, png and
//                       keyframes {t (ms), x, y, rotate (deg), scale} or frames
//   parts/<id>.png      one transparent image per rigid part (cropped to its box)
//   parts/<id>/NNNN.png frame-by-frame images of a deforming part
//   frames/NNNN.png     whole animation, only when fallback is true
//   labels.png          frame 0 with every part in its own color
//   debug.png           (--debug) frame 0 with the part colors blended over it
//
// Usage:
//   node scripts/track-parts.mjs --frames <dir> --fps 60 --out <dir>/parts.json [--debug]

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { analyze } from './lib/analyze.mjs';

function loadFrames(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.png')).sort();
  } catch {
    names = [];
  }
  if (!names.length) throw new Error(`no PNG frames found in ${dir}`);
  return names.map((name) => {
    const png = PNG.sync.read(readFileSync(join(dir, name)));
    const data = new Float32Array(png.width * png.height * 4);
    for (let p = 0; p < png.width * png.height; p++) {
      const a = png.data[p * 4 + 3];
      for (let c = 0; c < 3; c++) data[p * 4 + c] = (png.data[p * 4 + c] * a) / 255; // premultiplied
      data[p * 4 + 3] = a;
    }
    return { w: png.width, h: png.height, data };
  });
}

function writePng(file, { w, h, data }) {
  mkdirSync(dirname(file), { recursive: true });
  const png = new PNG({ width: w, height: h });
  png.data = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  writeFileSync(file, PNG.sync.write(png));
}

// A distinct color per part index (golden-angle hue steps).
function colorOf(i) {
  const hue = ((i * 137.508) % 360) / 60;
  const x = 1 - Math.abs((hue % 2) - 1);
  const [r, g, b] = [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][Math.floor(hue) % 6];
  return [Math.round(60 + 195 * r), Math.round(60 + 195 * g), Math.round(60 + 195 * b)];
}

function paintLabels(frame0, labels, blend) {
  const { w, h, data } = frame0;
  const out = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    if (labels[p] < 0) continue;
    const col = colorOf(labels[p]);
    const a = data[p * 4 + 3];
    for (let c = 0; c < 3; c++) {
      const base = a > 0 ? (data[p * 4 + c] * 255) / a : 0;
      out[p * 4 + c] = Math.round(blend ? base * 0.5 + col[c] * 0.5 : col[c]);
    }
    out[p * 4 + 3] = 255;
  }
  return { w, h, data: out };
}

export function trackParts({ framesDir, fps = 60, outFile, debug = false }) {
  const frames = loadFrames(framesDir);
  const result = analyze(frames, { fps });
  const root = dirname(resolve(outFile));
  mkdirSync(root, { recursive: true });

  for (const [name, image] of Object.entries(result.images)) writePng(join(root, name), image);
  if (result.labels) {
    writePng(join(root, 'labels.png'), paintLabels(frames[0], result.labels, false));
    if (debug) writePng(join(root, 'debug.png'), paintLabels(frames[0], result.labels, true));
  }

  const { images, labels, ...json } = result;
  writeFileSync(outFile, JSON.stringify(json, null, 2) + '\n');
  return json;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({
      options: {
        frames: { type: 'string' },
        fps: { type: 'string', default: '60' },
        out: { type: 'string' },
        debug: { type: 'boolean', default: false },
      },
    });
    if (!values.frames || !values.out) throw new Error('usage: track-parts.mjs --frames <dir> --fps 60 --out <dir>/parts.json [--debug]');
    const json = trackParts({ framesDir: values.frames, fps: Number(values.fps), outFile: values.out, debug: values.debug });
    const note = json.fallback ? ` (fallback: ${json.reason})` : '';
    console.log(`${json.parts.length} part(s)${note} -> ${values.out}`);
  } catch (e) {
    console.error(`track-parts: ${e.message}`);
    process.exit(1);
  }
}
