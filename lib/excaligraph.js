// ===========================================================================
// Layout engines and edge routing ported from ../excaligraph.
//  - buildForest / treeLayout / radialLayout ← src/layout/{forest,tree,radial}.ts
//  - routeEdges (branch routing, fanned starts, straight fallback)
//      ← src/graph.ts (branchStarts/branchPoints) + src/geometry/{route,shapes}.ts
// Layouts return centre positions (cx, cy). Routing works on live boxes so it
// can be re-run every animation frame while nodes are mid-flight.
// ===========================================================================

const TAU = Math.PI * 2;
const EPS = 1e-6;

// ---- forest: one spanning forest out of an arbitrary edge list -------------
export function buildForest(nodes, edges) {
  const outgoing = new Map();
  const known = new Set(nodes.map((n) => n.id));
  const reached = new Set();
  edges.forEach((e) => {
    if (e.source === e.target || !known.has(e.source) || !known.has(e.target)) return;
    reached.add(e.target);
    const targets = outgoing.get(e.source);
    if (!targets) outgoing.set(e.source, [e.target]);
    else if (!targets.includes(e.target)) targets.push(e.target);
  });

  const roots = [], children = new Map(), depth = new Map(), claimed = new Set();
  const claim = (id, level) => {
    depth.set(id, level);
    (outgoing.get(id) || []).forEach((child) => {
      if (claimed.has(child)) return;
      claimed.add(child);
      if (children.has(id)) children.get(id).push(child);
      else children.set(id, [child]);
      claim(child, level + 1);
    });
  };
  const addRoot = (id) => { roots.push(id); claimed.add(id); claim(id, 0); };
  nodes.forEach((n) => { if (!reached.has(n.id) && !claimed.has(n.id)) addRoot(n.id); });
  nodes.forEach((n) => { if (!claimed.has(n.id)) addRoot(n.id); });

  let maxDepth = -1;
  depth.forEach((level) => { maxDepth = Math.max(maxDepth, level); });
  return { roots, children, depth, maxDepth };
}

