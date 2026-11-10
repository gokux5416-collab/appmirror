// From frames to parts.
//
// 1. Split frame 0 into color regions (segment.mjs).
// 2. Track every region on its own through all the frames (align.mjs).
// 3. Merge regions that move together on EVERY frame into one part. A region that
//    is still for a while and moves later is therefore not merged with the body.
//    (Two regions that never move relative to each other in the clip are merged:
//    for this clip they are one part.)
// 4. Thin regions (outlines) are not tracked; each pixel goes to the nearest part.
//
// buildParts(frames) -> { w, h, parts, labels }
//   parts  [{ id, regionIds, area, bbox, origin, transforms, maxCost }] biggest first.
//          transforms[t] = { tx, ty, theta, s } relative to frame 0, about `origin`
//          (the centroid of the part's frame-0 pixels).
//   labels Int32Array, part index per pixel (-1 = none).

import { segmentFrame } from './segment.mjs';
import { makeRegion, trackRegion, transformPoint } from './align.mjs';

const MERGE_DIST = 1.5; // px: where B ends up, whether A's transform or B's own
const MERGE_ANGLE = 2; // degrees
const MERGE_SCALE = 0.03;

const round2 = (v) => Math.round(v * 100) / 100 + 0; // "+ 0" turns -0 into 0

// Do A and B move together on every frame?
function moveTogether(a, b) {
  for (let t = 0; t < a.transforms.length; t++) {
    const ta = a.transforms[t];
    const tb = b.transforms[t];
    const [px, py] = transformPoint(ta, a.region.origin, b.region.origin[0], b.region.origin[1]);
    const dx = px - (b.region.origin[0] + tb.tx);
    const dy = py - (b.region.origin[1] + tb.ty);
    if (Math.hypot(dx, dy) > MERGE_DIST) return false;
    if (Math.abs(ta.theta - tb.theta) > MERGE_ANGLE) return false;
    if (Math.abs(ta.s - tb.s) > MERGE_SCALE) return false;
  }
  return true;
}

export function buildParts(frames, { segment } = {}) {
  const seg = segmentFrame(frames[0], segment);
  const { w, h } = seg;

  const tracked = seg.regions
    .filter((r) => !r.thin)
    .map((info) => {
      const region = makeRegion(frames[0], seg.mask(info.id));
      return { info, region, transforms: trackRegion(region, frames) };
    });

  // Merge (union-find).
  const parent = tracked.map((_, i) => i);
  const find = (i) => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (let i = 0; i < tracked.length; i++) {
    for (let j = i + 1; j < tracked.length; j++) {
      if (find(i) !== find(j) && moveTogether(tracked[i], tracked[j])) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  tracked.forEach((r, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(r);
  });

  // Pixel labels: tracked regions first, then thin regions take the nearest part.
  const regionToGroup = new Map();
  [...groups.values()].forEach((members, g) => members.forEach((m) => regionToGroup.set(m.info.id, g)));
  const n = w * h;
  const groupOf = new Int32Array(n).fill(-1);
  const queue = [];
  for (let p = 0; p < n; p++) {
    const id = seg.labels[p];
    if (id >= 0 && regionToGroup.has(id)) {
      groupOf[p] = regionToGroup.get(id);
      queue.push(p);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const p = queue[head];
    const x = p % w;
    const y = (p / w) | 0;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
      if (q < 0 || groupOf[q] !== -1 || seg.labels[q] < 0) continue; // only thin-region pixels remain
      groupOf[q] = groupOf[p];
      queue.push(q);
    }
  }

  // One part per group.
  const raw = [...groups.values()].map((members, g) => {
    let area = 0;
    let sx = 0;
    let sy = 0;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let p = 0; p < n; p++) {
      if (groupOf[p] !== g) continue;
      const x = p % w;
      const y = (p / w) | 0;
      area++;
      sx += x;
      sy += y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const origin = [sx / area, sy / area];
    // The part follows its biggest region; re-express that transform about the part origin.
    const lead = members.reduce((a, b) => (b.info.area > a.info.area ? b : a));
    const transforms = lead.transforms.map((T) => {
      const [px, py] = transformPoint(T, lead.region.origin, origin[0], origin[1]);
      return { tx: round2(px - origin[0]), ty: round2(py - origin[1]), theta: T.theta + 0, s: T.s };
    });
    return {
      g,
      regionIds: members.map((m) => m.info.id),
      area,
      bbox: [minX, minY, maxX - minX + 1, maxY - minY + 1],
      origin: [round2(origin[0]), round2(origin[1])],
      transforms,
      maxCost: Math.max(...lead.transforms.map((T) => T.cost)),
    };
  });

  raw.sort((a, b) => b.area - a.area);
  const newIndex = new Map(raw.map((p, i) => [p.g, i]));
  const labels = new Int32Array(n);
  for (let p = 0; p < n; p++) labels[p] = groupOf[p] === -1 ? -1 : newIndex.get(groupOf[p]);
  const parts = raw.map(({ g, ...rest }, i) => ({ id: `part-${i + 1}`, ...rest }));

  return { w, h, parts, labels };
}
