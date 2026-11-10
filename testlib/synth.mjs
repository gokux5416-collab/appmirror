// Test helper: build synthetic animation frames in memory (no files).
//
// A frame is { w, h, data } where data is a Float32Array of premultiplied RGBA
// (0..255), the format the tracking code works with.
//
// A shape is { rect: [x, y, w, h], color: [r, g, b], origin: [ox, oy], T }, where
// T = { tx, ty, theta, s } is applied about `origin`. Convention (y points down):
//   X = ox + tx + s * (cos(theta) * dx - sin(theta) * dy)
//   Y = oy + ty + s * (sin(theta) * dx + cos(theta) * dy)      with (dx, dy) = p - origin
// so a positive theta turns clockwise on screen. Shapes are drawn in order, later
// ones on top. Edges are anti-aliased (4x4 supersampling).

import fs from 'node:fs';
import { PNG } from 'pngjs';

const SS = 4;

function inverse(T, origin, X, Y) {
  const r = ((T.theta ?? 0) * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  const sc = T.s ?? 1;
  const ux = (X - origin[0] - (T.tx ?? 0)) / sc;
  const uy = (Y - origin[1] - (T.ty ?? 0)) / sc;
  // rotate by -theta
  return [origin[0] + c * ux + s * uy, origin[1] - s * ux + c * uy];
}

export function makeFrame(w, h, shapes) {
  const data = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (const sh of shapes) {
        const [rx, ry, rw, rh] = sh.rect;
        const T = sh.T ?? {};
        // quick reject: pixels farther from the origin than any point of the moved rect can be
        const o = sh.origin ?? [rx + (rw - 1) / 2, ry + (rh - 1) / 2];
        const reach = (T.s ?? 1) * (Math.hypot(rx + (rw - 1) / 2 - o[0], ry + (rh - 1) / 2 - o[1]) + Math.hypot(rw, rh) / 2) + Math.hypot(T.tx ?? 0, T.ty ?? 0) + 2;
        if (Math.hypot(x - o[0], y - o[1]) > reach) continue;
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            const X = x - 0.5 + (sx + 0.5) / SS;
            const Y = y - 0.5 + (sy + 0.5) / SS;
            // default origin = center of the rect (pixel i covers [i - 0.5, i + 0.5))
            const [px, py] = inverse(T, sh.origin ?? [rx + (rw - 1) / 2, ry + (rh - 1) / 2], X, Y);
            // pixel (i, j) covers [i - 0.5, i + 0.5) in index coordinates
            if (px >= rx - 0.5 && px < rx + rw - 0.5 && py >= ry - 0.5 && py < ry + rh - 0.5) hits++;
          }
        }
        const cov = hits / (SS * SS);
        if (cov === 0) continue;
        for (let ch = 0; ch < 3; ch++) data[i + ch] = data[i + ch] * (1 - cov) + sh.color[ch] * cov;
        data[i + 3] = data[i + 3] * (1 - cov) + 255 * cov;
      }
    }
  }
  return { w, h, data };
}

// Pixels whose alpha is at least 128, as a Uint8Array mask (1 = object).
export function maskOf(frame) {
  const m = new Uint8Array(frame.w * frame.h);
  for (let p = 0; p < m.length; p++) m[p] = frame.data[p * 4 + 3] >= 128 ? 1 : 0;
  return m;
}

// Write a frame as a straight-alpha RGBA PNG file.
export function savePng(frame, file) {
  const png = new PNG({ width: frame.w, height: frame.h });
  for (let p = 0; p < frame.w * frame.h; p++) {
    const a = frame.data[p * 4 + 3];
    for (let c = 0; c < 3; c++) png.data[p * 4 + c] = a > 0 ? Math.round((frame.data[p * 4 + c] * 255) / a) : 0;
    png.data[p * 4 + 3] = Math.round(a);
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}
