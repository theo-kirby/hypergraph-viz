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

import { radialLayout } from "./lib/excaligraph.js";
import { createViewer } from "./lib/viewer.js";
import { createPanel, applyArrow } from "./lib/panel.js";
import { createBlobLayer } from "./lib/hyper.js";
import { viewToSvg, downloadSvg, downloadFile } from "./lib/export.js";
import { viewToScene } from "./lib/excalidraw-scene.js";
import { ensureHarness, renderScene } from "./lib/excal-render.js";
import { mountPerfHud } from "./lib/perf-hud.js";

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
const DEMO_ASPECTS = {
  mutantA:   { label: "Mutant A",  hue: "#e64980", fill: "#ffdeeb", members: ["mutA", "asyA", "proto1"] },
  stability: { label: "Stability", hue: "#12b886", fill: "#c3fae8", members: ["asyB", "scan", "bridge", "asyC"] },
  mechanism: { label: "Mechanism", hue: "#f59f00", fill: "#ffec99", members: ["lit", "h1", "asyA"] },
  assay:     { label: "Assay rig", hue: "#4263eb", fill: "#dbe4ff", members: ["rig", "proto1", "proto2"] },
};

// The record: the progression over time, radiating out from the first
// question. No final result yet — the frontier is just the latest events on
// each line of inquiry.
const DEMO_RECORD_DATA = makeData([
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
const DEMO_STATE_DATA = makeData([
  ["now", "design"], ["now", "knowledge"], ["now", "methods"],
  ["design", "mutantA"], ["design", "stability"],
  ["knowledge", "mechanism"],
  ["methods", "assay"],
], {
  now: "Current state", design: "Enzyme design", knowledge: "Knowledge", methods: "Methods",
  mutantA: DEMO_ASPECTS.mutantA.label, stability: DEMO_ASPECTS.stability.label,
  mechanism: DEMO_ASPECTS.mechanism.label, assay: DEMO_ASPECTS.assay.label,
});

// ---- local dataset ---------------------------------------------------------
// Drop a `data.local.js` next to this file to view a real project's graphs:
// export RECORD_EDGES, RECORD_LABELS, STATE_EDGES, STATE_LABELS, ASPECTS
// (same shapes as the demo above). Without one, the demo shows.
const localModules = import.meta.glob("./data.local.js", { eager: true });
const LOCAL = localModules["./data.local.js"];
const ASPECTS = LOCAL ? LOCAL.ASPECTS : DEMO_ASPECTS;
const RECORD_DATA = LOCAL
  ? makeData(LOCAL.RECORD_EDGES, LOCAL.RECORD_LABELS) : DEMO_RECORD_DATA;
const STATE_DATA = LOCAL
  ? makeData(LOCAL.STATE_EDGES, LOCAL.STATE_LABELS) : DEMO_STATE_DATA;

// ---- shared panel rows ------------------------------------------------------
// Both modes lay out and route the same way — the equal-split radial with bow
// arrows — so they share the layout and edge rows too. What differs is only
// the data and the node styling.
const RADIAL_LAYOUT_ROWS = [
  { key: "startAngle", label: "start angle", type: "range", min: -180, max: 180, step: 5 },
  { key: "nodesep", label: "nodesep", type: "range", min: 0, max: 300, step: 5 },
  { key: "ranksep", label: "ranksep", type: "range", min: 60, max: 400, step: 5 },
];
const RADIAL_EDGE_ROWS = [
  { key: "originSpread", label: "origin", type: "range", min: 0, max: 90 },
  { key: "bowScale", label: "bow", type: "range", min: 0, max: 3, step: 0.05 },
];
const EDGE_SHARED_ROWS = [
  { key: "gap", label: "gap", type: "range", min: 0, max: 30 },
  { key: "edgeWidth", label: "width", type: "range", min: 0.5, max: 4, step: 0.1 },
];
const SHARED_ROWS = [
  { title: "Nodes", rows: [
    { key: "shape", label: "shape", type: "segment", options: [{ value: "rectangle", label: "Rect" }, { value: "circle", label: "Circle" }] },
    { key: "nodeScale", label: "scale", type: "range", min: 0.6, max: 1.6, step: 0.05 },
    { key: "mono", label: "b & w", type: "check" },
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
    startAngle: 0, nodesep: 160, ranksep: 200,
    shape: "circle", nodeScale: 1,
    style: "bow", originSpread: 0, bowScale: 1, gap: 14,
    edgeWidth: 3, arrowSize: 28, arrowHollow: true,
    durMs: 100, mono: false,
    hyperView: "blobs", blobPadding: 22, blobCorridor: 14, blobSmoothing: 26,
    blobOpacity: 0.35, blobLabels: true, focusKids: true,
  },
  layoutRows: RADIAL_LAYOUT_ROWS,
  edgeRows: RADIAL_EDGE_ROWS,
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
    return radialLayout(nodes, edges, { startAngle: s.startAngle, nodesep: s.nodesep, ranksep: s.ranksep });
  },
  // Every arrow leaves its node along that node's own radial line. The
  // startAngle knob is the arrow of direction: it aims the first branch, and
  // the equal split fans the rest of the circle from there.
  edgeNormal(e, boxOf) {
    return radialNormal(this.data.roots[0], e, boxOf);
  },
};

const STATE = {
  key: "state",
  data: STATE_DATA,
  folded: new Set(),
  settings: {
    startAngle: 0, nodesep: 160, ranksep: 200,
    shape: "circle", nodeScale: 1,
    style: "bow", originSpread: 0, bowScale: 1, gap: 14,
    edgeWidth: 3, arrowSize: 28, arrowHollow: true,
    durMs: 100, mono: false,
  },
  layoutRows: RADIAL_LAYOUT_ROWS,
  edgeRows: RADIAL_EDGE_ROWS,
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

// ---- both: the record on the left, the state on the right ------------------
// One canvas, both graphs side by side, one shared settings object so the two
// sides speak the same visual language. The record keeps its hyperedge
// overlays; the state's outer nodes ARE those hyperedges, sitting across from
// them — hovering a blob also lights up its state node.
const RECORD_IDS = new Set(RECORD_DATA.order);
const BOTH_GAP = 240; // px between the two graphs

// A side mode rendered with someone else's settings (BOTH shares one settings
// object across both sides); methods keep working via the prototype chain.
const withSettings = (mode, settings) => Object.assign(Object.create(mode), { settings });

const BOTH = {
  key: "both",
  // Combined data: disjoint id sets, so a plain merge gives two roots. Used
  // by the viewer's ancestor lookups and by the focus view; the two sides lay
  // themselves out from their own data.
  data: makeData(
    [...RECORD_DATA.edgePairs, ...STATE_DATA.edgePairs],
    { ...RECORD_DATA.labels, ...STATE_DATA.labels },
  ),
  folded: RECORD.folded, // the focus view only ever asks about record ids
  settings: {
    startAngle: 0, nodesep: 160, ranksep: 200,
    shape: "circle", nodeScale: 1,
    style: "bow", originSpread: 0, bowScale: 1, gap: 14,
    edgeWidth: 3, arrowSize: 28, arrowHollow: true,
    durMs: 100, mono: false,
    hyperView: "blobs", blobPadding: 22, blobCorridor: 14, blobSmoothing: 26,
    blobOpacity: 0.35, blobLabels: true, focusKids: true,
  },
  layoutRows: RADIAL_LAYOUT_ROWS,
  edgeRows: RADIAL_EDGE_ROWS,
  hyper: RECORD.hyper,
  hyperRows: RECORD.hyperRows,
  node(id) {
    const side = RECORD_IDS.has(id) ? RECORD : STATE;
    return side.node.call(withSettings(side, this.settings), id);
  },
  edgeNormal(e, boxOf) {
    const onRecord = e.source.startsWith("hy:") || RECORD_IDS.has(e.source);
    return radialNormal(onRecord ? RECORD_DATA.roots[0] : STATE_DATA.roots[0], e, boxOf);
  },
};

let MODE = STATE;
let FOCUS = null; // focused hyperedge id (record/both mode); an overlay state

// The routing options for the current view, shared by the live viewer, the
// SVG export and the Excalidraw scene builder. The focus view is radial, so
// it always bows, whatever mode it overlays.
function currentRouteOpts() {
  const s = MODE.settings;
  return {
    style: FOCUS ? "bow" : s.style,
    gap: s.gap, radius: s.radius, lean: s.lean, spread: s.spread,
    originSpread: s.originSpread, bowScale: s.bowScale,
  };
}
function currentEdgeNormal(e, boxOf) {
  return FOCUS ? radialNormal(FOCUS, e, boxOf) : MODE.edgeNormal ? MODE.edgeNormal(e, boxOf) : null;
}

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

function visibleSet(mode) {
  const visible = [];
  const walk = (id) => {
    visible.push(id);
    if (mode.folded.has(id)) return;
    (mode.data.children.get(id) || []).forEach(walk);
  };
  mode.data.roots.forEach(walk);
  return visible;
}

// The plain view of one mode: its visible nodes, edges, layout and resolved
// hyperedges. BOTH calls it once per side.
function modeView(mode) {
  const { data } = mode;
  const visible = visibleSet(mode);
  const vis = new Set(visible);

  const nodes = visible.map((id) => ({
    id,
    ...mode.node(id),
    fs: FONT * mode.settings.nodeScale,
    label: data.labels[id] || id,
    kids: (data.children.get(id) || []).length,
    folded: mode.folded.has(id),
    hidden: mode.folded.has(id) ? data.descendants(id).length : 0,
  }));
  const edges = data.edgePairs
    .filter(([a, b]) => vis.has(a) && vis.has(b))
    .map(([a, b]) => ({ id: a + ">" + b, source: a, target: b }));

  const pos = {};
  mode.layout(nodes.map((n) => ({ id: n.id, width: n.w, height: n.h })), edges)
    .forEach((c, id) => { pos[id] = c; });

  const hyper = (mode.hyper || []).map((h) => ({ ...h, members: resolveMembers(h, vis, data) }));

  // Hub view: one floating pill per hyperedge, placed after the layout so the
  // layout engines never see it, joined to its members by dashed spokes.
  const s = mode.settings;
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

// Black & white: rewrite the view's colours in place — black node outlines on
// no fill, grey edges and grey blobs. Exports and the Excalidraw scene read
// the same view, so they go monochrome with it.
function finishView(view) {
  if (MODE.settings.mono) {
    view.nodes.forEach((n) => { n.hue = "#0f172a"; n.fill = "transparent"; });
    view.edges.forEach((e) => { if (e.stroke) e.stroke = "#94a3b8"; });
    (view.hyper || []).forEach((h) => { h.hue = "#475569"; h.fill = "#cbd5e1"; });
  }
  return view;
}

function viewFor() {
  if (FOCUS) return finishView(focusView(new Set(visibleSet(MODE))));
  if (MODE !== BOTH) return finishView(modeView(MODE));

  // Both: record on the left, state on the right, centred on each other.
  const left = modeView(withSettings(RECORD, MODE.settings));
  const right = modeView(withSettings(STATE, MODE.settings));
  const bboxOf = (v) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    v.nodes.forEach((n) => {
      const p = v.pos[n.id];
      if (!p) return;
      x0 = Math.min(x0, p.cx - n.w / 2); y0 = Math.min(y0, p.cy - n.h / 2);
      x1 = Math.max(x1, p.cx + n.w / 2); y1 = Math.max(y1, p.cy + n.h / 2);
    });
    return { x0, y0, x1, y1 };
  };
  const lb = bboxOf(left), rb = bboxOf(right);
  const dx = lb.x1 + BOTH_GAP - rb.x0;
  const dy = (lb.y0 + lb.y1) / 2 - (rb.y0 + rb.y1) / 2;
  Object.values(right.pos).forEach((p) => { p.cx += dx; p.cy += dy; });
  return finishView({
    nodes: [...left.nodes, ...right.nodes],
    edges: [...left.edges, ...right.edges],
    pos: { ...left.pos, ...right.pos },
    hyper: left.hyper,
  });
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
  scheduleExcal();
}

const viewer = createViewer({
  stage,
  plane,
  svg: document.getElementById("edges"),
  // `hy:` ids miss the parent map -> undefined -> hubs fade in/out in place.
  parentOf: (id) => MODE.data.parent.get(id),
  durMs: () => MODE.settings.durMs,
  routeOpts: currentRouteOpts,
  edgeNormal: currentEdgeNormal,
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
    // In Both, a fold lands on whichever side owns the node.
    const folded = MODE === BOTH && !RECORD_IDS.has(id) ? STATE.folded : MODE.folded;
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
    render(true);
  },
  // The blob retrace is the heaviest thing a state change triggers; while the
  // opaque Excaligraph overlay hides the live layer, skip it (the overlay
  // computes its own blobs in viewToScene) and catch up when Live returns.
  onSettle() { if (!EXCAL) blobs.settle(); },
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

// ---- Excaligraph mode ------------------------------------------------------
// A static render of the current view through the real Excalidraw exporter:
// view → Excalidraw scene (same geometry the screen draws) → harness SVG,
// shown in the opaque #excal overlay. Panel changes and mode switches
// re-render it (debounced); fold/pan/zoom stay live-mode-only.
let EXCAL = false;
let excalScene = null;   // last rendered scene, for the .excalidraw download
let excalSvgText = null; // last harness SVG, for the SVG download
let excalGen = 0;
let excalTimer = null;
const excalEl = document.getElementById("excal");
const styleEl = document.getElementById("style");
const exportFileBtn = document.getElementById("exportfile");

async function renderExcal() {
  const my = ++excalGen;
  if (!excalEl.querySelector("svg")) {
    excalEl.innerHTML = '<div class="excal-status">rendering…</div>';
  }
  try {
    await ensureHarness();
    if (!lastRenderedView) lastRenderedView = viewFor();
    const s = MODE.settings;
    const scene = await viewToScene(lastRenderedView, {
      routeOpts: currentRouteOpts(),
      edgeNormal: currentEdgeNormal,
      arrowHollow: s.arrowHollow,
      edgeWidth: s.edgeWidth,
      blobs: blobInput(),
    });
    const svg = await renderScene(scene);
    if (my !== excalGen || !EXCAL) return;
    excalScene = scene;
    excalSvgText = svg;
    excalEl.innerHTML = svg;
  } catch (err) {
    if (my !== excalGen) return;
    excalEl.innerHTML = '<div class="excal-status">' + String(err.message ?? err) + "</div>";
  }
}
function scheduleExcal() {
  if (!EXCAL) return;
  clearTimeout(excalTimer);
  excalTimer = setTimeout(renderExcal, 150);
}
styleEl.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    const on = b.dataset.style === "excal";
    if (on === EXCAL) return;
    EXCAL = on;
    styleEl.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    excalEl.classList.toggle("on", EXCAL);
    exportFileBtn.style.display = EXCAL ? "block" : "none";
    if (EXCAL) renderExcal();
    else { excalEl.innerHTML = ""; excalSvgText = null; blobs.settle(); }
  });
});

