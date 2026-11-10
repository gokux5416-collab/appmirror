// Tracking of one region (a group of pixels of frame 0) through the next frames.
//
// For every frame t we look for the transform that moves the region's frame-0
// pixels onto frame t. Transforms are always relative to frame 0 (never
// frame-to-frame), so errors do not accumulate.
//
// A frame is { w, h, data }: data is a Float32Array of premultiplied RGBA (0..255).
// A transform is { tx, ty, theta, s }, applied about the region's origin
// (the centroid of its frame-0 pixels). Convention, y pointing down:
//   X = ox + tx + s * (cos(theta) * dx - sin(theta) * dy)
//   Y = oy + ty + s * (sin(theta) * dx + cos(theta) * dy)       (dx, dy) = p - origin
// theta is in degrees, positive = clockwise on screen (same as React Native rotate).

const MAX_MASK_POINTS = 1500;
const MAX_RING_POINTS = 600;
const GOOD_ENOUGH = 1.5; // a translation-only fit this good is accepted as is
const RING_WIDTH = 2; // px of background around the region that must stay empty
const ERR_CAP = 60; // per-pixel error is capped, so a few bad pixels cannot dominate
const GAIN = 0.1; // an extra degree of freedom must cut the cost by 10%...
const MIN_GAIN = 0.3; // ...and by at least this much (cost units)

const STEPS = {
  tx: [16, 8, 4, 2, 1, 0.5, 0.25, 0.1],
  ty: [16, 8, 4, 2, 1, 0.5, 0.25, 0.1],
  theta: [8, 4, 2, 1, 0.5, 0.25, 0.1],
  s: [0.1, 0.05, 0.02, 0.01, 0.005, 0.002],
};

export const IDENTITY = Object.freeze({ tx: 0, ty: 0, theta: 0, s: 1 });

// Frames are compared after a light blur ([1 4 6 4 1] / 16, both directions).
// Anti-aliased edges never look exactly the same once a shape has moved or
// turned; without the blur this edge noise drowns out small rotations.
const KERNEL = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
const blurCache = new WeakMap();

function blurPass(src, w, h, horizontal) {
  const dst = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let k = -2; k <= 2; k++) {
        const nx = horizontal ? x + k : x;
        const ny = horizontal ? y : y + k;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue; // outside counts as empty
        const i = (ny * w + nx) * 4;
        const wt = KERNEL[k + 2];
        dst[o] += src[i] * wt;
        dst[o + 1] += src[i + 1] * wt;
        dst[o + 2] += src[i + 2] * wt;
        dst[o + 3] += src[i + 3] * wt;
      }
    }
  }
  return dst;
}

export function blurred(frame) {
  let b = blurCache.get(frame);
  if (!b) {
    b = { w: frame.w, h: frame.h, data: blurPass(blurPass(frame.data, frame.w, frame.h, true), frame.w, frame.h, false) };
    blurCache.set(frame, b);
  }
  return b;
}

export function transformPoint(T, origin, x, y) {
  const r = (T.theta * Math.PI) / 180;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const dx = x - origin[0];
  const dy = y - origin[1];
  return [origin[0] + T.tx + T.s * (c * dx - sn * dy), origin[1] + T.ty + T.s * (sn * dx + c * dy)];
}

// Pick at most `max` items, evenly spread.
function thin(list, max) {
  if (list.length <= max) return list;
  const stride = list.length / max;
  const out = [];
  for (let i = 0; i < max; i++) out.push(list[Math.floor(i * stride)]);
  return out;
}

// Build a region from frame 0 and a mask (Uint8Array, 1 = pixel of the region).
// Sample points = the region's pixels + a thin ring of empty background around
// it (a region that slides over the background must be penalized).
export function makeRegion(frame0, mask) {
  const { w, h, data } = frame0;
  const inside = [];
  let sx = 0;
  let sy = 0;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      inside.push(y * w + x);
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (inside.length === 0) throw new Error('empty region');
  const origin = [sx / inside.length, sy / inside.length];

  const ring = [];
  for (let y = Math.max(0, minY - RING_WIDTH); y <= Math.min(h - 1, maxY + RING_WIDTH); y++) {
    for (let x = Math.max(0, minX - RING_WIDTH); x <= Math.min(w - 1, maxX + RING_WIDTH); x++) {
      const p = y * w + x;
      if (mask[p] || data[p * 4 + 3] >= 128) continue;
      let near = false;
      for (let dy = -RING_WIDTH; dy <= RING_WIDTH && !near; dy++) {
        for (let dx = -RING_WIDTH; dx <= RING_WIDTH; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny * w + nx]) {
            near = true;
            break;
          }
        }
      }
      if (near) ring.push(p);
    }
  }

  const pts = [...thin(inside, MAX_MASK_POINTS), ...thin(ring, MAX_RING_POINTS)];
  const n = pts.length;
  const xs = new Float32Array(n);
  const ys = new Float32Array(n);
  const c0 = new Float32Array(n * 4);
  const ref = blurred(frame0).data;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    xs[i] = p % w;
    ys[i] = (p / w) | 0;
    for (let ch = 0; ch < 4; ch++) c0[i * 4 + ch] = ref[p * 4 + ch];
  }
  return {
    origin,
    bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
    pixels: inside.length,
    n,
    xs,
    ys,
    c0,
  };
}

