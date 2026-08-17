// ===========================================================================
// One blank canvas, one research programme, two graphs of it. The RECORD
// graph is what happened over time: a question, branching lines of inquiry,
// experiments that succeeded or failed. The STATE graph is what the system
// knows now. The bridge between them: every outer node of the state graph is
// a hyperedge over the record — the set of events that produced that piece
// of state. So you can read the record, read the state, or read them
// together: blobs/hubs overlay the state onto the record, and focusing one
// shows that state node as a radial graph of record events.
// Click a node with children to fold its subtree; drag to pan, scroll to
// zoom, double-click the background to re-fit.
// ===========================================================================

import { treeLayout, radialLayout } from "./lib/excaligraph.js";
import { createViewer } from "./lib/viewer.js";
import { createPanel, applyArrow } from "./lib/panel.js";
import { createBlobLayer } from "./lib/hyper.js";
import { viewToSvg, downloadSvg } from "./lib/export.js";

const FONT = 13;

// ---- datasets --------------------------------------------------------------
function makeData(edgePairs, labels) {
  const order = [];
  edgePairs.forEach(([a, b]) => [a, b].forEach((id) => { if (!order.includes(id)) order.push(id); }));
  const parent = new Map();
  edgePairs.forEach(([a, b]) => { if (!parent.has(b)) parent.set(b, a); });
  const children = new Map();
  edgePairs.forEach(([a, b]) => {
    if (!children.has(a)) children.set(a, []);
    children.get(a).push(b);
  });
  const roots = order.filter((id) => !parent.has(id));
  const rankOf = (id) => { let r = 0; for (let at = parent.get(id); at !== undefined; at = parent.get(at)) r++; return r; };
  const descendants = (id) => (children.get(id) || []).flatMap((c) => [c, ...descendants(c)]);
  return { order, parent, children, roots, rankOf, descendants, edgePairs, labels };
}

// ---- the research example --------------------------------------------------
// Demo topic: engineering a PET-degrading enzyme to work faster.
//
// The aspects of the current state, keyed by state-node id. Each one lists
// the record events that produced it — that list is its hyperedge on the
// record graph. Shared events (proto1, asyA, asyB feeding two aspects) are
// how the aspects overlap and cut across record branches.
const ASPECTS = {
  mutantA:   { label: "Mutant A",  hue: "#e64980", fill: "#ffdeeb", members: ["mutA", "asyA", "proto1"] },
  stability: { label: "Stability", hue: "#12b886", fill: "#c3fae8", members: ["asyB", "scan", "bridge", "asyC"] },
  mechanism: { label: "Mechanism", hue: "#f59f00", fill: "#ffec99", members: ["lit", "h1", "asyA"] },
  assay:     { label: "Assay rig", hue: "#4263eb", fill: "#dbe4ff", members: ["rig", "proto1", "proto2"] },
};

// The record: the progression over time, left to right. No final result yet —
// the frontier is just the latest events on each line of inquiry.
const RECORD_DATA = makeData([
  ["q0", "lit"], ["q0", "rig"],
  ["lit", "h1"], ["lit", "h2"],
  ["h1", "mutA"], ["h1", "mutB"],
  ["mutA", "asyA"],
  ["mutB", "asyB"],
  ["h2", "scan"],
  ["scan", "bridge"],
  ["bridge", "asyC"],
  ["rig", "proto1"],
  ["proto1", "proto2"],
], {
  q0: "Faster PET enzyme?", lit: "Literature survey", rig: "Assay pipeline",
  h1: "H1: active site", h2: "H2: stability limit",
  mutA: "Design mutant A", mutB: "Design mutant B",
  asyA: "Assay: 2× rate ✓", asyB: "Assay: unstable ✗",
  scan: "Melting scan", bridge: "Disulfide bridge", asyC: "Assay: +8 °C ✓",
  proto1: "Protocol v1", proto2: "Protocol v2 (auto)",
});

