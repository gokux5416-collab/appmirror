// From frames to the final description of a mascot animation.
//
// analyze(frames, { fps }) -> {
//   fps, width, height, fallback,
//   parts: [{ id, kind, bbox, origin, zIndex, png, keyframes, fit }]     rigid part
//          [{ id, kind: 'deforming', bbox, origin, zIndex, frames: [{ png, bbox }] }]
//          [{ id: 'animation', kind: 'frames', bbox, frames: [{ png, bbox }] }]  fallback
//   images: { 'parts/part-1.png': { w, h, data: Uint8 straight RGBA }, ... }
//   labels: Int32Array (part index per pixel in frame 0, -1 none)   (not set on fallback)
// }
//
// A part is "rigid" if one transform per frame (move, turn, scale) explains it;
// otherwise it is "deforming" and is delivered frame by frame. If the animation is
// mostly deforming (or tracking failed), the whole animation is delivered frame by
// frame ("fallback"): always correct, just heavier.

import { buildParts } from './parts.mjs';
import { paint, interiorOf, fitOf, recompositionShares, ALPHA_MIN } from './geom.mjs';
import { createVoter, newRec, resetRec } from './stacking.mjs';

const MAX_PARTS = 12;
const MAX_DEFORMING_SHARE = 0.5;
const RECOMPOSE_MEDIAN = 0.05; // rebuilt vs real: typical frame...
const RECOMPOSE_WORST = 0.15; // ...and worst frame
// keyframe simplification tolerances
const TOL_PX = 0.5;
const TOL_DEG = 0.5;
const TOL_SCALE = 0.005;

const round = (v, d) => Math.round(v * d) / d + 0;

// --- images -----------------------------------------------------------------

// Straight RGBA crop of `frame`, keeping only pixels where keep(p) is true.
function cropImage(frame, bbox, keep) {
  const [bx, by, bw, bh] = bbox;
  const data = new Uint8Array(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const p = (by + y) * frame.w + bx + x;
      if (!keep(p)) continue;
      const a = frame.data[p * 4 + 3];
      if (a <= 0) continue;
      const o = (y * bw + x) * 4;
      for (let c = 0; c < 3; c++) data[o + c] = Math.max(0, Math.min(255, Math.round((frame.data[p * 4 + c] * 255) / a)));
      data[o + 3] = Math.max(0, Math.min(255, Math.round(a)));
    }
  }
  return { w: bw, h: bh, data };
}

