// Shared geometry and fit measurement for part tracking.
//
// Transform convention (same as align.mjs): T = { tx, ty, theta (deg, clockwise on
// screen), s } about an origin o. Pixel i is centered on coordinate i.

export const ALPHA_MIN = 128;
const MISMATCH_COLOR = 40; // max channel difference that counts as a different color
const RIGID_MEDIAN = 0.03;
const RIGID_P90 = 0.1;

const round = (v, d) => Math.round(v * d) / d + 0;
const quantile = (sorted, q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);


export function forward(T, o, x, y) {
  const r = (T.theta * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const dx = x - o[0];
  const dy = y - o[1];
  return [o[0] + T.tx + T.s * (c * dx - s * dy), o[1] + T.ty + T.s * (s * dx + c * dy)];
}

export function inverse(T, o, X, Y) {
  const r = (T.theta * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const ux = (X - o[0] - T.tx) / T.s;
  const uy = (Y - o[1] - T.ty) / T.s;
  return [o[0] + c * ux + s * uy, o[1] - s * ux + c * uy];
}

// Mark (count) the pixels of frame t covered by `part` moved by T. Inverse mapping,
// so there are no holes. cover is a Uint8Array w*h.
// `rec` (optional) remembers the first two parts that cover each pixel and which
// frame-0 pixel each one shows there: { ownA, srcA, ownB, srcB } Int32Arrays (-1 = none).
export function paint(cover, part, T, labels, index, w, h, rec) {
  const [bx, by, bw, bh] = part.bbox;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [cx, cy] of [[bx - 0.5, by - 0.5], [bx + bw - 0.5, by - 0.5], [bx - 0.5, by + bh - 0.5], [bx + bw - 0.5, by + bh - 0.5]]) {
    const [X, Y] = forward(T, part.origin, cx, cy);
    minX = Math.min(minX, X); maxX = Math.max(maxX, X);
    minY = Math.min(minY, Y); maxY = Math.max(maxY, Y);
  }
  const x0 = Math.max(0, Math.floor(minX) - 1);
  const x1 = Math.min(w - 1, Math.ceil(maxX) + 1);
  const y0 = Math.max(0, Math.floor(minY) - 1);
  const y1 = Math.min(h - 1, Math.ceil(maxY) + 1);
  for (let Y = y0; Y <= y1; Y++) {
    for (let X = x0; X <= x1; X++) {
      const [sx, sy] = inverse(T, part.origin, X, Y);
      const ix = Math.round(sx);
      const iy = Math.round(sy);
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      if (labels[iy * w + ix] !== index) continue;
      const d = Y * w + X;
      if (rec) {
        if (cover[d] === 0) { rec.ownA[d] = index; rec.srcA[d] = iy * w + ix; }
        else if (cover[d] === 1) { rec.ownB[d] = index; rec.srcB[d] = iy * w + ix; }
      }
      if (cover[d] < 255) cover[d]++;
    }
  }
}

// Bilinear sample of a premultiplied RGBA frame (pixel i is centered on i). Outside = transparent.
export function sample(frame, X, Y, out) {
  const { w, h, data } = frame;
  const x0 = Math.floor(X);
  const y0 = Math.floor(Y);
  const fx = X - x0;
  const fy = Y - y0;
  out[0] = out[1] = out[2] = out[3] = 0;
  for (let j = 0; j < 2; j++) {
    for (let i = 0; i < 2; i++) {
      const x = x0 + i;
      const y = y0 + j;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const wt = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
      const p = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) out[c] += data[p + c] * wt;
    }
  }
}

// Frame-0 pixels of one label, eroded by one pixel (a safe interior to compare).
export function interiorOf(list, labels, index, w, h) {
  const inner = list.filter((p) => {
    const x = p % w;
    const y = (p / w) | 0;
    return x > 0 && y > 0 && x < w - 1 && y < h - 1 && labels[p - 1] === index && labels[p + 1] === index && labels[p - w] === index && labels[p + w] === index;
  });
  return inner.length ? inner : list;
}

// How well does one transform per frame explain this piece? For every frame, the share
// of its frame-0 interior pixels whose color is not found where the transform sends
// them (skipping pixels that another piece covers: occlusion). Rigid if the median
// share is tiny and the 90th percentile is small.
export function fitOf({ frames, interior, origin, transforms, covers, w, h }) {
  const px = new Float32Array(4);
  const shares = [];
  for (let t = 1; t < frames.length; t++) {
    let counted = 0;
    let bad = 0;
    for (const p of interior) {
      const [X, Y] = forward(transforms[t], origin, p % w, (p / w) | 0);
      const rx = Math.round(X);
      const ry = Math.round(Y);
      if (rx < 0 || ry < 0 || rx >= w || ry >= h) {
        counted++;
        bad++;
        continue;
      }
      if (covers[t][ry * w + rx] >= 2) continue; // someone else is here too: skip
      sample(frames[t], X, Y, px);
      counted++;
      let d = 0;
      for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(px[c] - frames[0].data[p * 4 + c]));
      if (d > MISMATCH_COLOR) bad++;
    }
    if (counted >= interior.length * 0.1) shares.push(bad / counted);
  }
  shares.sort((a, b) => a - b);
  const fit = { median: round(quantile(shares, 0.5), 1000), p90: round(quantile(shares, 0.9), 1000) };
  return { fit, kind: fit.median <= RIGID_MEDIAN && fit.p90 <= RIGID_P90 ? 'rigid' : 'deforming' };
}
