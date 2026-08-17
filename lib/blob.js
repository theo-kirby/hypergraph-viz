// ===========================================================================
// Organic outlines around a set of shapes: the geometry behind a hyperedge.
// Ported from ../excaligraph/src/geometry/blob.ts (types stripped, centerOf
// inlined; the math is untouched).
//
// A hyperedge joins any number of nodes at once, so an arrow will not do. We
// draw a filled blob that contains every member instead, which is how set
// membership is normally shown on a graph (the "bubble set" idea).
//
// The blob is not a hull. A hull of three far-apart nodes swallows everything
// in between, member or not. We build a distance field instead:
//
//   1. every member shape contributes its own signed distance, pushed outward
//      by `padding`;
//   2. a band of half-width `corridor` runs along a minimum spanning tree of
//      the member centres, so far-apart members stay one connected blob;
//   3. the pieces are joined with a *smooth* minimum, so where two members are
//      close the boundary bulges out into one shape instead of showing a seam;
//   4. every non-member shape is subtracted, so the boundary bends around a
//      node that happens to sit in the way.
//
// Then we take the zero contour with marching squares, simplify it, and cut its
// corners with arcs if `cornerRadius` asks for it. The result is closed loops
// of absolute [x, y] points.
//
// Everything here is plain arithmetic on a fixed grid, so the same input always
// gives the same points, down to the last bit.
//
// Shapes are {shape: "rectangle"|"ellipse"|"diamond", box: {x, y, width, height}}.
// Request: {members, avoid?, padding, corridor, smoothing, clearance,
//           resolution, tolerance, maxPoints, cornerRadius?}
// ===========================================================================

const centerOf = (box) => [box.x + box.width / 2, box.y + box.height / 2];

/**
 * Upper bound on grid samples per blob. A blob whose members are spread far
 * apart would otherwise ask for a grid big enough to stall the build, so we
 * coarsen the resolution to fit instead. Kept tight: the traced loop is
 * simplified to maxPoints (≈96) and filleted afterwards, so extra samples
 * only burn main-thread time — this budget bounds a blob to a few tens of ms
 * however far the layout spreads.
 */
const MAX_SAMPLES = 36_000;

/** Coordinates are rounded to this many decimals before we emit them. */
const COORD_DECIMALS = 2;

// ---------------------------------------------------------------------------
// Signed distance functions
//
// Each returns 0 on the outline, negative inside and positive outside, in px.
// Subtracting a constant from one of these grows the shape by that much and
// rounds its corners, which is exactly what `padding` should do.
// ---------------------------------------------------------------------------

function sdRectangle(px, py, box) {
  const [cx, cy] = centerOf(box);
  const dx = Math.abs(px - cx) - box.width / 2;
  const dy = Math.abs(py - cy) - box.height / 2;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside;
}

/**
 * Exact for a circle. For a stretched ellipse it reads a little short along the
 * long axis, which errs toward a tighter blob, never a looser one.
 */
function sdEllipse(px, py, box) {
  const [cx, cy] = centerOf(box);
  const hw = Math.max(box.width / 2, 1e-6);
  const hh = Math.max(box.height / 2, 1e-6);
  const normalized = Math.hypot((px - cx) / hw, (py - cy) / hh);
  return (normalized - 1) * Math.min(hw, hh);
}

/** Distance to the plane of the nearest edge. Exact away from the four tips. */
function sdDiamond(px, py, box) {
  const [cx, cy] = centerOf(box);
  const hw = Math.max(box.width / 2, 1e-6);
  const hh = Math.max(box.height / 2, 1e-6);
  const normalized = Math.abs(px - cx) / hw + Math.abs(py - cy) / hh - 1;
  return normalized * ((hw * hh) / Math.hypot(hw, hh));
}

function sdShape(shape, px, py) {
  switch (shape.shape) {
    case "ellipse":
      return sdEllipse(px, py, shape.box);
    case "diamond":
      return sdDiamond(px, py, shape.box);
    default:
      return sdRectangle(px, py, shape.box);
  }
}

/** Distance to a line segment. The corridor band is this, minus its width. */
function sdSegment(px, py, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = px - a[0];
  const wy = py - a[1];
  const lengthSquared = vx * vx + vy * vy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (wx * vx + wy * vy) / lengthSquared));
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/**
 * A minimum that rounds off the corner where two shapes meet, so their union
 * reads as one body. `k` is the width of the blend, in px.
 */
