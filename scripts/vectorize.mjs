#!/usr/bin/env node
// Turn the image of a rigid part into an SVG, using VTracer (open source, WebAssembly,
// nothing to install besides npm). Transparent pixels stay transparent. The SVG is
// then moved around with keyframes: it is drawn once, never frame by frame.
//
// Usage:
//   node scripts/vectorize.mjs part.png [--out part.svg]
//        [--colors 6] [--speckle 4] [--mode spline|polygon|pixel]

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { convertPixels } from '@visioncortex/vtracer';

export async function vectorize(file, { outFile, mode = 'spline', colorPrecision = 6, filterSpeckle = 4, ...extra } = {}) {
  if (!file || !existsSync(file)) throw new Error(`image not found: ${file}`);
  const png = PNG.sync.read(readFileSync(file));
  const out = outFile ?? file.replace(/(\.png)?$/i, '.svg');
  const svg = convertPixels(new Uint8Array(png.data), png.width, png.height, { mode, colorPrecision, filterSpeckle, ...extra });
  writeFileSync(out, svg);
  return { outFile: out, width: png.width, height: png.height, paths: (svg.match(/<path/g) ?? []).length, bytes: Buffer.byteLength(svg) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      colors: { type: 'string', default: '6' },
      speckle: { type: 'string', default: '4' },
      mode: { type: 'string', default: 'spline' },
    },
  });
  const [file] = positionals;
  if (!file) {
    console.error('usage: vectorize.mjs part.png [--out part.svg] [--colors 6] [--speckle 4] [--mode spline|polygon|pixel]');
    process.exit(2);
  }
  vectorize(file, { outFile: values.out, mode: values.mode, colorPrecision: Number(values.colors), filterSpeckle: Number(values.speckle) })
    .then((r) => console.log(`${r.paths} path(s), ${r.width}x${r.height}, ${r.bytes} bytes -> ${r.outFile}`))
    .catch((e) => {
      console.error(`vectorize: ${e.message}`);
      process.exit(1);
    });
}