// The state: what the project has now, in tiers. The outer ring is exactly
// the ASPECTS table — those nodes ARE the hyperedges on the record.
const STATE_DATA = makeData([
  ["now", "design"], ["now", "knowledge"], ["now", "methods"],
  ["design", "mutantA"], ["design", "stability"],
  ["knowledge", "mechanism"],
  ["methods", "assay"],
], {
  now: "Current state", design: "Enzyme design", knowledge: "Knowledge", methods: "Methods",
  mutantA: ASPECTS.mutantA.label, stability: ASPECTS.stability.label,
  mechanism: ASPECTS.mechanism.label, assay: ASPECTS.assay.label,
});

// ---- shared panel rows ------------------------------------------------------
const SHARED_ROWS = [
  { title: "Nodes", rows: [
    { key: "shape", label: "shape", type: "segment", options: [{ value: "rectangle", label: "Rect" }, { value: "circle", label: "Circle" }] },
    { key: "nodeScale", label: "scale", type: "range", min: 0.6, max: 1.6, step: 0.05 },
  ] },
  { title: "Edges", rows: [
    { key: "radius", label: "radius", type: "range", min: 0, max: 1, step: 0.01 },
    { key: "lean", label: "lean", type: "range", min: 0, max: 120 },
    { key: "spread", label: "spread", type: "range", min: 0, max: 48 },
    { key: "gap", label: "gap", type: "range", min: 0, max: 20 },
    { key: "edgeWidth", label: "width", type: "range", min: 0.5, max: 4, step: 0.1 },
  ] },
  { title: "Arrowhead", rows: [
    { key: "arrowSize", label: "size", type: "range", min: 4, max: 28 },
    { key: "arrowHollow", label: "hollow", type: "check" },
  ] },
  { title: "Motion", rows: [
    { key: "durMs", label: "duration", type: "range", min: 100, max: 1400, step: 20 },
  ] },
];

// ---- modes -----------------------------------------------------------------
const RECORD = {
  key: "record",
  data: RECORD_DATA,
  folded: new Set(),
  settings: {
    direction: "LR", nodesep: 80, ranksep: 160,
    shape: "rectangle", nodeScale: 1,
    radius: 0.16, lean: 120, spread: 36, gap: 0,
    edgeWidth: 3, arrowSize: 28, arrowHollow: true,
    durMs: 100,
    hyperView: "blobs", blobPadding: 22, blobCorridor: 14, blobSmoothing: 26,
    blobOpacity: 0.35, blobLabels: true, focusKids: true,
  },
  layoutRows: [
    { key: "direction", label: "direction", type: "segment", options: [{ value: "LR", label: "LR" }, { value: "TB", label: "TB" }] },
    { key: "nodesep", label: "nodesep", type: "range", min: 10, max: 200 },
    { key: "ranksep", label: "ranksep", type: "range", min: 40, max: 340 },
  ],
  // The hyperedges on the record are the outer state-graph nodes: each aspect
  // of the current state, as the set of record events that produced it.
  hyper: Object.entries(ASPECTS).map(([sid, a]) => ({
    id: "hy:" + sid, label: a.label, hue: a.hue, fill: a.fill, members: a.members,
  })),
  hyperRows: [
    { key: "hyperView", label: "view", type: "segment", options: [
      { value: "off", label: "Off" }, { value: "blobs", label: "Blob" },
      { value: "hubs", label: "Hub" }, { value: "both", label: "Both" },
    ] },
    { key: "blobPadding", label: "padding", type: "range", min: 6, max: 60 },
    { key: "blobCorridor", label: "corridor", type: "range", min: 0, max: 40 },
    { key: "blobSmoothing", label: "smoothing", type: "range", min: 0, max: 60 },
    { key: "blobOpacity", label: "opacity", type: "range", min: 0.05, max: 0.7, step: 0.05 },
    { key: "blobLabels", label: "labels", type: "check" },
    { key: "focusKids", label: "focus kids", type: "check" },
  ],
  node(id) {
    const s = this.settings, circle = s.shape === "circle", k = s.nodeScale;
    return {
      w: (circle ? 110 : 150) * k,
      h: (circle ? 110 : 56) * k,
      shape: circle ? "ellipse" : "rectangle",
      cls: "r" + Math.min(this.data.rankOf(id), 4),
    };
  },
  layout(nodes, edges) {
    const s = this.settings;
    return treeLayout(nodes, edges, { direction: s.direction, nodesep: s.nodesep, ranksep: s.ranksep });
  },
  // No edgeNormal: arrows leave by the side facing the target, which in a
  // ranked tree is the layout direction.
  edgeNormal: null,
};

