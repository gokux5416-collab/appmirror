// Over-segmentation of frame 0 into regions of (almost) uniform color.
//
// The art is flat-colored (mascots, icons), but video compression adds a little
// noise, so a region grows to neighbors whose color is close to the region's mean.
// Then:
//   - tiny regions (specks, anti-aliasing leftovers) are absorbed by the
//     neighbor they touch most;
//   - thin regions (outlines, highlights) are flagged `thin`: they are too narrow
//     to track on their own and are given to the nearest tracked part later.
//
// segmentFrame(frame) -> { w, h, labels, regions, mask(id) }
//   labels  Int32Array, region id per pixel, -1 = background
//   regions [{ id, area, color: [r, g, b], bbox: [x, y, w, h], thin }]

const DEFAULT_TOLERANCE = 28; // max per-channel distance to the region's mean color
const DEFAULT_MIN_AREA = 20; // px; smaller regions are merged into a neighbor
const THIN_RADIUS = 2; // a pixel is "interior" if its (2r+1)-square is all the same region
const THIN_SHARE = 0.15; // a region with fewer interior pixels than this share is thin
const OPAQUE = 128;

export function segmentFrame(frame, { tolerance = DEFAULT_TOLERANCE, minArea = DEFAULT_MIN_AREA } = {}) {
  const { w, h, data } = frame;
  const n = w * h;

  const opaque = (p) => data[p * 4 + 3] >= OPAQUE;
  const color = (p, ch) => (data[p * 4 + ch] * 255) / data[p * 4 + 3];

  // 1. Region growing (4-connectivity) against the running mean color.
  const labels = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let count = 0;
  for (let seed = 0; seed < n; seed++) {
    if (labels[seed] !== -1 || !opaque(seed)) continue;
    const id = count++;
    let head = 0;
    let tail = 0;
    queue[tail++] = seed;
    labels[seed] = id;
    const sum = [color(seed, 0), color(seed, 1), color(seed, 2)];
    let size = 1;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w;
      const y = (p / w) | 0;
      const neighbors = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of neighbors) {
        if (q < 0 || labels[q] !== -1 || !opaque(q)) continue;
        let close = true;
        for (let ch = 0; ch < 3; ch++) {
          if (Math.abs(color(q, ch) - sum[ch] / size) > tolerance) {
            close = false;
            break;
          }
        }
        if (!close) continue;
        labels[q] = id;
        queue[tail++] = q;
        for (let ch = 0; ch < 3; ch++) sum[ch] += color(q, ch);
        size++;
      }
    }
  }

  // 2. Absorb tiny regions into the neighbor they touch most (smallest first).
  const area = new Int32Array(count);
  for (let p = 0; p < n; p++) if (labels[p] >= 0) area[labels[p]]++;
  const parent = Array.from({ length: count }, (_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  const dropped = new Set(); // isolated specks that touch nothing
  const small = [...parent].filter((i) => area[i] < minArea).sort((a, b) => area[a] - area[b]);
  for (const id of small) {
    if (find(id) !== id) continue;
    const contact = new Map();
    for (let p = 0; p < n; p++) {
      if (labels[p] < 0 || find(labels[p]) !== id) continue;
      const x = p % w;
      const y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || labels[q] < 0) continue;
        const r = find(labels[q]);
        if (r !== id) contact.set(r, (contact.get(r) ?? 0) + 1);
      }
    }
    if (contact.size === 0) {
      dropped.add(id);
      continue;
    }
    const target = [...contact.entries()].sort((a, b) => b[1] - a[1] || area[b[0]] - area[a[0]])[0][0];
    parent[id] = target;
    area[target] += area[id];
  }

  // 3. Compact ids.
  const newId = new Map();
  for (let p = 0; p < n; p++) {
    if (labels[p] < 0) continue;
    const r = find(labels[p]);
    if (dropped.has(r)) {
      labels[p] = -1;
      continue;
    }
    if (!newId.has(r)) newId.set(r, newId.size);
    labels[p] = newId.get(r);
  }
  const total = newId.size;

  // 4. Region stats and thin detection.
  const stats = Array.from({ length: total }, () => ({
    area: 0,
    sum: [0, 0, 0],
    minX: w,
    minY: h,
    maxX: -1,
    maxY: -1,
    interior: 0,
  }));
  for (let p = 0; p < n; p++) {
    const id = labels[p];
    if (id < 0) continue;
    const s = stats[id];
    const x = p % w;
    const y = (p / w) | 0;
    s.area++;
    for (let ch = 0; ch < 3; ch++) s.sum[ch] += color(p, ch);
    if (x < s.minX) s.minX = x;
    if (x > s.maxX) s.maxX = x;
    if (y < s.minY) s.minY = y;
    if (y > s.maxY) s.maxY = y;
    let interior = x >= THIN_RADIUS && x < w - THIN_RADIUS && y >= THIN_RADIUS && y < h - THIN_RADIUS;
    for (let dy = -THIN_RADIUS; dy <= THIN_RADIUS && interior; dy++) {
      for (let dx = -THIN_RADIUS; dx <= THIN_RADIUS; dx++) {
        if (labels[(y + dy) * w + x + dx] !== id) {
          interior = false;
          break;
        }
      }
    }
    if (interior) s.interior++;
  }

  const regions = stats.map((s, id) => ({
    id,
    area: s.area,
    color: s.sum.map((v) => Math.round(v / s.area)),
    bbox: [s.minX, s.minY, s.maxX - s.minX + 1, s.maxY - s.minY + 1],
    thin: s.interior < THIN_SHARE * s.area,
  }));

  return {
    w,
    h,
    labels,
    regions,
    mask(id) {
      const m = new Uint8Array(n);
      for (let p = 0; p < n; p++) if (labels[p] === id) m[p] = 1;
      return m;
    },
  };
}
