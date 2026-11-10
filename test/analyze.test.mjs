import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../testlib/synth.mjs';
import { analyze } from '../scripts/lib/analyze.mjs';

const W = 200;
const H = 200;
const BLUE = [0, 0, 255];
const RED = [255, 0, 0];

const frames = (n, shapesAt) => Array.from({ length: n }, (_, k) => makeFrame(W, H, shapesAt(k)));
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: expected ${b} +/- ${tol}, got ${a}`);

test('rigid parts get a few keyframes: linear motion needs only the first and the last', () => {
  const fs = frames(10, (k) => [
    { rect: [60, 60, 80, 80], color: BLUE },
    { rect: [150, 80, 30, 30], color: RED, T: { theta: 5 * k } },
  ]);
  const out = analyze(fs, { fps: 60 });
  assert.equal(out.fallback, false);
  assert.equal(out.fps, 60);
  assert.deepEqual([out.width, out.height], [W, H]);
  assert.equal(out.parts.length, 2);
  const [body, spinner] = out.parts;
  assert.equal(body.kind, 'rigid');
  assert.equal(spinner.kind, 'rigid');
  assert.equal(spinner.keyframes.length, 2);
  assert.equal(spinner.keyframes[0].t, 0);
  near(spinner.keyframes[1].t, 150, 0.1, 'last keyframe time (ms)');
  near(spinner.keyframes[1].rotate, 45, 1.2, 'final rotation');
  assert.deepEqual(spinner.bbox, [150, 80, 30, 30]);
  const png = out.images[spinner.png];
  assert.deepEqual([png.w, png.h], [30, 30]);
  assert.equal(png.data.length, 30 * 30 * 4);
  assert.equal(png.data[(15 * 30 + 15) * 4], 255, 'red channel of the part image');
  assert.equal(png.data[(15 * 30 + 15) * 4 + 3], 255, 'opaque inside the part');
});

test('a part that is still and then moves keeps the moment it starts moving', () => {
  const fs = frames(10, (k) => [
    { rect: [60, 60, 80, 80], color: BLUE },
    { rect: [150, 90, 20, 20], color: RED, T: { tx: k < 4 ? 0 : 5 * (k - 3) } },
  ]);
  const out = analyze(fs, { fps: 60 });
  const arm = out.parts.find((p) => p.bbox[2] === 20);
  assert.deepEqual(arm.keyframes.map((kf) => Math.round(kf.t)), [0, 50, 150]);
  near(arm.keyframes[2].x, 30, 0.1, 'final x');
});

test('a part that squashes is deforming and is delivered frame by frame; the rest stays rigid', () => {
  const fs = frames(10, (k) => [
    { rect: [60, 60, 80, 80], color: BLUE },
    { rect: [150, 80, 30 - 2 * k, 30], color: RED },
  ]);
  const out = analyze(fs, { fps: 60 });
  assert.equal(out.fallback, false);
  const body = out.parts.find((p) => p.bbox[2] === 80);
  const squash = out.parts.find((p) => p !== body);
  assert.equal(body.kind, 'rigid');
  assert.equal(squash.kind, 'deforming');
  assert.equal(squash.frames.length, 10);
  assert.deepEqual(squash.frames[9].bbox, [150, 80, 12, 30]);
  const png = out.images[squash.frames[9].png];
  assert.deepEqual([png.w, png.h], [12, 30]);
});

test('when most of the mascot deforms, the whole animation falls back to frame by frame', () => {
  const fs = frames(10, (k) => [
    { rect: [60, 60, 80 - 4 * k, 80], color: BLUE },
    { rect: [150, 150, 20, 20], color: RED },
  ]);
  const out = analyze(fs, { fps: 60 });
  assert.equal(out.fallback, true);
  assert.equal(out.parts.length, 1);
  assert.equal(out.parts[0].kind, 'frames');
  assert.equal(out.parts[0].frames.length, 10);
  assert.ok(out.images[out.parts[0].frames[0].png], 'every frame has an image');
});


test('a part that slides behind the body is drawn behind it', () => {
  const fs = frames(10, (k) => [
    { rect: [120, 90, 60, 20], color: RED, T: { tx: -2 * k } }, // first = underneath
    { rect: [60, 60, 80, 80], color: BLUE },
  ]);
  const out = analyze(fs, { fps: 60 });
  assert.equal(out.fallback, false);
  const body = out.parts.find((p) => p.bbox[2] === 80);
  const arm = out.parts.find((p) => p.bbox[2] !== 80);
  assert.ok(arm.zIndex < body.zIndex, `arm z ${arm.zIndex} should be below body z ${body.zIndex}`);
});

test('a part that slides over the body is drawn in front of it', () => {
  const fs = frames(10, (k) => [
    { rect: [60, 60, 80, 80], color: BLUE },
    { rect: [120, 90, 60, 20], color: RED, T: { tx: -2 * k } }, // last = on top
  ]);
  const out = analyze(fs, { fps: 60 });
  const body = out.parts.find((p) => p.bbox[2] === 80);
  const arm = out.parts.find((p) => p.bbox[2] !== 80);
  assert.ok(arm.zIndex > body.zIndex, `arm z ${arm.zIndex} should be above body z ${body.zIndex}`);
});
