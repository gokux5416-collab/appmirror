import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../testlib/synth.mjs';
import { segmentFrame } from '../scripts/lib/segment.mjs';

const W = 120;
const H = 120;
const BLUE = [0, 0, 255];
const RED = [255, 0, 0];
const GREEN = [0, 200, 0];
const BLACK = [0, 0, 0];

const byArea = (seg) => [...seg.regions].sort((a, b) => b.area - a.area);

test('regions of different colors are separated', () => {
  const f = makeFrame(W, H, [
    { rect: [20, 20, 60, 60], color: BLUE },
    { rect: [40, 40, 20, 20], color: RED },
  ]);
  const seg = segmentFrame(f);
  const [big, small] = byArea(seg);
  assert.equal(seg.regions.length, 2);
  assert.equal(big.area, 3200);
  assert.equal(small.area, 400);
  assert.equal(big.thin, false);
  assert.equal(small.thin, false);
});

test('background (transparent) pixels belong to no region', () => {
  const f = makeFrame(W, H, [{ rect: [20, 20, 60, 60], color: BLUE }]);
  const seg = segmentFrame(f);
  assert.equal(seg.labels[2 * W + 2], -1);
  assert.notEqual(seg.labels[50 * W + 50], -1);
});

test('a thin outline is detected as thin, the filled shape is not', () => {
  const f = makeFrame(W, H, [
    { rect: [28, 28, 44, 44], color: BLACK },
    { rect: [30, 30, 40, 40], color: RED },
  ]);
  const seg = segmentFrame(f);
  const [red, outline] = byArea(seg);
  assert.equal(red.area, 1600);
  assert.equal(red.thin, false);
  assert.equal(outline.area, 44 * 44 - 40 * 40);
  assert.equal(outline.thin, true);
});

test('a tiny speck is absorbed by the region around it', () => {
  const f = makeFrame(W, H, [
    { rect: [20, 20, 60, 60], color: BLUE },
    { rect: [50, 50, 3, 3], color: GREEN },
  ]);
  const seg = segmentFrame(f);
  assert.equal(seg.regions.length, 1);
  assert.equal(seg.regions[0].area, 3600);
});

test('an isolated tiny speck with no neighbor is dropped', () => {
  const f = makeFrame(W, H, [
    { rect: [20, 20, 60, 60], color: BLUE },
    { rect: [100, 100, 3, 3], color: GREEN }, // far from everything
  ]);
  const seg = segmentFrame(f);
  assert.equal(seg.regions.length, 1);
  assert.equal(seg.regions[0].area, 3600);
  assert.equal(seg.labels[101 * W + 101], -1);
  assert.equal(seg.labels[50 * W + 50], 0);
});

test('slight color noise (video compression) does not split a region', () => {
  const f = makeFrame(W, H, [{ rect: [20, 20, 60, 60], color: [100, 150, 200] }]);
  for (let p = 0; p < W * H; p++) {
    if (f.data[p * 4 + 3] < 255) continue;
    const n = ((p * 7919) % 13) - 6; // -6..6, deterministic
    f.data[p * 4] += n;
    f.data[p * 4 + 1] -= n;
    f.data[p * 4 + 2] += n / 2;
  }
  const seg = segmentFrame(f);
  assert.equal(seg.regions.length, 1);
  assert.equal(seg.regions[0].area, 3600);
});

test('two separate shapes of the same color are two regions', () => {
  const f = makeFrame(W, H, [
    { rect: [10, 10, 30, 30], color: RED },
    { rect: [70, 70, 30, 30], color: RED },
  ]);
  assert.equal(segmentFrame(f).regions.length, 2);
});

test('mask(id) returns the pixels of one region', () => {
  const f = makeFrame(W, H, [
    { rect: [20, 20, 60, 60], color: BLUE },
    { rect: [40, 40, 20, 20], color: RED },
  ]);
  const seg = segmentFrame(f);
  const small = byArea(seg)[1];
  const m = seg.mask(small.id);
  assert.equal(m.reduce((n, v) => n + v, 0), 400);
  assert.equal(m[50 * W + 50], 1);
  assert.equal(m[25 * W + 25], 0);
});