const STATE = {
  key: "state",
  data: STATE_DATA,
  folded: new Set(),
  settings: {
    startAngle: 0, nodesep: 45, ranksep: 111,
    shape: "circle", nodeScale: 1,
    radius: 0.16, lean: 120, spread: 36, gap: 0,
    edgeWidth: 3, arrowSize: 28, arrowHollow: true,
    durMs: 100,
  },
  layoutRows: [
    { key: "startAngle", label: "start angle", type: "range", min: -180, max: 180, step: 5 },
    { key: "nodesep", label: "nodesep", type: "range", min: 0, max: 140 },
    { key: "ranksep", label: "ranksep", type: "range", min: 40, max: 340 },
  ],
  ringSizes: [110, 130, 150],
  node(id) {
    const s = this.settings, circle = s.shape === "circle", k = s.nodeScale;
    const ring = Math.min(this.data.rankOf(id), 2);
    const size = this.ringSizes[ring];
    // An outer state node is a hyperedge on the record; it wears that
    // hyperedge's colours so the two graphs read as one structure.
    const aspect = ASPECTS[id];
    return {
      w: size * k,
      h: (circle ? size : 60) * k,
      shape: circle ? "ellipse" : "rectangle",
      cls: "g" + ring,
      hue: aspect && aspect.hue,
      fill: aspect && aspect.fill,
    };
  },
  layout(nodes, edges) {
    const s = this.settings;
    return radialLayout(nodes, edges, { startAngle: s.startAngle, nodesep: s.nodesep, ranksep: s.ranksep });
  },
  // Every arrow leaves its node along that node's own radial line.
  edgeNormal(e, boxOf) {
    return radialNormal(this.data.roots[0], e, boxOf);
  },
};

// Every arrow leaves its node along that node's own radial line — the line
// from `rootId` out through it. The root has no line of its own, so its
// arrows head straight at each target: plain spokes. Shared between STATE
// and the focus view, where the focused hyperedge's hub is the root.
function radialNormal(rootId, e, boxOf) {
  const root = boxOf(rootId);
  const s = boxOf(e.source);
  const t = boxOf(e.target);
  if (!root || !s || !t) return null;
  const cx = root.x + root.width / 2, cy = root.y + root.height / 2;
  const sx = s.x + s.width / 2, sy = s.y + s.height / 2;
  let dx = sx - cx, dy = sy - cy;
  if (Math.hypot(dx, dy) < 1) {
    dx = t.x + t.width / 2 - sx;
    dy = t.y + t.height / 2 - sy;
  }
  const len = Math.hypot(dx, dy);
  return len < 1 ? null : [dx / len, dy / len];
}

let MODE = STATE;
let FOCUS = null; // focused hyperedge id (record mode only); an overlay state

// ---- the effective view ----------------------------------------------------
// A hyperedge member that is folded away stands in as its nearest visible
// ancestor; shared members and same-branch collapses dedupe.
function resolveMembers(h, vis, data) {
  const out = [];
  h.members.forEach((m) => {
    let at = m;
    while (at !== undefined && !vis.has(at)) at = data.parent.get(at);
    if (at !== undefined && !out.includes(at)) out.push(at);
  });
  return out;
}