function smoothMin(a, b, k) {
  if (k <= 0) {
    return Math.min(a, b);
  }
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b * (1 - h) + a * h - k * h * (1 - h);
}

function smoothMax(a, b, k) {
  return -smoothMin(-a, -b, k);
}

// ---------------------------------------------------------------------------
// The field
// ---------------------------------------------------------------------------

/**
 * A minimum spanning tree over the member centres, as centre-to-centre
 * segments. Prim's algorithm: O(n^2), and n is the number of members.
 *
 * This is what keeps a blob in one piece. Without it, two members further
 * apart than the padding would each get their own island.
 */
function spanningSegments(centres) {
  const segments = [];
  if (centres.length < 2) {
    return segments;
  }
  const reached = [0];
  const remaining = new Set(centres.map((_, index) => index).slice(1));

  while (remaining.size > 0) {
    let bestFrom = -1;
    let bestTo = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const from of reached) {
      for (const to of remaining) {
        const a = centres[from];
        const b = centres[to];
        const distance = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestFrom = from;
          bestTo = to;
        }
      }
    }
    segments.push([centres[bestFrom], centres[bestTo]]);
    reached.push(bestTo);
    remaining.delete(bestTo);
  }

  return segments;
}

/** How many times one corridor may bend to get around what is in its way. */
const MAX_DETOURS = 3;

function boxCorners(box) {
  return [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ];
}

/** The point on segment `a`-`b` nearest to `point`. */
function closestOnSegment(point, a, b) {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const lengthSquared = vx * vx + vy * vy;
  if (lengthSquared === 0) {
    return a;
  }
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - a[0]) * vx + (point[1] - a[1]) * vy) / lengthSquared),
  );
  return [a[0] + vx * t, a[1] + vy * t];
}

/**
 * How far along `direction` a waypoint must go to leave `shape` behind: past
 * its furthest corner, plus the margin.
 */
function offsetPastShape(from, direction, shape, margin) {
  let furthest = 0;
  for (const corner of boxCorners(shape.box)) {
    furthest = Math.max(
      furthest,
      (corner[0] - from[0]) * direction[0] + (corner[1] - from[1]) * direction[1],
    );
  }
  return furthest + margin;
}

/**
 * A path from `a` to `b` that keeps `margin` away from every obstacle.
 *
 * A corridor drawn straight through a node the blob is meant to dodge gets cut
 * in half by the subtraction, and the blob falls into two pieces. So we bend it
 * instead: take the obstacle it passes closest to, step sideways past that
 * obstacle's furthest corner on whichever side is nearer, and route through
 * that waypoint. Each half is then checked again, up to MAX_DETOURS.
 */
function routeCorridor(a, b, obstacles, margin, depth = 0) {
  if (depth >= MAX_DETOURS || obstacles.length === 0) {
    return [a, b];
  }

  let blocker = null;
  let blockedAt = a;
  let leastSlack = 0;
  for (const shape of obstacles) {
    const near = closestOnSegment(centerOf(shape.box), a, b);
    const slack = sdShape(shape, near[0], near[1]) - margin;
    if (slack < leastSlack) {
      leastSlack = slack;
      blocker = shape;
      blockedAt = near;
    }
  }
  if (!blocker) {
    return [a, b];
  }

  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const sideways = [-dy / length, dx / length];
  const other = [dy / length, -dx / length];
  const forward = offsetPastShape(blockedAt, sideways, blocker, margin);
  const backward = offsetPastShape(blockedAt, other, blocker, margin);
  const [direction, offset] =
    forward <= backward ? [sideways, forward] : [other, backward];
  const waypoint = [
    blockedAt[0] + direction[0] * offset,
    blockedAt[1] + direction[1] * offset,
  ];

  const first = routeCorridor(a, waypoint, obstacles, margin, depth + 1);
  const second = routeCorridor(waypoint, b, obstacles, margin, depth + 1);
  return [...first.slice(0, -1), ...second];
}

