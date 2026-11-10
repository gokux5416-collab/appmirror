import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { makeFrame, savePng } from '../testlib/synth.mjs';

const CLI = path.resolve('scripts/track-parts.mjs');
const BLUE = [0, 0, 255];
const RED = [255, 0, 0];
const GREEN = [0, 200, 0];

function writeFrames(dir, n, w, h, shapesAt) {
  fs.mkdirSync(dir, { recursive: true });
  for (let k = 0; k < n; k++) savePng(makeFrame(w, h, shapesAt(k)), path.join(dir, `frame_${String(k).padStart(4, '0')}.png`));
}

test('the CLI turns a folder of frames into parts.json, one PNG per part and labels.png', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  writeFrames(path.join(root, 'frames'), 10, 200, 200, (k) => [
    { rect: [60, 60, 80, 80], color: BLUE },
    { rect: [150, 80, 30, 30], color: RED, T: { theta: 5 * k } },
  ]);
  const out = path.join(root, 'parts.json');
  execFileSync('node', [CLI, '--frames', path.join(root, 'frames'), '--fps', '60', '--out', out], { stdio: 'pipe' });
  const json = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(json.fps, 60);
  assert.equal(json.fallback, false);
  assert.deepEqual([json.width, json.height], [200, 200]);
  assert.equal(json.parts.length, 2);
  const spinner = json.parts[1];
  assert.equal(spinner.keyframes.length, 2);
  const png = PNG.sync.read(fs.readFileSync(path.join(root, spinner.png)));
  assert.deepEqual([png.width, png.height], [30, 30]);
  assert.ok(fs.existsSync(path.join(root, 'labels.png')), 'labels.png is written');
  assert.ok(!fs.existsSync(path.join(root, 'debug.png')), 'no debug overlay without --debug');
});

test('with --debug it also writes an overlay of the parts on frame 0', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  writeFrames(path.join(root, 'frames'), 4, 100, 100, () => [{ rect: [30, 30, 40, 40], color: GREEN }]);
  execFileSync('node', [CLI, '--frames', path.join(root, 'frames'), '--fps', '30', '--out', path.join(root, 'parts.json'), '--debug'], { stdio: 'pipe' });
  assert.ok(fs.existsSync(path.join(root, 'debug.png')));
});

test('an empty or missing frames folder fails with a clear message', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  fs.mkdirSync(path.join(root, 'none'));
  assert.throws(
    () => execFileSync('node', [CLI, '--frames', path.join(root, 'none'), '--out', path.join(root, 'p.json')], { stdio: 'pipe' }),
    (e) => /no PNG frames/i.test(String(e.stderr)),
  );
});

test('100 frames of 300x300 are analyzed in under 15 seconds', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tp-'));
  writeFrames(path.join(root, 'frames'), 100, 300, 300, (k) => [
    { rect: [90, 90, 120, 120], color: BLUE },
    { rect: [230, 120, 40, 40], color: RED, T: { theta: 3 * k } },
    { rect: [30, 130, 30, 30], color: GREEN, T: { tx: 0.4 * k, ty: Math.sin(k / 8) * 6 } },
  ]);
  const t0 = Date.now();
  execFileSync('node', [CLI, '--frames', path.join(root, 'frames'), '--fps', '60', '--out', path.join(root, 'parts.json')], { stdio: 'pipe' });
  const seconds = (Date.now() - t0) / 1000;
  assert.ok(seconds < 15, `took ${seconds.toFixed(1)} s`);
  const json = JSON.parse(fs.readFileSync(path.join(root, 'parts.json'), 'utf8'));
  assert.equal(json.fallback, false);
  assert.equal(json.parts.length, 3);
});
