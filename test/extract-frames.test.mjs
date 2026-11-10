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

test('by default captures every frame of the video during a transition (30 fps)', async () => {
  const fast = join(work, 'fast.mp4');
  execFileSync(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-filter_complex',
    'color=red:s=160x288:d=1:r=30[a];color=blue:s=160x288:d=1:r=30[b];[a][b]concat=n=2:v=1:a=0,format=yuv420p',
    fast,
  ]);
  const res = await extractFrames({ video: fast, outDir: join(work, 'fast-out') });
  const window = res.transitions.map((t) => t.timeMs).filter((t) => t > 1000 && t <= 1600);
  assert.equal(window.length, 18); // 600 ms at 30 fps
});

test('transition step can be set by hand', async () => {
  const res = await extractFrames({ video, outDir: join(work, 'step'), transitionStepMs: 200 });
  const window = res.transitions.map((t) => t.timeMs).filter((t) => t > 1000 && t <= 1600);
  assert.deepEqual(window, [1200, 1400, 1600]);
});

test('detects a small change (about 7% of the screen) with the default threshold', async () => {
  const medium = join(work, 'medium.mp4');
  execFileSync(ffmpegPath, [
    '-y', '-loglevel', 'error', '-f', 'lavfi',
    '-i', "color=black:s=160x288:d=2:r=10,drawbox=x=0:y=0:w=160:h=20:color=white:t=fill:enable='gte(t,1)'",
    '-pix_fmt', 'yuv420p', medium,
  ]);
  const res = await extractFrames({ video: medium, outDir: join(work, 'medium-out') });
  assert.deepEqual(res.scenes.map((s) => s.timeMs), [0, 1000]);
});

test('detects a slow slide (each frame changes little) as ONE scene change', async () => {
  // A white block slides across a black screen from 1.0 s on, 30 fps.
  // Frame to frame the change is about 3 %, far below a 0.1 scene score.
  const slide = join(work, 'slide.mp4');
  execFileSync(ffmpegPath, [
    '-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'color=black:s=160x288:d=2:r=30',
    '-f', 'lavfi', '-i', 'color=white:s=80x144:d=2:r=30',
    '-filter_complex', "[0:v][1:v]overlay=x='if(gte(t,1),-80+(t-1)*300,-80)':y=0,format=yuv420p",
    slide,
  ]);
  const res = await extractFrames({ video: slide, outDir: join(work, 'slide-out') });
  assert.equal(res.scenes.length, 2, 'the whole slide is one event, not one scene per frame');
  assert.ok(res.scenes[1].timeMs >= 1000 && res.scenes[1].timeMs <= 1100, `got ${res.scenes[1].timeMs}`);
});

test('gives a settled frame (after the movement stops) for every scene', async () => {
  const slide = join(work, 'slide.mp4');
  const res = await extractFrames({ video: slide, outDir: join(work, 'settled-out') });
  assert.equal(res.scenes.length, 2);
  const s = res.scenes[1];
  // the block is fully out of the screen at about 1.8 s
  assert.ok(s.settledMs >= 1750, `settled at ${s.settledMs}`);
  assert.ok(existsSync(s.settledFile), 'settled frame should exist');
  assert.match(s.settledFile, /settled_\d{6}ms\.png$/);
  // for an instant change (red to blue) the settled frame is just after the change
  const instant = await extractFrames({ video, outDir: join(work, 'settled-instant') });
  assert.equal(instant.scenes[1].settledMs, 1100);
});

test('writes a contact sheet image', async () => {
  const out = join(work, 'sheet');
  const res = await extractFrames({ video, outDir: out });
  assert.ok(res.contactSheet.endsWith('contact-sheet.png'));
  assert.ok(existsSync(res.contactSheet));
});

test('writes one contact sheet per transition', async () => {
  const res = await extractFrames({ video, outDir: join(work, 'tsheets') });
  assert.deepEqual(res.transitionSheets.map((s) => s.timeMs), [0, 1000, 2000]);
  for (const s of res.transitionSheets) {
    assert.ok(existsSync(s.file), `${s.file} should exist`);
    assert.match(s.file, /transition-sheet_\d{6}ms\.png$/);
  }
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