// The focus view: one state node, viewed as a radial graph of the record.
// The hub sits at the centre wearing the state node's colours, the resolved
// member events make ring 1 (keeping their record colours so identity
// carries through the morph), and each member's visible record children make
// ring 2. Member ids persist between views, so the ordinary transition
// tweens them from their record spots onto the ring.
function focusView(vis) {
  const { data } = MODE, s = MODE.settings, k = s.nodeScale;
  const h = MODE.hyper.find((x) => x.id === FOCUS);
  const members = resolveMembers(h, vis, data);
  const memberSet = new Set(members);

  const nodeFor = (id) => ({
    id,
    ...MODE.node(id),
    fs: FONT * k,
    label: data.labels[id] || id,
    kids: 0, // no folding while focused
    folded: MODE.folded.has(id),
    hidden: MODE.folded.has(id) ? data.descendants(id).length : 0,
  });

  const nodes = [{
    id: h.id, w: 120 * k, h: 120 * k, shape: "ellipse", cls: "hub",
    hue: h.hue, fill: h.fill, fs: FONT * k, label: h.label,
    kids: 0, folded: false, hidden: 0,
  }];
  const edges = [];
  members.forEach((m) => {
    nodes.push(nodeFor(m));
    edges.push({ id: h.id + ">" + m, source: h.id, target: m, stroke: h.hue, dashed: true, noArrow: true });
  });
  members.forEach((m) => {
    if (MODE.folded.has(m)) return;
    (data.children.get(m) || []).forEach((c) => {
      if (!vis.has(c)) return;
      // A member's tree edge to another member stays; other children join
      // ring 2 when asked for, each shown once.
      if (memberSet.has(c)) { edges.push({ id: m + ">" + c, source: m, target: c }); return; }
      if (!s.focusKids || nodes.some((n) => n.id === c)) return;
      nodes.push(nodeFor(c));
      edges.push({ id: m + ">" + c, source: m, target: c });
    });
  });

  // The hub is the only node nothing targets, so it becomes the centre.
  const pos = {};
  radialLayout(
    nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })), edges,
    { startAngle: 0, nodesep: s.nodesep, ranksep: s.ranksep },
  ).forEach((c, id) => { pos[id] = c; });
  return { nodes, edges, pos, hyper: [] };
}

function viewFor() {
  const { data } = MODE;
  const visible = [];
  const walk = (id) => {
    visible.push(id);
    if (MODE.folded.has(id)) return;
    (data.children.get(id) || []).forEach(walk);
  };
  data.roots.forEach(walk);
  const vis = new Set(visible);

  if (FOCUS) return focusView(vis);

  const nodes = visible.map((id) => ({
    id,
    ...MODE.node(id),
    fs: FONT * MODE.settings.nodeScale,
    label: data.labels[id] || id,
    kids: (data.children.get(id) || []).length,
    folded: MODE.folded.has(id),
    hidden: MODE.folded.has(id) ? data.descendants(id).length : 0,
  }));
  const edges = data.edgePairs
    .filter(([a, b]) => vis.has(a) && vis.has(b))
    .map(([a, b]) => ({ id: a + ">" + b, source: a, target: b }));

  const pos = {};
  MODE.layout(nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })), edges)
    .forEach((c, id) => { pos[id] = c; });

  const hyper = (MODE.hyper || []).map((h) => ({ ...h, members: resolveMembers(h, vis, data) }));

  // Hub view: one floating pill per hyperedge, placed after the layout so the
  // layout engines never see it, joined to its members by dashed spokes.
  const s = MODE.settings;
  if (hyper.length && (s.hyperView === "hubs" || s.hyperView === "both")) {
    const k = s.nodeScale;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const placed = nodes.map((n) => {
      const p = pos[n.id];
      const b = { x: p.cx - n.w / 2, y: p.cy - n.h / 2, w: n.w, h: n.h };
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      return b;
    });
    hyper.forEach((h) => {
      if (!h.members.length) return;
      const hw = 92 * k, hh = 30 * k;
      // Members' centroid; if that overlaps anything, step away from the
      // tree's bbox centre in deterministic 24px hops.
      let cx = 0, cy = 0;
      h.members.forEach((m) => { cx += pos[m].cx; cy += pos[m].cy; });
      cx /= h.members.length; cy /= h.members.length;
      let dx = cx - (x0 + x1) / 2, dy = cy - (y0 + y1) / 2;
      const len = Math.hypot(dx, dy);
      if (len < 1) { dx = 0; dy = -1; } else { dx /= len; dy /= len; }
      const hits = () => placed.some((b) =>
        cx + hw / 2 + 12 > b.x && cx - hw / 2 - 12 < b.x + b.w &&
        cy + hh / 2 + 12 > b.y && cy - hh / 2 - 12 < b.y + b.h);
      for (let i = 0; i < 10 && hits(); i++) { cx += dx * 24; cy += dy * 24; }
      nodes.push({
        id: h.id, w: hw, h: hh, shape: "rectangle", cls: "hub",
        hue: h.hue, fill: h.fill, fs: FONT * k, label: h.label,
        kids: 0, folded: false, hidden: 0,
      });
      pos[h.id] = { cx, cy };
      placed.push({ x: cx - hw / 2, y: cy - hh / 2, w: hw, h: hh });
      h.members.forEach((m) => edges.push({ id: h.id + ">" + m, source: h.id, target: m, stroke: h.hue, dashed: true, noArrow: true }));
    });
  }

  return { nodes, edges, pos, hyper };
}

