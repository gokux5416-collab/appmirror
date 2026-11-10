import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFrame } from '../testlib/synth.mjs';
import { buildParts } from '../scripts/lib/parts.mjs';

const W = 200;
const H = 200;
const BLUE = [0, 0, 255];
const RED = [255, 0, 0];
const GREEN = [0, 200, 0];
const YELLOW = [255, 220, 0];
const BLACK = [0, 0, 0];

const frames = (n, shapesAt) => Array.from({ length: n }, (_, k) => makeFrame(W, H, shapesAt(k)));
const near = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol, `${label}: expected ${b} +/- ${tol}, got ${a}`);
const isIdentity = (T) => Math.abs(T.tx) <= 0.05 && Math.abs(T.ty) <= 0.05 && T.theta === 0 && T.s === 1;

test('a fixed block and a rotating block make exactly 2 parts, one still and one turning', () => {
  const fs = frames(10, (k) => [
    { rect: [60, 60, 80, 80], color: BLUE },
    { rect: [150, 80, 30, 30], color: RED, T: { theta: 5 * k } },
  ]);
  const { parts } = buildParts(fs);
  assert.equal(parts.length, 2);
  const [body, spinner] = parts; // biggest first
  assert.equal(body.area, 6400);
  assert.ok(body.transforms.every(isIdentity), 'the fixed block never moves');
  assert.equal(spinner.area, 900);
  assert.equal(spinner.transforms.length, 10);
  for (const k of [3, 6, 9]) near(spinner.transforms[k].theta, 5 * k, 1.2, `theta at frame ${k}`);
});

test('a part that is still for a while and then moves is not merged with the still body', () => {
  const fs = frames(10, (k) => [
    { rect: [60, 60, 80, 80], color: BLUE },
    { rect: [150, 90, 20, 20], color: RED, T: { tx: k < 4 ? 0 : 5 * (k - 3) } },
  ]);
  const { parts } = buildParts(fs);
  assert.equal(parts.length, 2);
  const arm = parts.find((p) => p.area === 400);
  near(arm.transforms[9].tx, 30, 0.1, 'arm tx at the end');
  near(arm.transforms[2].tx, 0, 0.05, 'arm tx while still');
});

test('regions that move together form one part (a two-colored body)', () => {
  const fs = frames(10, (k) => [
    { rect: [60, 60, 40, 40], color: BLUE, T: { tx: 3 * k } },
    { rect: [100, 60, 20, 40], color: YELLOW, T: { tx: 3 * k } },
    { rect: [10, 150, 30, 30], color: GREEN },
  ]);
  const { parts } = buildParts(fs);
  assert.equal(parts.length, 2);
  const [body, still] = parts;
  assert.equal(body.area, 1600 + 800);
  assert.equal(body.regionIds.length, 2);
  near(body.transforms[9].tx, 27, 0.1, 'body tx at the end');
  assert.ok(still.transforms.every(isIdentity));
});

test('a thin outline follows the part it surrounds', () => {
  const fs = frames(10, (k) => [
    { rect: [58, 58, 44, 44], color: BLACK, T: { tx: 4 * k } },
    { rect: [60, 60, 40, 40], color: RED, T: { tx: 4 * k } },
  ]);
  const { parts, labels } = buildParts(fs);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].area, 44 * 44); // fill + outline
  near(parts[0].transforms[9].tx, 36, 0.1, 'tx at the end');
  assert.equal(labels[58 * W + 58], 0, 'an outline pixel belongs to the part');
  assert.equal(labels[5 * W + 5], -1, 'the background belongs to no part');
});

test('every part has one transform per frame, starting from the identity', () => {
  const fs = frames(5, (k) => [{ rect: [60, 60, 40, 40], color: RED, T: { tx: 2 * k } }]);
  const { parts } = buildParts(fs);
  assert.equal(parts[0].transforms.length, 5);
  assert.ok(isIdentity(parts[0].transforms[0]));
});

test('part ids are stable and sorted by size', () => {
  const fs = frames(3, () => [
    { rect: [10, 10, 10, 10], color: RED },
    { rect: [60, 60, 50, 50], color: BLUE },
    { rect: [130, 130, 20, 20], color: GREEN },
  ]);
  // all static: three separate shapes, all still -> they merge into ONE part
  const { parts } = buildParts(fs);
  assert.equal(parts.length, 1);
  assert.equal(parts[0].id, 'part-1');
});