/** The bands that hold the blob together, already bent around any obstacle. */
function corridorSegments(members, obstacles, margin) {
  const segments = [];
  const centres = members.map((member) => centerOf(member.box));
  for (const [from, to] of spanningSegments(centres)) {
    const path = routeCorridor(from, to, obstacles, margin);
    for (let i = 0; i < path.length - 1; i++) {
      segments.push([path[i], path[i + 1]]);
    }
  }
  return segments;
}

/** The scalar field whose zero contour is the blob boundary. */
function makeField(request, avoid, links) {
  const { members, padding, corridor, smoothing, clearance } = request;
  // Subtraction uses a tighter blend than the union: too soft and an avoided
  // node dents the boundary from much further away than its clearance.
  const cutSmoothing = smoothing / 2;

  const [first, ...rest] = members;

  return (px, py) => {
    // Seeded with the first member, not with infinity: a smooth minimum blends
    // its two arguments, and infinity would poison the blend.
    let distance = sdShape(first, px, py) - padding;
    for (const member of rest) {
      distance = smoothMin(distance, sdShape(member, px, py) - padding, smoothing);
    }
    for (const [a, b] of links) {
      distance = smoothMin(distance, sdSegment(px, py, a, b) - corridor, smoothing);
    }
    for (const shape of avoid) {
      distance = smoothMax(
        distance,
        -(sdShape(shape, px, py) - clearance),
        cutSmoothing,
      );
    }
    return distance;
  };
}

// ---------------------------------------------------------------------------
// Marching squares
// ---------------------------------------------------------------------------

/**
 * Traces the zero contour of `field` over a grid and returns closed loops in
 * absolute coordinates.
 *
 * Each contour point sits on one grid edge, and we name it by that edge
 * (`h3,7` or `v3,7`) rather than by its coordinates. Two neighbouring cells
 * then agree on the point exactly, with no floating-point comparison anywhere,
 * so joining the segments into loops is bookkeeping rather than guesswork.
 */
function traceContour(field, bounds, resolution) {
  const columns = Math.max(2, Math.ceil((bounds.maxX - bounds.minX) / resolution) + 1);
  const rows = Math.max(2, Math.ceil((bounds.maxY - bounds.minY) / resolution) + 1);

  const values = new Float64Array(columns * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < columns; i++) {
      values[j * columns + i] = field(
        bounds.minX + i * resolution,
        bounds.minY + j * resolution,
      );
    }
  }

  const at = (i, j) => values[j * columns + i];
  const isInside = (i, j) => at(i, j) < 0;

  /** Where the contour crosses the horizontal edge from (i, j) to (i + 1, j). */
  const crossHorizontal = (i, j) => {
    const v0 = at(i, j);
    const v1 = at(i + 1, j);
    const t = v0 === v1 ? 0.5 : v0 / (v0 - v1);
    return [bounds.minX + (i + t) * resolution, bounds.minY + j * resolution];
  };

  /** Where the contour crosses the vertical edge from (i, j) to (i, j + 1). */
  const crossVertical = (i, j) => {
    const v0 = at(i, j);
    const v1 = at(i, j + 1);
    const t = v0 === v1 ? 0.5 : v0 / (v0 - v1);
    return [bounds.minX + i * resolution, bounds.minY + (j + t) * resolution];
  };

  const points = new Map();
  const segments = [];
  const link = (a, pointA, b, pointB) => {
    points.set(a, pointA);
    points.set(b, pointB);
    segments.push({ a, b });
  };

  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < columns - 1; i++) {
      // Corners, clockwise from the top left.
      const code =
        (isInside(i, j) ? 1 : 0) |
        (isInside(i + 1, j) ? 2 : 0) |
        (isInside(i + 1, j + 1) ? 4 : 0) |
        (isInside(i, j + 1) ? 8 : 0);
      if (code === 0 || code === 15) {
        continue;
      }

      const topId = `h${i},${j}`;
      const bottomId = `h${i},${j + 1}`;
      const leftId = `v${i},${j}`;
      const rightId = `v${i + 1},${j}`;
      const top = () => crossHorizontal(i, j);
      const bottom = () => crossHorizontal(i, j + 1);
      const left = () => crossVertical(i, j);
      const right = () => crossVertical(i + 1, j);

      switch (code) {
        case 1:
        case 14:
          link(topId, top(), leftId, left());
          break;
        case 2:
        case 13:
          link(topId, top(), rightId, right());
          break;
        case 3:
        case 12:
          link(leftId, left(), rightId, right());
          break;
        case 4:
        case 11:
          link(rightId, right(), bottomId, bottom());
          break;
        case 6:
        case 9:
          link(topId, top(), bottomId, bottom());
          break;
        case 7:
        case 8:
          link(leftId, left(), bottomId, bottom());
          break;
        // The two ambiguous cases: opposite corners are inside, and the cell
        // could be read as one waist or two separate corners. The centre value
        // decides, which is the standard fix and keeps the contour closed.
        case 5:
        case 10: {
          const centre =
            (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4;
          const joinedDiagonally = centre < 0 ? code === 5 : code === 10;
          if (joinedDiagonally) {
            link(topId, top(), rightId, right());
            link(leftId, left(), bottomId, bottom());
          } else {
            link(topId, top(), leftId, left());
            link(rightId, right(), bottomId, bottom());
          }
          break;
        }
      }
    }
  }

  // Every contour point lies on one grid edge, and that edge is shared by two
  // cells, so exactly two segments meet there. Walking from any segment
  // therefore traces a whole loop.
  const adjacency = new Map();
  segments.forEach((segment, index) => {
    for (const id of [segment.a, segment.b]) {
      const list = adjacency.get(id);
      if (list) {
        list.push(index);
      } else {
        adjacency.set(id, [index]);
      }
    }
  });

  const used = new Set();
  const loops = [];
  for (let start = 0; start < segments.length; start++) {
    if (used.has(start)) {
      continue;
    }
    const ids = [segments[start].a];
    let current = start;
    let currentId = segments[start].a;
    while (true) {
      used.add(current);
      const segment = segments[current];
      const nextId = segment.a === currentId ? segment.b : segment.a;
      if (nextId === ids[0]) {
        break;
      }
      ids.push(nextId);
      const next = (adjacency.get(nextId) ?? []).find((index) => !used.has(index));
      if (next === undefined) {
        // Only reachable if the contour ran off the grid, which the margin in
        // `blobOutline` prevents. Keep what we traced rather than throwing.
        break;
      }
      current = next;
      currentId = nextId;
    }
    if (ids.length >= 3) {
      loops.push(ids.map((id) => points.get(id)));
    }
  }

  return loops;
}