// ---- viewer ----------------------------------------------------------------
const stage = document.getElementById("stage");
const plane = document.getElementById("plane");
let lastRenderedView = null;

// Every view change goes through here: the blob layer fades out for the
// transition and recomputes only once the viewer settles.
function render(discrete) {
  blobs.markStale();
  lastRenderedView = viewFor();
  viewer.transition(lastRenderedView, discrete);
}

const viewer = createViewer({
  stage,
  plane,
  svg: document.getElementById("edges"),
  // `hy:` ids miss the parent map -> undefined -> hubs fade in/out in place.
  parentOf: (id) => MODE.data.parent.get(id),
  durMs: () => MODE.settings.durMs,
  routeOpts: () => {
    const s = MODE.settings;
    return { gap: s.gap, radius: s.radius, lean: s.lean, spread: s.spread };
  },
  edgeNormal: (e, boxOf) =>
    (FOCUS ? radialNormal(FOCUS, e, boxOf) : MODE.edgeNormal ? MODE.edgeNormal(e, boxOf) : null),
  decorate(el, n) {
    el.className = "node " + n.cls
      + (n.shape === "ellipse" ? " circle" : "")
      + (n.kids ? " branchy" : "") + (n.folded ? " folded" : "");
    el.dataset.id = n.id;
    el.style.borderColor = n.hue || "";
    el.style.background = n.fill || "";
    el.style.fontSize = n.fs + "px";
    el.textContent = n.label + (n.folded ? " ×" + n.hidden : "");
    el.title = n.kids ? (n.folded ? "Unfold" : "Fold") : "";
  },
  onNodeClick(id, n) {
    if (id.startsWith("hy:")) { setFocus(FOCUS === id ? null : id); return; }
    if (FOCUS || !n || !n.kids) return;
    if (MODE.folded.has(id)) MODE.folded.delete(id);
    else MODE.folded.add(id);
    render(true);
  },
  onSettle() { blobs.settle(); },
});

// ---- hyperedge blob layer --------------------------------------------------
// null hides the layer: state mode, focus mode, or blobs switched off.
// Shared with the SVG export, so the file shows the same blobs as the screen.
function blobInput() {
  const v = lastRenderedView, s = MODE.settings;
  if (!v || FOCUS || !v.hyper || !v.hyper.length) return null;
  if (s.hyperView !== "blobs" && s.hyperView !== "both") return null;
  const boxes = {};
  v.nodes.forEach((n) => {
    if (n.cls === "hub") return; // hubs are overlays, not obstacles
    const p = v.pos[n.id];
    if (!p) return;
    boxes[n.id] = {
      shape: n.shape === "ellipse" ? "ellipse" : "rectangle",
      box: { x: p.cx - n.w / 2, y: p.cy - n.h / 2, width: n.w, height: n.h },
    };
  });
  return {
    hyper: v.hyper, boxes,
    settings: {
      padding: s.blobPadding, corridor: s.blobCorridor,
      smoothing: s.blobSmoothing, opacity: s.blobOpacity, labels: s.blobLabels,
    },
  };
}

const blobs = createBlobLayer({
  svg: document.getElementById("blobs"),
  getInput: blobInput,
  onHover: (id) => highlight(id),
  onClick: (id) => setFocus(id),
});

// ---- SVG export ------------------------------------------------------------
// The exported file is the settled current view: same layout, same routing,
// same blobs, drawn from the same geometry code the screen uses.
document.getElementById("export").addEventListener("click", () => {
  if (!lastRenderedView) lastRenderedView = viewFor();
  const s = MODE.settings;
  const svgText = viewToSvg(lastRenderedView, {
    routeOpts: { gap: s.gap, radius: s.radius, lean: s.lean, spread: s.spread },
    edgeWidth: s.edgeWidth, arrowSize: s.arrowSize, arrowHollow: s.arrowHollow,
    edgeNormal: (e, boxOf) =>
      (FOCUS ? radialNormal(FOCUS, e, boxOf) : MODE.edgeNormal ? MODE.edgeNormal(e, boxOf) : null),
    blobs: blobInput(),
  });
  const name = MODE.key + (FOCUS ? "-" + FOCUS.replace(/^hy:/, "") : "") + ".svg";
  downloadSvg(svgText, name);
});

