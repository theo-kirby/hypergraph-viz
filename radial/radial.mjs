#!/usr/bin/env node
// Equal-split radial graph -> .excalidraw + .svg (one-off script).
//
// Usage: node radial.mjs <data.json>
// Writes <data>.excalidraw and <data>.svg next to the input file.
//
// Radial rule: the n rank-1 nodes split the full circle equally
// (1 -> straight right, 2 -> 180deg, 3 -> 120deg, 4 -> cross).
// Deeper nodes fan out centered on the parent's spoke, so a
// single-branch tree collapses into a straight line.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { Graph, layoutText, DEFAULT_FONT_FAMILY } from "../../excaligraph/dist/index.js";

const EXCALIGRAPH_CLI = "/Users/theo/excaligraph/dist/cli/index.js";
const FONT_SIZE = 16;
const MIN_DIAMETER = 100;
const LABEL_PADDING = 24;

// ---- parse ----------------------------------------------------------------

const inputPath = process.argv[2];
if (!inputPath) {
  console.error("Usage: node radial.mjs <data.json>");
  process.exit(1);
}
const data = JSON.parse(readFileSync(inputPath, "utf8"));
const nodes = data.nodes ?? {};
const edges = data.edges ?? [];
const { nodesep = 60, ranksep = 150, startAngle = 0 } = data.layout ?? {};

const children = new Map(Object.keys(nodes).map((id) => [id, []]));
const parent = new Map();
for (const [from, to] of edges) {
  if (!children.has(from)) throw new Error(`Edge from unknown node "${from}"`);
  if (!children.has(to)) throw new Error(`Edge to unknown node "${to}"`);
  if (parent.has(to)) throw new Error(`Node "${to}" has two parents`);
  parent.set(to, from);
  children.get(from).push(to);
}

const roots = Object.keys(nodes).filter((id) => !parent.has(id));
if (roots.length !== 1) {
  throw new Error(`Expected exactly one root, found ${roots.length}: ${roots.join(", ")}`);
}
const root = roots[0];

// cycle check: every node must reach the root
for (const id of Object.keys(nodes)) {
  const seen = new Set();
  for (let cur = id; cur !== root; cur = parent.get(cur)) {
    if (seen.has(cur)) throw new Error(`Cycle detected at "${cur}"`);
    seen.add(cur);
  }
}

// ---- measure --------------------------------------------------------------

// Sizes must exist before layout: sibling spacing depends on diameters.
const diameter = new Map();
for (const [id, label] of Object.entries(nodes)) {
  const text = layoutText(String(label), FONT_SIZE, DEFAULT_FONT_FAMILY, 10000);
  const d = Math.max(MIN_DIAMETER, Math.ceil(Math.SQRT2 * text.width) + LABEL_PADDING);
  diameter.set(id, d);
}

// ---- layout ---------------------------------------------------------------

const pos = new Map(); // id -> center {x, y}
const angle = new Map(); // id -> theta (spoke direction from the root)
pos.set(root, { x: 0, y: 0 });

// place(node) at polar (depth * ranksep, theta); it owns `wedge` radians.
function place(id, depth, theta, wedge) {
  const r = depth * ranksep;
  pos.set(id, { x: r * Math.cos(theta), y: r * Math.sin(theta) });
  angle.set(id, theta);

  const kids = children.get(id);
  const m = kids.length;
  if (m === 0) return;

  const rChild = (depth + 1) * ranksep;
  const maxChildDiameter = Math.max(...kids.map((k) => diameter.get(k)));
  // Desired angular spacing from nodesep (arc length on the child ring),
  // clamped to the owned wedge. On a crowded branch the wedge clamp wins
  // and siblings sit closer than nodesep; the fix is a larger ranksep.
  const delta = Math.min((maxChildDiameter + nodesep) / rChild, wedge / m);
  kids.forEach((kid, i) => {
    // fan centered on the parent's spoke; a single child continues straight
    place(kid, depth + 1, theta + (i - (m - 1) / 2) * delta, wedge / m);
  });
}

const rank1 = children.get(root);
const start = (startAngle * Math.PI) / 180;
rank1.forEach((id, i) => {
  place(id, 1, start + (i * 2 * Math.PI) / rank1.length, (2 * Math.PI) / rank1.length);
});

// ---- emit .excalidraw -----------------------------------------------------

const stem = basename(inputPath).replace(/\.json$/, "");
const g = new Graph({
  seed: stem,
  defaults: {
    node: { shape: "ellipse", fontSize: FONT_SIZE },
    edge: { routing: "straight", endArrowhead: "triangle_outline" },
  },
});

for (const [id, label] of Object.entries(nodes)) {
  const d = diameter.get(id);
  const { x, y } = pos.get(id);
  g.node(id, { label: String(label), x: x - d / 2, y: y - d / 2, width: d, height: d });
}

// Each parent-to-child edge leaves the parent tangent to the branch's spoke
// (the ray from the root through the parent), then curves to the child. For a
// circular arc whose tangent at the start makes angle alpha with the chord,
// the sagitta is (L/2) * tan(alpha/2); the library bows the midpoint along
// the travel normal (-dy, dx), which puts positive bow on the -alpha side.
for (const [from, to] of edges) {
  const p = pos.get(from);
  const c = pos.get(to);
  const dx = c.x - p.x;
  const dy = c.y - p.y;
  const theta = angle.get(from); // undefined for the root: its edges are radial
  const alpha =
    theta === undefined
      ? 0
      : Math.atan2(Math.cos(theta) * dy - Math.sin(theta) * dx, Math.cos(theta) * dx + Math.sin(theta) * dy);
  if (Math.abs(alpha) < 1e-6) {
    g.edge(from, to);
  } else {
    const bow = (-Math.hypot(dx, dy) / 2) * Math.tan(alpha / 2);
    g.edge(from, to, { routing: "curved", bow });
  }
}

// No g.layout(): explicit x/y is honored verbatim.
const outDir = dirname(inputPath);
const excalidrawPath = join(outDir, `${stem}.excalidraw`);
await g.write(excalidrawPath);
console.log(`wrote ${excalidrawPath}`);

// ---- render SVG -----------------------------------------------------------

const svgPath = join(outDir, `${stem}.svg`);
execFileSync(process.execPath, [EXCALIGRAPH_CLI, "preview", excalidrawPath, "-o", svgPath], {
  stdio: "inherit",
});
console.log(`wrote ${svgPath}`);