function bboxOf(w, pixels) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const p of pixels) {
    const x = p % w;
    const y = (p / w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : [minX, minY, maxX - minX + 1, maxY - minY + 1];
}

// --- keyframes --------------------------------------------------------------

// Keep the fewest frames such that linear interpolation between them stays within tolerance.
function simplify(frames) {
  const n = frames.length;
  const keep = new Set([0, n - 1]);
  const err = (k, a, b) => {
    const u = b === a ? 0 : (k - a) / (b - a);
    const f = (key) => frames[a][key] + (frames[b][key] - frames[a][key]) * u;
    return Math.max(
      Math.abs(f('x') - frames[k].x) / TOL_PX,
      Math.abs(f('y') - frames[k].y) / TOL_PX,
      Math.abs(f('rotate') - frames[k].rotate) / TOL_DEG,
      Math.abs(f('scale') - frames[k].scale) / TOL_SCALE,
    );
  };
  for (;;) {
    const ks = [...keep].sort((p, q) => p - q);
    let worst = 1;
    let at = -1;
    for (let i = 0; i + 1 < ks.length; i++) {
      for (let k = ks[i] + 1; k < ks[i + 1]; k++) {
        const e = err(k, ks[i], ks[i + 1]);
        if (e > worst) {
          worst = e;
          at = k;
        }
      }
    }
    if (at < 0) return ks.map((k) => frames[k]);
    keep.add(at);
  }
}

// --- main -------------------------------------------------------------------

function wholeAnimation(frames, fps, why) {
  const { w, h } = frames[0];
  let box = null;
  const all = [];
  for (const f of frames) {
    const px = [];
    for (let p = 0; p < w * h; p++) if (f.data[p * 4 + 3] >= ALPHA_MIN) px.push(p);
    const b = bboxOf(w, px);
    if (b) all.push(b);
  }
  if (all.length) {
    const x0 = Math.min(...all.map((b) => b[0]));
    const y0 = Math.min(...all.map((b) => b[1]));
    const x1 = Math.max(...all.map((b) => b[0] + b[2]));
    const y1 = Math.max(...all.map((b) => b[1] + b[3]));
    box = [x0, y0, x1 - x0, y1 - y0];
  } else box = [0, 0, w, h];
  const images = {};
  const list = frames.map((f, k) => {
    const png = `frames/${String(k).padStart(4, '0')}.png`;
    images[png] = cropImage(f, box, () => true);
    return { png, bbox: box };
  });
  return {
    fps, width: w, height: h, fallback: true, reason: why,
    parts: [{ id: 'animation', kind: 'frames', bbox: box, frames: list }],
    images,
  };
}

export function analyze(frames, { fps = 60 } = {}) {
  const { w, h } = frames[0];
  let built;
  try {
    built = buildParts(frames);
  } catch (e) {
    return wholeAnimation(frames, fps, `tracking failed: ${e.message}`);
  }
  const { parts, labels } = built;
  if (parts.length > MAX_PARTS) return wholeAnimation(frames, fps, `too many parts (${parts.length})`);

  // Pixels of each part in frame 0, and their eroded version (a safe interior to compare).
  const members = parts.map(() => []);
  for (let p = 0; p < w * h; p++) if (labels[p] >= 0) members[labels[p]].push(p);
  const interior = members.map((list, i) => interiorOf(list, labels, i, w, h));

  // Who covers what, frame by frame (all parts), to skip occluded pixels.
  const voter = createVoter(frames[0], parts.length);
  const rec = newRec(w * h);
  const covers = frames.map((frame, t) => {
    const cover = new Uint8Array(w * h);
    resetRec(rec);
    parts.forEach((part, i) => paint(cover, part, part.transforms[t], labels, i, w, h, rec));
    voter.add(frame, rec);
    return cover;
  });

  // Rigid or deforming?
  parts.forEach((part, i) => {
    Object.assign(part, fitOf({ frames, interior: interior[i], origin: part.origin, transforms: part.transforms, covers, w, h }));
  });

  const total = parts.reduce((a, p) => a + p.area, 0);
  const deformingArea = parts.filter((p) => p.kind === 'deforming').reduce((a, p) => a + p.area, 0);
  if (deformingArea > total * MAX_DEFORMING_SHARE) {
    return wholeAnimation(frames, fps, `most of the animation deforms (${Math.round((100 * deformingArea) / total)}%)`);
  }

  // Who is in front: from the overlaps seen in the frames (rigid parts only).
  const z = voter.order(parts, parts.map((p) => p.kind === 'rigid'));

  // Safety net: put the rigid parts back where they were tracked and compare with the real frames.
  const shares = recompositionShares({ frames, parts, labels, z, hasDeforming: parts.some((p) => p.kind === 'deforming'), w, h });
  const sorted = [...shares].sort((x, y) => x - y);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const worst = sorted.length ? sorted[sorted.length - 1] : 0;
  if (median > RECOMPOSE_MEDIAN || worst > RECOMPOSE_WORST) {
    return wholeAnimation(frames, fps, `recomposition does not match the frames (typical ${(100 * median).toFixed(1)}%, worst ${(100 * worst).toFixed(1)}%)`);
  }

  // Output.
  const images = {};
  const out = [];
  const zOf = (i) => z[i];
  const deforming = [];
  parts.forEach((part, i) => {
    const base = { id: part.id, kind: part.kind, bbox: part.bbox, origin: part.origin, zIndex: zOf(i), fit: part.fit };
    if (part.kind === 'rigid') {
      const png = `parts/${part.id}.png`;
      images[png] = cropImage(frames[0], part.bbox, (p) => labels[p] === i);
      const kfs = part.transforms.map((T, t) => ({
        t: round((t * 1000) / fps, 10),
        x: round(T.tx, 100),
        y: round(T.ty, 100),
        rotate: round(T.theta, 10),
        scale: round(T.s, 1000),
      }));
      out.push({ ...base, png, keyframes: simplify(kfs) });
    } else {
      const entry = { ...base, frames: [] };
      out.push(entry);
      deforming.push({ i, entry });
    }
  });

  // Deforming parts: whatever is on screen in each frame and not explained by a rigid part.
  if (deforming.length) {
    const rigidIdx = parts.map((p, i) => (p.kind === 'rigid' ? i : -1)).filter((i) => i >= 0);
    let lastBoxes = deforming.map(({ i }) => parts[i].bbox);
    frames.forEach((frame, t) => {
      const cover = new Uint8Array(w * h);
      for (const i of rigidIdx) paint(cover, parts[i], parts[i].transforms[t], labels, i, w, h);
      const mine = deforming.map(() => []);
      for (let p = 0; p < w * h; p++) {
        if (frame.data[p * 4 + 3] < ALPHA_MIN || cover[p] > 0) continue;
        let best = 0;
        let bestD = Infinity;
        lastBoxes.forEach((b, k) => {
          const x = p % w;
          const y = (p / w) | 0;
          const dx = Math.max(b[0] - x, 0, x - (b[0] + b[2] - 1));
          const dy = Math.max(b[1] - y, 0, y - (b[1] + b[3] - 1));
          const d = Math.hypot(dx, dy);
          if (d < bestD) {
            bestD = d;
            best = k;
          }
        });
        mine[best].push(p);
      }
      deforming.forEach(({ entry }, k) => {
        const box = bboxOf(w, mine[k]);
        if (!box) {
          entry.frames.push({ png: null, bbox: [0, 0, 0, 0] });
          return;
        }
        lastBoxes[k] = box;
        const set = new Set(mine[k]);
        const png = `parts/${entry.id}/${String(t).padStart(4, '0')}.png`;
        images[png] = cropImage(frame, box, (p) => set.has(p));
        entry.frames.push({ png, bbox: box });
      });
    });
  }

  return { fps, width: w, height: h, fallback: false, parts: out, images, labels };
}