// ---- focus mode ------------------------------------------------------------
const backEl = document.getElementById("back");
function setFocus(id) {
  if (MODE.hyper === undefined) return;
  if (id === FOCUS) return;
  FOCUS = id;
  highlight(null);
  backEl.style.display = FOCUS ? "" : "none";
  render(true);
}
backEl.querySelector("button").addEventListener("click", () => setFocus(null));
window.addEventListener("keydown", (e) => { if (e.key === "Escape" && FOCUS) setFocus(null); });

// ---- hover highlight -------------------------------------------------------
// Members glow in the hyperedge's hue; everything else steps back via the
// .hl-dim filter (style.opacity belongs to the viewer, which rewrites it
// every frame).
function highlight(hyperId) {
  if (FOCUS) hyperId = null;
  const members = new Set();
  let hue = "";
  if (hyperId && lastRenderedView) {
    const h = (lastRenderedView.hyper || []).find((x) => x.id === hyperId);
    if (h) {
      hue = h.hue;
      members.add(h.id);
      h.members.forEach((m) => members.add(m));
    }
  }
  plane.querySelectorAll(".node").forEach((el) => {
    const on = members.has(el.dataset.id);
    el.style.boxShadow = on ? "0 0 0 3px " + hue : "";
    el.classList.toggle("hl-dim", !!hue && !on);
  });
}
// Hovering a hub highlights its hyperedge, like hovering its blob or chip.
plane.addEventListener("mouseover", (e) => {
  const el = e.target.closest(".node.hub");
  if (el) highlight(el.dataset.id);
});
plane.addEventListener("mouseout", (e) => {
  if (e.target.closest(".node.hub")) highlight(null);
});

// ---- legend ----------------------------------------------------------------
const legend = document.createElement("div");
legend.className = "legend";
stage.appendChild(legend);
function buildLegend() {
  legend.innerHTML = "";
  const hyper = MODE.hyper || [];
  legend.style.display = hyper.length ? "" : "none";
  hyper.forEach((h) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = h.hue;
    chip.append(dot, document.createTextNode(h.label));
    chip.addEventListener("mouseenter", () => highlight(h.id));
    chip.addEventListener("mouseleave", () => highlight(null));
    chip.addEventListener("click", () => setFocus(FOCUS === h.id ? null : h.id));
    legend.appendChild(chip);
  });
}

// ---- tune panel ------------------------------------------------------------
function applyEdgeStyle() {
  const s = MODE.settings;
  document.documentElement.style.setProperty("--edge-w", s.edgeWidth + "px");
  applyArrow(document.getElementById("edges"), { size: s.arrowSize, hollow: s.arrowHollow, width: s.edgeWidth });
}

let panel = null;
function buildPanel() {
  if (panel) panel.root.remove();
  panel = createPanel({
    mount: stage,
    settings: MODE.settings,
    groups: [
      { title: "Layout", rows: MODE.layoutRows },
      ...(MODE.hyperRows ? [{ title: "Hyperedges", rows: MODE.hyperRows }] : []),
      ...SHARED_ROWS,
    ],
    onChange(key, discrete) {
      applyEdgeStyle();
      render(discrete); // the settle/debounce path refreshes the blobs
    },
  });
}

// ---- mode toggle -----------------------------------------------------------
const modeEl = document.getElementById("mode");
modeEl.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    const next = b.dataset.mode === "record" ? RECORD : STATE;
    if (next === MODE) return;
    MODE = next;
    FOCUS = null; // focus is an overlay of the record; leaving clears it
    backEl.style.display = "none";
    highlight(null);
    modeEl.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    applyEdgeStyle();
    buildPanel();
    buildLegend();
    render(true);
  });
});

window.addEventListener("resize", () => viewer.refit(true));

applyEdgeStyle();
buildPanel();
buildLegend();
render(false);
