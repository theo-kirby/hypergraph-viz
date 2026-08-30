// ===========================================================================
// The auto-computed bow: the bowScale that makes each sibling fan leave its
// parent as one merged line that forks partway out.
//
// With originSpread 0 every sibling arrow leaves through the same point on
// the parent outline. A bow of (1+cos a)/cos a would put the curve's
// midpoint exactly on the spoke; BOW_MERGE backs that off so the midpoint
// stays just on its own side — the curves hug each other into one apparent
// line and fork about halfway out, without crossing to the far side. The
// constant is calibrated to the hand-picked 1.75 at a 16° fan angle.
// ===========================================================================

import { radialLayout, buildForest } from "./excaligraph.js";

const BOW_MERGE = 0.857; // fraction of the mid-on-spoke bow (see header)

// Median angle between a fanned child's chord (parent → child) and the
// parent's spoke, over every multi-child fan; null when nothing fans.
function medianFanAngle(nodes, edges, centres) {
  const { children } = buildForest(nodes, edges);
  const alphas = [];
  children.forEach((kids, pid) => {
    if (kids.length < 2) return;
    const p = centres.get(pid);
    if (!p) return;
    const spoke = Math.atan2(p.cy, p.cx); // spokes radiate from the origin
    kids.forEach((kid) => {
      const c = centres.get(kid);
      if (!c) return;
      const chord = Math.atan2(c.cy - p.cy, c.cx - p.cx);
      const a = Math.abs(((chord - spoke + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);
      if (a > 0.01 && a < Math.PI / 2) alphas.push(a);
    });
  });
  if (!alphas.length) return null;
  alphas.sort((x, y) => x - y);
  return alphas[Math.floor(alphas.length / 2)];
}

// nodes: [{id, width, height}], edges: [{source, target}].
// The merge bow for the fan angles this dataset produces at these settings,
// on the slider step; null when the graph has no fans to merge.
export function bowScaleFor(nodes, edges, { nodesep, ranksep, startAngle = 0 }) {
  const centres = radialLayout(nodes, edges, { startAngle, nodesep, ranksep });
  const alpha = medianFanAngle(nodes, edges, centres);
  if (alpha === null) return null;
  const bow = BOW_MERGE * (1 + Math.cos(alpha)) / Math.cos(alpha);
  return Math.round(Math.min(3, Math.max(1, bow)) * 20) / 20;
}
