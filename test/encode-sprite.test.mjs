import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeFrame, savePng } from '../testlib/synth.mjs';
import { encodeSprite } from '../scripts/encode-sprite.mjs';

function framesDir(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
  for (let k = 0; k < n; k++) {
    savePng(makeFrame(64, 64, [{ rect: [10 + k, 20, 20, 20], color: [255, 120, 0] }]), path.join(dir, `f_${String(k).padStart(4, '0')}.png`));
  }
  return dir;
}

// Walk the RIFF chunks of an animated WebP: returns { frames: [{ms}], hasAlpha }.
function readWebp(file) {
  const b = fs.readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'RIFF');
  assert.equal(b.toString('ascii', 8, 12), 'WEBP');
  const frames = [];
  let hasAlpha = false;
  const walk = (start, end) => {
    for (let p = start; p + 8 <= end; ) {
      const tag = b.toString('ascii', p, p + 4);
      const size = b.readUInt32LE(p + 4);
      if (tag === 'ANMF') {
        frames.push({ ms: b.readUIntLE(p + 8 + 12, 3) });
        walk(p + 8 + 16, p + 8 + size);
      }
      if (tag === 'ALPH' || tag === 'VP8L') hasAlpha = true;
      p += 8 + size + (size % 2);
    }
  };
  walk(12, b.length);
  return { frames, hasAlpha, bytes: b.length };
}

test('all the frames become one animated WebP with alpha, one entry per frame', async () => {
  const dir = framesDir(12);
  const out = path.join(dir, 'anim.webp');
  const res = await encodeSprite({ framesDir: dir, fps: 30, outFile: out });
  assert.equal(res.frames, 12);
  assert.equal(res.fps, 30);
  const w = readWebp(out);
  assert.equal(w.frames.length, 12);
  assert.ok(w.hasAlpha, 'keeps transparency');
  assert.ok(w.frames.every((f) => f.ms >= 32 && f.ms <= 34), 'about 33 ms per frame at 30 fps');
});

test('below 24 frames per second is refused', async () => {
  const dir = framesDir(3);
  await assert.rejects(() => encodeSprite({ framesDir: dir, fps: 20, outFile: path.join(dir, 'a.webp') }), /24/);
});

test('an empty folder fails with a clear message', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-'));
  await assert.rejects(() => encodeSprite({ framesDir: dir, fps: 30, outFile: path.join(dir, 'a.webp') }), /no PNG frames/i);
});