// ---- exports ---------------------------------------------------------------
// The exported file is the settled current view: same layout, same routing,
// same blobs, drawn from the same geometry code the screen uses. In
// Excaligraph mode the SVG button downloads the harness-rendered SVG instead,
// and the second button downloads the scene as an .excalidraw file.
const exportName = () => MODE.key + (FOCUS ? "-" + FOCUS.replace(/^hy:/, "") : "");
document.getElementById("export").addEventListener("click", () => {
  if (EXCAL) {
    if (excalSvgText) downloadSvg(excalSvgText, exportName() + "-excalidraw.svg");
    return;
  }
  if (!lastRenderedView) lastRenderedView = viewFor();
  const s = MODE.settings;
  const svgText = viewToSvg(lastRenderedView, {
    routeOpts: currentRouteOpts(),
    edgeWidth: s.edgeWidth, arrowSize: s.arrowSize, arrowHollow: s.arrowHollow,
    edgeNormal: currentEdgeNormal,
    blobs: blobInput(),
  });
  downloadSvg(svgText, exportName() + ".svg");
});
exportFileBtn.addEventListener("click", () => {
  if (!excalScene) return;
  downloadFile(JSON.stringify(excalScene, null, 2), exportName() + ".excalidraw", "application/json");
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
      // In Both, the hyperedge IS a state node — light it up across the gap.
      members.add(h.id.replace(/^hy:/, ""));
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
      { title: "Edges", rows: [...MODE.edgeRows, ...EDGE_SHARED_ROWS] },
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
const MODES = { record: RECORD, state: STATE, both: BOTH };
modeEl.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    const next = MODES[b.dataset.mode];
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
mountPerfHud(); // temporary: on-screen jank readout (toggle with P)