// Mean (capped) color error between the region's frame-0 pixels moved by T and
// what frame t shows there. 0 = perfect match.
export function cost(region, frame, T) {
  const { n, xs, ys, c0, origin } = region;
  const { w, h, data } = blurred(frame);
  const r = (T.theta * Math.PI) / 180;
  const c = Math.cos(r);
  const sn = Math.sin(r);
  const ox = origin[0];
  const oy = origin[1];
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - ox;
    const dy = ys[i] - oy;
    const X = ox + T.tx + T.s * (c * dx - sn * dy);
    const Y = oy + T.ty + T.s * (sn * dx + c * dy);
    const x0 = Math.floor(X);
    const y0 = Math.floor(Y);
    const fx = X - x0;
    const fy = Y - y0;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;
    const in0x = x0 >= 0 && x0 < w;
    const in1x = x0 + 1 >= 0 && x0 + 1 < w;
    const in0y = y0 >= 0 && y0 < h;
    const in1y = y0 + 1 >= 0 && y0 + 1 < h;
    const p00 = in0x && in0y ? (y0 * w + x0) * 4 : -1;
    const p10 = in1x && in0y ? (y0 * w + x0 + 1) * 4 : -1;
    const p01 = in0x && in1y ? ((y0 + 1) * w + x0) * 4 : -1;
    const p11 = in1x && in1y ? ((y0 + 1) * w + x0 + 1) * 4 : -1;
    let e = 0;
    for (let ch = 0; ch < 4; ch++) {
      const v =
        (p00 >= 0 ? data[p00 + ch] * w00 : 0) +
        (p10 >= 0 ? data[p10 + ch] * w10 : 0) +
        (p01 >= 0 ? data[p01 + ch] * w01 : 0) +
        (p11 >= 0 ? data[p11 + ch] * w11 : 0);
      const d = Math.abs(v - c0[i * 4 + ch]);
      if (d > e) e = d;
    }
    sum += e > ERR_CAP ? ERR_CAP : e;
  }
  return sum / n;
}

// Pattern search: try +/- a step on each free parameter, keep what lowers the
// cost, and shrink the steps. Binary steps (16, 8, 4, ...) land exactly on
// whole pixels, so a pure translation by whole pixels is found exactly.
function refine(region, frame, init, free) {
  let best = { ...init };
  let bestCost = cost(region, frame, best);
  for (let level = 0; level < 8; level++) {
    let improved = true;
    for (let guard = 0; improved && guard < 40; guard++) {
      improved = false;
      for (const k of free) {
        const step = STEPS[k][level];
        if (step === undefined) continue;
        for (const sign of [1, -1]) {
          const cand = { ...best, [k]: best[k] + sign * step };
          if (k === 's' && cand.s <= 0.05) continue;
          const c = cost(region, frame, cand);
          if (c < bestCost - 1e-9) {
            best = cand;
            bestCost = c;
            improved = true;
            break;
          }
        }
      }
    }
  }
  return { ...best, cost: bestCost };
}

function bestOf(region, frame, free, starts) {
  let best = null;
  for (const start of starts) {
    const r = refine(region, frame, start, free);
    if (!best || r.cost < best.cost) best = r;
  }
  return best;
}

const better = (candidate, current) => candidate.cost < current.cost * (1 - GAIN) - MIN_GAIN;

const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

// Transform of the region on every frame (frames[0] is the reference).
// Nested models: translation only, then + rotation, then + scale. An extra
// degree of freedom is kept only if it clearly lowers the error, so a pure
// translation comes out with rotation exactly 0 and scale exactly 1.
export function trackRegion(region, frames) {
  const raw = [{ ...IDENTITY, cost: cost(region, frames[0], IDENTITY) }];
  for (let t = 1; t < frames.length; t++) {
    const prev = raw[t - 1];
    const frame = frames[t];

    let best = refine(region, frame, { tx: prev.tx, ty: prev.ty, theta: 0, s: 1 }, ['tx', 'ty']);

    // Most of the time translation alone explains the frame: nothing more to try.
    // (An object that already rotated or scaled before keeps being tried.)
    if (best.cost < GOOD_ENOUGH && prev.theta === 0 && prev.s === 1) {
      raw.push(best);
      continue;
    }

    // A simpler model can settle in a wrong spot (it shifts by a pixel to make up
    // for a rotation it cannot express). So each richer model also starts again
    // from the previous frame's full transform, and the cheapest result wins.
    const withRotation = bestOf(region, frame, ['tx', 'ty', 'theta'], [
      { tx: prev.tx, ty: prev.ty, theta: prev.theta, s: 1 },
      { tx: best.tx, ty: best.ty, theta: 0, s: 1 },
    ]);
    if (better(withRotation, best)) best = withRotation;

    const withScale = bestOf(region, frame, ['tx', 'ty', 'theta', 's'], [
      { tx: prev.tx, ty: prev.ty, theta: prev.theta, s: prev.s },
      { tx: best.tx, ty: best.ty, theta: best.theta, s: prev.s },
    ]);
    if (better(withScale, best)) best = withScale;

    raw.push(best);
  }
  return raw.map((r) => ({
    tx: round(r.tx, 2),
    ty: round(r.ty, 2),
    theta: round(r.theta, 1),
    s: round(r.s, 3),
    cost: round(r.cost, 2),
  }));
}
