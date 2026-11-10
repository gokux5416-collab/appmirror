// Which part is drawn in front of which?
//
// Where two parts overlap in a frame, the color on screen is the color of the one on
// top. For every such pixel, compare the screen color with the frame-0 color each part
// would show there; the closer one wins a vote. Votes over all frames give a "is in
// front of" relation, which is turned into zIndex values (0 = back).
// Ties and parts that never overlap keep the default: bigger parts further back.

const DECISIVE = 40; // the two candidates must differ by more than this on screen

export function newRec(n) {
  return { ownA: new Int32Array(n), srcA: new Int32Array(n), ownB: new Int32Array(n), srcB: new Int32Array(n) };
}
export function resetRec(rec) {
  rec.ownA.fill(-1);
  rec.ownB.fill(-1);
}

export function createVoter(frame0, nParts) {
  const wins = Array.from({ length: nParts }, () => new Int32Array(nParts)); // wins[a][b]: a seen in front of b
  const f0 = frame0.data;
  const channelDiff = (data, p, q) => {
    let d = 0;
    for (let c = 0; c < 4; c++) d = Math.max(d, Math.abs(data[p * 4 + c] - f0[q * 4 + c]));
    return d;
  };
  return {
    // rec = { ownA, srcA, ownB, srcB } as filled by geom.paint for this frame
    add(frame, rec) {
      const { ownA, srcA, ownB, srcB } = rec;
      for (let p = 0; p < ownB.length; p++) {
        const a = ownA[p];
        const b = ownB[p];
        if (b < 0 || a < 0) continue;
        const da = channelDiff(frame.data, p, srcA[p]);
        const db = channelDiff(frame.data, p, srcB[p]);
        if (Math.abs(da - db) <= DECISIVE) continue;
        if (da < db) wins[a][b]++;
        else wins[b][a]++;
      }
    },
    // parts: [{ area }]. eligible[i] false = ignore this part's votes. Returns z[i] (0 = back).
    order(parts, eligible = parts.map(() => true)) {
      const front = (a, b) => eligible[a] && eligible[b] && wins[a][b] > wins[b][a];
      const placed = [];
      const left = new Set(parts.map((_, i) => i));
      while (left.size) {
        // placeable = nothing it is in front of is still waiting
        const free = [...left].filter((a) => [...left].every((b) => b === a || !front(a, b)));
        const pool = free.length ? free : [...left]; // a cycle: fall back to size
        pool.sort((a, b) => parts[b].area - parts[a].area || a - b);
        placed.push(pool[0]);
        left.delete(pool[0]);
      }
      const z = new Array(parts.length);
      placed.forEach((idx, rank) => (z[idx] = rank));
      return z;
    },
  };
}