// ---------------------------------------------------------------------------
// Simplification
// ---------------------------------------------------------------------------

function perpendicularDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]);
  }
  return Math.abs(dx * (a[1] - point[1]) - dy * (a[0] - point[0])) / length;
}

/** Ramer-Douglas-Peucker, iterative so a long contour cannot blow the stack. */
function douglasPeucker(points, tolerance) {
  if (points.length < 3) {
    return [...points];
  }
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length > 0) {
    const [first, last] = stack.pop();
    let worst = -1;
    let worstDistance = tolerance;
    for (let i = first + 1; i < last; i++) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = i;
      }
    }
    if (worst !== -1) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }

  return points.filter((_, index) => keep[index] === 1);
}

function signedArea(loop) {
  let sum = 0;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    sum += (loop[j][0] - loop[i][0]) * (loop[j][1] + loop[i][1]);
  }
  return sum / 2;
}

function containsPoint(loop, point) {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const [xi, yi] = loop[i];
    const [xj, yj] = loop[j];
    if (
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Rotates a loop to start at its leftmost point, breaking ties on y.
 *
 * The tracing order depends on which cell the walk happened to start in, and
 * that decides which points simplification keeps. Anchoring the start to a
 * geometric feature makes the output depend on the shape alone.
 */
function rotateToExtreme(loop) {
  let best = 0;
  for (let i = 1; i < loop.length; i++) {
    const candidate = loop[i];
    const current = loop[best];
    if (
      candidate[0] < current[0] ||
      (candidate[0] === current[0] && candidate[1] < current[1])
    ) {
      best = i;
    }
  }
  return [...loop.slice(best), ...loop.slice(0, best)];
}

function round(value) {
  const scale = 10 ** COORD_DECIMALS;
  return Math.round(value * scale) / scale;
}

/**
 * Corners that turn less than this are left alone, in radians (15 degrees).
 *
 * This is what keeps the point count sane. A contour traced at the default
 * resolution turns only a few degrees per point and is already smooth, so
 * almost nothing is filleted and the outline comes out as it went in. What does
 * get cut is the real corners a coarse trace leaves behind.
 */
const MIN_FILLET_TURN = (15 * Math.PI) / 180;

/** Roughly how far apart the points along one fillet arc are, in px. */
const FILLET_ARC_STEP = 5;

/** Cap on the points one fillet arc may add, so a big radius stays cheap. */
const MAX_FILLET_SAMPLES = 10;

/**
 * Rounds the corners of a closed loop with arcs of at most `radius`.
 * Corners that barely turn are left alone.
 *
 * Per vertex `v`, between `p` and `n`: the arc is tangent to both edges, so it
 * meets `v -> p` and `v -> n` a tangent length `t` back from the corner, and its
 * centre sits on the bisector. `t` is clamped to half of each adjacent edge, so
 * two fillets on one edge can never cross.
 */
function filletCorners(loop, radius) {
  if (radius <= 0 || loop.length < 3) {
    return [...loop];
  }

  const out = [];
  const count = loop.length;
  for (let i = 0; i < count; i++) {
    const v = loop[i];
    const p = loop[(i + count - 1) % count];
    const n = loop[(i + 1) % count];

    const lengthA = Math.hypot(p[0] - v[0], p[1] - v[1]);
    const lengthB = Math.hypot(n[0] - v[0], n[1] - v[1]);
    if (lengthA === 0 || lengthB === 0) {
      out.push(v);
      continue;
    }
    const ax = (p[0] - v[0]) / lengthA;
    const ay = (p[1] - v[1]) / lengthA;
    const bx = (n[0] - v[0]) / lengthB;
    const by = (n[1] - v[1]) / lengthB;

    // The interior angle at the corner. A straight run through `v` gives pi,
    // and the path turns by pi minus that.
    const interior = Math.acos(Math.max(-1, Math.min(1, ax * bx + ay * by)));
    if (Math.PI - interior < MIN_FILLET_TURN) {
      out.push(v);
      continue;
    }

    const half = interior / 2;
    const tangentOfHalf = Math.tan(half);
    const sineOfHalf = Math.sin(half);
    if (tangentOfHalf <= 0 || sineOfHalf <= 0) {
      out.push(v);
      continue;
    }
    const t = Math.min(radius / tangentOfHalf, lengthA / 2, lengthB / 2);
    // The radius we actually get, once the short edges have had their say.
    const r = t * tangentOfHalf;

    const start = [v[0] + ax * t, v[1] + ay * t];
    const end = [v[0] + bx * t, v[1] + by * t];
    const bisectorLength = Math.hypot(ax + bx, ay + by);
    if (bisectorLength === 0) {
      // The two edges double back on each other: there is no corner to cut.
      out.push(v);
      continue;
    }
    const centre = [
      v[0] + ((ax + bx) / bisectorLength) * (r / sineOfHalf),
      v[1] + ((ay + by) / bisectorLength) * (r / sineOfHalf),
    ];

    const from = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
    const to = Math.atan2(end[1] - centre[1], end[0] - centre[0]);
    // The short way round: the arc spans the turn, which is under pi.
    let sweep = to - from;
    while (sweep > Math.PI) {
      sweep -= 2 * Math.PI;
    }
    while (sweep < -Math.PI) {
      sweep += 2 * Math.PI;
    }

    const steps = Math.max(
      1,
      Math.min(MAX_FILLET_SAMPLES, Math.ceil((Math.abs(sweep) * r) / FILLET_ARC_STEP)),
    );
    for (let step = 0; step <= steps; step++) {
      const angle = from + (sweep * step) / steps;
      out.push([centre[0] + Math.cos(angle) * r, centre[1] + Math.sin(angle) * r]);
    }
  }

  return out;
}

/**
 * Simplifies one closed loop, rounds its corners and closes it explicitly: the
 * last point repeats the first.
 *
 * The order is simplify, coarsen, fillet. So `maxPoints` counts the traced
 * outline, before corner rounding: a fillet may take the loop back over the
 * cap, which is the price of a corner that is actually round.
 */
function finishLoop(loop, tolerance, maxPoints, cornerRadius) {
  const anchored = rotateToExtreme(loop);
  // Simplify as an open path from the anchor back to itself, so the anchor is
  // never the point that gets dropped.
  const open = [...anchored, anchored[0]];

  let simplified = douglasPeucker(open, tolerance);
  // Coarsen rather than emit a loop with hundreds of points: past a point the
  // extra points only add noise.
  let attempt = tolerance;
  while (simplified.length > maxPoints && attempt < 512) {
    attempt *= 1.6;
    simplified = douglasPeucker(open, attempt);
  }

  // `simplified` repeats the anchor at both ends, because it was simplified as
  // an open path. The fillet wants the loop itself, so drop the copy; the
  // closing step below puts one back.
  const closed = simplified.slice(0, -1);
  const shaped = filletCorners(closed, cornerRadius);

  const rounded = shaped.map(([x, y]) => [round(x), round(y)]);
  // Rounding is applied to both copies of the anchor, so they stay identical.
  const last = rounded[rounded.length - 1];
  const first = rounded[0];
  if (last[0] !== first[0] || last[1] !== first[1]) {
    rounded.push([first[0], first[1]]);
  }
  return rounded;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Sorts shapes by position, left to right and then top to bottom.
 *
 * A smooth minimum is not associative, so folding the members in a different
 * order would move the boundary by a fraction of a pixel. A hyperedge is a
 * *set* of nodes, and its blob should not change shape because you listed them
 * differently, so we put them in a canonical order first.
 */
function sortShapes(shapes) {
  return [...shapes].sort(
    (a, b) =>
      a.box.x - b.box.x ||
      a.box.y - b.box.y ||
      a.box.width - b.box.width ||
      a.box.height - b.box.height,
  );
}

/**
 * Closed outlines for a blob around `members`, in absolute coordinates and
 * largest first. Each loop starts and ends on the same point.
 *
 * Normally there is exactly one loop. There can be more when an avoided node
 * cuts a blob in two. Loops that lie *inside* another loop are dropped: they
 * are holes, we cannot draw a hole in a filled shape, and the node that made
 * the hole is drawn on top of the blob anyway.
 */
export function blobOutline(request) {
  if (request.members.length === 0) {
    return [];
  }

  const members = sortShapes(request.members);
  const obstacles = sortShapes(request.avoid ?? []);
  // Routed before the grid is sized, because a corridor that bends around an
  // obstacle can leave the members' own bounding box.
  const links = corridorSegments(
    members,
    obstacles,
    request.clearance + request.corridor,
  );

  // The field is positive everywhere outside this margin, which keeps the
  // contour off the edge of the grid and so keeps every loop closed.
  const margin =
    request.padding + request.corridor + request.smoothing + request.resolution * 3;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const { box } of members) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.width);
    maxY = Math.max(maxY, box.y + box.height);
  }
  for (const [x, y] of links.flat()) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const bounds = {
    minX: minX - margin,
    minY: minY - margin,
    maxX: maxX + margin,
    maxY: maxY + margin,
  };

  // Only shapes that reach into the grid can bend the boundary. Dropping the
  // rest changes nothing about the result: their influence there is zero.
  const reach = request.clearance + request.smoothing;
  const avoid = obstacles.filter(
    ({ box }) =>
      box.x - reach <= bounds.maxX &&
      box.x + box.width + reach >= bounds.minX &&
      box.y - reach <= bounds.maxY &&
      box.y + box.height + reach >= bounds.minY,
  );

  let resolution = Math.max(request.resolution, 0.5);
  const samples =
    ((bounds.maxX - bounds.minX) / resolution + 1) *
    ((bounds.maxY - bounds.minY) / resolution + 1);
  if (samples > MAX_SAMPLES) {
    resolution *= Math.sqrt(samples / MAX_SAMPLES);
  }

  const field = makeField({ ...request, members }, avoid, links);
  const loops = traceContour(field, bounds, resolution);

  // Even-odd nesting: a loop inside an odd number of others is a hole.
  const outer = loops.filter((loop, index) => {
    const probe = loop[0];
    let depth = 0;
    for (let other = 0; other < loops.length; other++) {
      if (other !== index && containsPoint(loops[other], probe)) {
        depth++;
      }
    }
    return depth % 2 === 0;
  });

  return outer
    .map((loop) =>
      finishLoop(loop, request.tolerance, request.maxPoints, request.cornerRadius ?? 0),
    )
    .filter((loop) => loop.length >= 4)
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
}