// ---- tree layout: every rank a column, each parent centred on its children -
// nodes: [{id, width, height}], edges: [{source, target}]
export function treeLayout(nodes, edges, options = {}) {
  const centres = new Map();
  if (!nodes.length) return centres;

  const nodesep = options.nodesep ?? 60;
  const ranksep = options.ranksep ?? 100;
  const direction = options.direction ?? "LR";
  const horizontal = direction === "LR" || direction === "RL";

  const forest = buildForest(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const rankSize = (id) => (horizontal ? byId.get(id).width : byId.get(id).height);
  const crossSize = (id) => (horizontal ? byId.get(id).height : byId.get(id).width);

  const rankThickness = new Array(forest.maxDepth + 1).fill(0);
  forest.depth.forEach((level, id) => { rankThickness[level] = Math.max(rankThickness[level], rankSize(id)); });
  const rankOffset = [];
  let rankCursor = 0;
  for (let level = 0; level <= forest.maxDepth; level++) { rankOffset.push(rankCursor); rankCursor += rankThickness[level] + ranksep; }
  const rankExtent = Math.max(0, rankCursor - ranksep);

  const cross = new Map();
  const nextFree = new Array(forest.maxDepth + 1).fill(0);
  const centreOf = (id) => cross.get(id) + crossSize(id) / 2;

  const shift = (id, level, delta) => {
    (forest.children.get(id) || []).forEach((child) => {
      const moved = cross.get(child) + delta;
      cross.set(child, moved);
      nextFree[level + 1] = Math.max(nextFree[level + 1], moved + crossSize(child) + nodesep);
      shift(child, level + 1, delta);
    });
  };
  const place = (id, level) => {
    const kids = forest.children.get(id) || [];
    const size = crossSize(id);
    let position;
    if (!kids.length) {
      position = nextFree[level];
    } else {
      kids.forEach((child) => place(child, level + 1));
      const first = centreOf(kids[0]), last = centreOf(kids[kids.length - 1]);
      position = (first + last) / 2 - size / 2;
      const floor = nextFree[level];
      if (position < floor) { shift(id, level, floor - position); position = floor; }
    }
    cross.set(id, position);
    nextFree[level] = position + size + nodesep;
  };
  forest.roots.forEach((root) => place(root, 0));

  nodes.forEach((n) => {
    const level = forest.depth.get(n.id);
    if (level === undefined) return;
    const along = rankOffset[level] + (rankThickness[level] - rankSize(n.id)) / 2;
    const flipped = direction === "RL" || direction === "BT" ? rankExtent - along - rankSize(n.id) : along;
    const across = cross.get(n.id);
    const x = horizontal ? flipped : across;
    const y = horizontal ? across : flipped;
    centres.set(n.id, { cx: x + n.width / 2, cy: y + n.height / 2 });
  });
  return centres;
}

// ---- radial layout: root in the middle, each rank a ring -------------------
export function radialLayout(nodes, edges, options = {}) {
  const out = new Map();
  if (!nodes.length) return out;

  const nodesep = options.nodesep ?? 60;
  const ranksep = options.ranksep ?? 100;
  const startAngle = ((options.startAngle ?? -90) * Math.PI) / 180;
  const sweepAngle = ((options.sweep ?? 360) * Math.PI) / 180;

  const forest = buildForest(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const centreId = forest.roots.length === 1 ? forest.roots[0] : null;
  const firstRing = centreId ? forest.children.get(centreId) || [] : forest.roots;

  const leafCount = new Map();
  const countLeaves = (id) => {
    if (leafCount.has(id)) return leafCount.get(id);
    const kids = forest.children.get(id) || [];
    let total = 0;
    kids.forEach((child) => { total += countLeaves(child); });
    const count = kids.length === 0 ? 1 : total;
    leafCount.set(id, count);
    return count;
  };

  const angle = new Map(), ring = new Map();
  const spread = (ids, from, span, level) => {
    let total = 0;
    ids.forEach((id) => { total += countLeaves(id); });
    if (!total) return;
    let cursor = from;
    ids.forEach((id) => {
      const share = (countLeaves(id) / total) * span;
      angle.set(id, cursor + share / 2);
      ring.set(id, level);
      spread(forest.children.get(id) || [], cursor, share, level + 1);
      cursor += share;
    });
  };
  spread(firstRing, startAngle, sweepAngle, 1);
  if (centreId) { ring.set(centreId, 0); angle.set(centreId, startAngle); }

  let deepest = 0;
  ring.forEach((level) => { deepest = Math.max(deepest, level); });
  const byRing = Array.from({ length: deepest + 1 }, () => []);
  ring.forEach((level, id) => byRing[level].push(id));
  const extent = (id) => Math.max(byId.get(id).width, byId.get(id).height);
  const ringExtent = byRing.map((ids) => ids.reduce((widest, id) => Math.max(widest, extent(id)), 0));

  // A radius per ring: stacked so rings cannot touch, spread so the tightest
  // pair of neighbours on the ring still has nodesep between them.
  const radius = [];
  for (let level = 0; level < byRing.length; level++) {
    if (level === 0) { radius.push(0); continue; }
    const stacked = radius[level - 1] + ringExtent[level - 1] / 2 + ringExtent[level] / 2 + ranksep;
    const gap = smallestGap(byRing[level].map((id) => angle.get(id)), sweepAngle);
    const chord = 2 * Math.sin(gap / 2);
    const spreadRadius = chord > EPS ? (ringExtent[level] + nodesep) / chord : 0;
    radius.push(Math.max(stacked, spreadRadius));
  }

  let minX = Infinity, minY = Infinity;
  const centres = new Map();
  nodes.forEach((n) => {
    const level = ring.get(n.id);
    if (level === undefined) return;
    const r = radius[level], theta = angle.get(n.id);
    const p = { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
    centres.set(n.id, p);
    minX = Math.min(minX, p.x - n.width / 2);
    minY = Math.min(minY, p.y - n.height / 2);
  });
  if (!isFinite(minX)) return out;
  centres.forEach((p, id) => out.set(id, { cx: p.x - minX, cy: p.y - minY }));
  return out;
}

function smallestGap(angles, sweepAngle) {
  if (angles.length < 2) return 0;
  const sorted = [...angles].sort((a, b) => a - b);
  let smallest = Infinity;
  for (let i = 1; i < sorted.length; i++) smallest = Math.min(smallest, sorted[i] - sorted[i - 1]);
  if (Math.abs(sweepAngle) >= TAU - 1e-9) smallest = Math.min(smallest, sorted[0] + TAU - sorted[sorted.length - 1]);
  return smallest > 0 && isFinite(smallest) ? smallest : 0;
}

// ---- branch routing --------------------------------------------------------
const GAP = 4;                 // px between an arrow tip and the shape
const BRANCH_RADIUS = 0;       // where the sweep begins on the run out (0..1)
const BRANCH_LEAN = 40;        // px the corner point leans across the run
const BRANCH_SPREAD = 18;      // px between the fanned starting points
const MIN_SWEEP = 0.25, MAX_SWEEP = 0.85;
const MAX_LEAN_FRACTION = 0.4;
const FAN_MARGIN = 6;

const centerOf = (box) => [box.x + box.width / 2, box.y + box.height / 2];
const headingSide = ([dx, dy]) => (Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top"));
const sideNormal = (side) => (side === "top" ? [0, -1] : side === "bottom" ? [0, 1] : side === "left" ? [-1, 0] : [1, 0]);

// The point where the ray from the box centre toward `toward` crosses the
// shape outline; used for the straight fallback.
function outlinePoint(shape, box, toward) {
  const [cx, cy] = centerOf(box);
  const dx = toward[0] - cx, dy = toward[1] - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const hw = box.width / 2, hh = box.height / 2;
  if (hw <= 0 || hh <= 0) return [cx, cy];
  let t;
  if (shape === "ellipse") t = 1 / Math.hypot(dx / hw, dy / hh);
  else {
    const tx = dx === 0 ? Infinity : hw / Math.abs(dx);
    const ty = dy === 0 ? Infinity : hh / Math.abs(dy);
    t = Math.min(tx, ty);
  }
  return [cx + dx * t, cy + dy * t];
}
function applyGap(point, from, gap) {
  if (!gap) return point;
  const dx = point[0] - from[0], dy = point[1] - from[1];
  const len = Math.hypot(dx, dy);
  if (!len) return point;
  return [point[0] + (dx / len) * gap, point[1] + (dy / len) * gap];
}
function attachmentPoint(shape, box, toward, gap = GAP) {
  return applyGap(outlinePoint(shape, box, toward), centerOf(box), gap);
}

// A branch: straight out the way the side faces, one turn, straight in.
function branchRoute(start, normal, end, radius = BRANCH_RADIUS, lean = BRANCH_LEAN) {
  const dx = end[0] - start[0], dy = end[1] - start[1];
  const along = dx * normal[0] + dy * normal[1];
  const acrossX = dx - normal[0] * along, acrossY = dy - normal[1] * along;
  const across = Math.hypot(acrossX, acrossY);
  if (across < EPS || along <= EPS) return [start, end];

  const sweep = MIN_SWEEP + (MAX_SWEEP - MIN_SWEEP) * Math.min(Math.max(radius, 0), 1);
  const turn = along * (1 - sweep);
  const off = Math.min(Math.max(lean, 0), across * MAX_LEAN_FRACTION);
  const wayX = acrossX / across, wayY = acrossY / across;
  return [
    start,
    [start[0] + normal[0] * turn, start[1] + normal[1] * turn],
    [start[0] + normal[0] * along + wayX * off, start[1] + normal[1] * along + wayY * off],
    end,
  ];
}

// The points for one branch edge leaving along `normal` (any unit vector),
// or null when a straight line is honest: target straight ahead, behind the
// way out, or sitting on the line the arrow runs out along.
function branchPointsAlong(source, target, normal, shift, opts) {
  const gap = opts.gap ?? GAP;
  const sc = centerOf(source), tc = centerOf(target);
  const out = [tc[0] - sc[0], tc[1] - sc[1]];
  const along = out[0] * normal[0] + out[1] * normal[1];
  if (along <= EPS) return null;
  const acrossX = out[0] - normal[0] * along, acrossY = out[1] - normal[1] * along;
  const across = Math.hypot(acrossX, acrossY);
  if (across < EPS) return null;
  const enter = [-acrossX / across, -acrossY / across];

  // The target has to sit clear of the line the arrow runs out along, or the
  // corner would land inside it.
  const enterTouch = outlinePoint(target.shape || "rectangle", target, [tc[0] + enter[0], tc[1] + enter[1]]);
  const clearance = Math.hypot(enterTouch[0] - tc[0], enterTouch[1] - tc[1]);
  if (across <= clearance) return null;

  // Leave where the way-out ray crosses the outline, slid `shift` px sideways
  // for the fan; enter through the outline point facing back across the run.
  const leaveTouch = outlinePoint(source.shape || "rectangle", source, [sc[0] + normal[0], sc[1] + normal[1]]);
  const perp = [-normal[1], normal[0]];
  const start = [
    leaveTouch[0] + normal[0] * gap + perp[0] * shift,
    leaveTouch[1] + normal[1] * gap + perp[1] * shift,
  ];
  const end = [enterTouch[0] + enter[0] * gap, enterTouch[1] + enter[1] * gap];
  const points = branchRoute(start, normal, end, opts.radius ?? BRANCH_RADIUS, opts.lean ?? BRANCH_LEAN);
  return points.length > 2 ? points : null;
}

// Route a whole set of edges at once. The fan of starting points needs to see
// every edge that leaves one node one way, so this is done for the set.
// edges: [{id, source, target}], boxOf(id) -> {x, y, width, height, shape}|null.
// normalFor(edge) may name the way out as a unit vector (a radial layout gives
// each node its own radial line); null/undefined falls back to the side facing
// the target, which is the tree behaviour.
// opts may override the routing constants: {gap, radius, lean, spread}.
// Returns Map edgeId -> absolute points (2 for straight, 4 for a branch).
export function routeEdges(edges, boxOf, normalFor, opts = {}) {
  const spread = opts.spread ?? BRANCH_SPREAD;
  const gap = opts.gap ?? GAP;
  const normals = new Map();
  edges.forEach((e) => {
    const s = boxOf(e.source), t = boxOf(e.target);
    if (!s || !t) return;
    let n = normalFor ? normalFor(e) : null;
    if (!n) {
      const from = centerOf(s), to = centerOf(t);
      n = sideNormal(headingSide([to[0] - from[0], to[1] - from[1]]));
    }
    normals.set(e, n);
  });

  const groups = new Map();
  normals.forEach((n, e) => {
    const key = e.source + " " + n[0].toFixed(3) + "," + n[1].toFixed(3);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  const starts = new Map();
  groups.forEach((group) => {
    if (group.length < 2) return;
    const n = normals.get(group[0]);
    const box = boxOf(group[0].source);
    const c = centerOf(box);
    const perp = [-n[1], n[0]];
    // Order the fan the same way the targets sit across the way out, so no
    // two arrows cross.
    const across = (e) => { const to = centerOf(boxOf(e.target)); return perp[0] * to[0] + perp[1] * to[1]; };
    const ordered = [...group].sort((a, b) => across(a) - across(b));
    // Room along the outline, measured perpendicular to the way out.
    const po = outlinePoint(box.shape || "rectangle", box, [c[0] + perp[0], c[1] + perp[1]]);
    const room = Math.max(2 * Math.hypot(po[0] - c[0], po[1] - c[1]) - 2 * FAN_MARGIN, 0);
    const step = Math.min(spread, room / (ordered.length - 1));
    ordered.forEach((e, i) => starts.set(e, (i - (ordered.length - 1) / 2) * step));
  });

  const routes = new Map();
  edges.forEach((e) => {
    const s = boxOf(e.source), t = boxOf(e.target);
    if (!s || !t) return;
    const branch = branchPointsAlong(s, t, normals.get(e), starts.get(e) || 0, opts);
    if (branch) { routes.set(e.id, branch); return; }
    const sc = centerOf(s), tc = centerOf(t);
    routes.set(e.id, [
      attachmentPoint(s.shape || "rectangle", s, tc, gap),
      attachmentPoint(t.shape || "rectangle", t, sc, gap),
    ]);
  });
  return routes;
}

// An SVG path through the points. Multi-point routes get a Catmull-Rom spline
// through every point — the rounded look Excalidraw gives a multi-point arrow.
export function roundedPathD(points) {
  if (points.length < 2) return "";
  const f = (v) => v.toFixed(1);
  if (points.length === 2) {
    return `M ${f(points[0][0])} ${f(points[0][1])} L ${f(points[1][0])} ${f(points[1][1])}`;
  }
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i];
    const p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${f(c1[0])} ${f(c1[1])}, ${f(c2[0])} ${f(c2[1])}, ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}
