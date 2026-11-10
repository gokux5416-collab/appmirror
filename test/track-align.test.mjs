import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame, maskOf } from '../testlib/synth.mjs';
import { makeRegion, transformPoint, trackRegion } from '../scripts/lib/align.mjs';

const W = 200;
const H = 200;
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];

function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: expected ${expected} +/- ${tol}, got ${actual}`);
}

test('rotation convention: a positive angle turns clockwise on screen (y points down)', () => {
  const [x, y] = transformPoint({ tx: 0, ty: 0, theta: 90, s: 1 }, [0, 0], 10, 0);
  near(x, 0, 1e-9, 'x');
  near(y, 10, 1e-9, 'y'); // the point on the right goes to the bottom
});

test('translation and scale follow the documented formula', () => {
  const [x, y] = transformPoint({ tx: 5, ty: -3, theta: 0, s: 2 }, [10, 10], 12, 14);
  near(x, 10 + 5 + 2 * 2, 1e-9, 'x');
  near(y, 10 - 3 + 2 * 4, 1e-9, 'y');
});

test('a square that moves back 30 px in x is tracked at exactly -30', () => {
  const sq = (tx) => makeFrame(W, H, [{ rect: [60, 80, 40, 40], color: RED, T: { tx } }]);
  const frames = [sq(0), sq(-30)];
  const region = makeRegion(frames[0], maskOf(frames[0]));
  const out = trackRegion(region, frames);
  assert.equal(out.length, 2);
  assert.deepEqual([out[0].tx, out[0].ty, out[0].theta, out[0].s], [0, 0, 0, 1]);
  near(out[1].tx, -30, 0.01, 'tx');
  near(out[1].ty, 0, 0.01, 'ty');
  assert.equal(out[1].theta, 0);
  assert.equal(out[1].s, 1);
});

test('transforms are relative to frame 0, so many small steps do not drift', () => {
  const frames = [];
  for (let k = 0; k <= 10; k++) {
    frames.push(makeFrame(W, H, [{ rect: [100, 80, 40, 40], color: RED, T: { tx: -3 * k, ty: 2 * k } }]));
  }
  const region = makeRegion(frames[0], maskOf(frames[0]));
  const out = trackRegion(region, frames);
  near(out[10].tx, -30, 0.01, 'tx');
  near(out[10].ty, 20, 0.01, 'ty');
});

test('a rotating bar is tracked with the right angle and direction (clockwise = positive)', () => {
  const f0 = makeFrame(W, H, [{ rect: [70, 90, 60, 20], color: RED }]);
  const mask = maskOf(f0);
  const region = makeRegion(f0, mask);
  const frames = [f0];
  for (let k = 1; k <= 10; k++) {
    frames.push(
      makeFrame(W, H, [{ rect: [70, 90, 60, 20], color: RED, origin: region.origin, T: { theta: 3 * k } }]),
    );
  }
  const out = trackRegion(region, frames);
  for (const k of [1, 5, 10]) near(out[k].theta, 3 * k, 1.0, `theta at frame ${k}`);
  near(out[10].tx, 0, 0.5, 'tx');
  near(out[10].ty, 0, 0.5, 'ty');
  assert.equal(out[10].s, 1);
});

test('a growing square is tracked with the right scale', () => {
  const f0 = makeFrame(W, H, [{ rect: [80, 80, 40, 40], color: RED }]);
  const region = makeRegion(f0, maskOf(f0));
  const frames = [f0];
  for (let k = 1; k <= 6; k++) {
    frames.push(makeFrame(W, H, [{ rect: [80, 80, 40, 40], color: RED, origin: region.origin, T: { s: 1 + 0.05 * k } }]));
  }
  const out = trackRegion(region, frames);
  near(out[6].s, 1.3, 0.03, 'scale');
  near(out[6].theta, 0, 0.5, 'theta');
});

test('a region is tracked even when other parts move around it', () => {
  const body = { rect: [60, 60, 80, 80], color: BLUE };
  const f = (tx) => makeFrame(W, H, [body, { rect: [90, 90, 20, 20], color: RED, T: { tx } }]);
  const frames = [f(0), f(10), f(20)];
  // the region to track is the red square only
  const mask = new Uint8Array(W * H);
  for (let y = 90; y < 110; y++) for (let x = 90; x < 110; x++) mask[y * W + x] = 1;
  const region = makeRegion(frames[0], mask);
  const out = trackRegion(region, frames);
  near(out[2].tx, 20, 0.05, 'tx');
});
