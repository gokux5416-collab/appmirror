import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { extractFrames } from '../scripts/extract-frames.mjs';

// Fake screen recording: red 1 s, blue 1 s, green 1 s (160x288, 10 fps).
// Scene changes happen at exactly 1.0 s and 2.0 s.
let work;
let video;

before(() => {
  work = mkdtempSync(join(tmpdir(), 'appmirror-test-'));
  video = join(work, 'three-colors.mp4');
  execFileSync(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-filter_complex',
    'color=red:s=160x288:d=1:r=10[a];color=blue:s=160x288:d=1:r=10[b];color=green:s=160x288:d=1:r=10[c];[a][b][c]concat=n=3:v=1:a=0,format=yuv420p',
    video,
  ]);
});

after(() => rmSync(work, { recursive: true, force: true }));

function pngSize(file) {
  const buf = readFileSync(file);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test('finds one frame per scene change, plus the first frame', async () => {
  const out = join(work, 'scenes');
  const res = await extractFrames({ video, outDir: out });
  assert.equal(res.scenes.length, 3);
  const times = res.scenes.map((s) => s.timeMs);
  assert.deepEqual(times, [0, 1000, 2000]);
  for (const s of res.scenes) assert.ok(existsSync(s.file), `${s.file} should exist`);
});

test('captures a frame every 100 ms during the transition after each scene change', async () => {
  const out = join(work, 'transitions');
  const res = await extractFrames({ video, outDir: out });
  const after1s = res.transitions.map((t) => t.timeMs).filter((t) => t > 1000 && t <= 1600);
  assert.deepEqual(after1s, [1100, 1200, 1300, 1400, 1500, 1600]);
  for (const t of res.transitions) assert.ok(existsSync(t.file), `${t.file} should exist`);
});

test('writes a contact sheet image', async () => {
  const out = join(work, 'sheet');
  const res = await extractFrames({ video, outDir: out });
  assert.ok(res.contactSheet.endsWith('contact-sheet.png'));
  assert.ok(existsSync(res.contactSheet));
});

test('full mode keeps every frame of a time range, cropped to a zone', async () => {
  const out = join(work, 'full');
  const res = await extractFrames({
    video,
    outDir: out,
    full: true,
    startMs: 500,
    endMs: 1500,
    crop: { x: 10, y: 20, w: 80, h: 100 },
  });
  assert.equal(res.fps, 10);
  assert.equal(res.frames.length, 10);
  assert.equal(res.frames[0].timeMs, 500);
  for (const f of res.frames) {
    assert.deepEqual(pngSize(f.file), { w: 80, h: 100 });
  }
});

test('handles a video with no scene change (single frame contact sheet)', async () => {
  const still = join(work, 'still.mp4');
  execFileSync(ffmpegPath, [
    '-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'color=red:s=160x288:d=1:r=10', '-pix_fmt', 'yuv420p', still,
  ]);
  const res = await extractFrames({ video: still, outDir: join(work, 'still-out') });
  assert.equal(res.scenes.length, 1);
  assert.ok(existsSync(res.contactSheet));
});

test('fails with a clear message when the video does not exist', async () => {
  await assert.rejects(
    extractFrames({ video: join(work, 'nope.mp4'), outDir: join(work, 'x') }),
    /video not found/i,
  );
});
