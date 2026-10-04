// Poking with a fingertip, the way a button is pressed: a press when the fingertip reaches a
// target, and no second press until it has drawn back. Targets are generous spheres, because a
// hand in the air is not a mouse. Pure: positions in, events out, so the Node tests drive it.

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// press: how far inside a target's sphere counts as touching it (0 = its surface);
// release: how far outside it the fingertip must draw back before it can press again;
// hover: how near counts as reaching for it.
export function createPoker({ press = 0, release = 0.015, hover = 0.05 } = {}) {
  const armed = new Map();
  return function step(tips, targets) {
    const out = { hovered: new Set(), presses: [] };
    for (const tip of tips) {
      if (!tip.p) { armed.delete(tip.id); continue; }
      let best = null, bd = Infinity;
      for (const t of targets) {
        const d = dist(tip.p, t.p) - t.r;
        if (d < bd) { bd = d; best = t; }
      }
      // a fingertip that arrives already inside a target has to leave it before it presses
      if (!armed.has(tip.id)) armed.set(tip.id, !(best && bd <= release));
      if (best && bd < hover) out.hovered.add(best.id);
      if (best && bd <= press && armed.get(tip.id)) {
        out.presses.push({ tip: tip.id, target: best.id });
        armed.set(tip.id, false);
      } else if (!best || bd > release) armed.set(tip.id, true);
    }
    return out;
  };
}

// The angle, around a centre on the table, that a pinch has moved through since it began:
// turning the board like a lazy Susan. Positions are {x, z}; the result is in radians.
export function turnAngle(center, from, to) {
  const a0 = Math.atan2(from.z - center.z, from.x - center.x);
  const a1 = Math.atan2(to.z - center.z, to.x - center.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
