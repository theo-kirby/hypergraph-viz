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

import { radialLayout, buildForest } from "./lib/excaligraph.js";
import { bowScaleFor } from "./lib/autofit.js";
import { createViewer } from "./lib/viewer.js";
import { createPanel, applyArrow } from "./lib/panel.js";
import { createBlobLayer } from "./lib/hyper.js";
import { viewToSvg, svgToPng, downloadSvg, downloadFile, downloadBlob } from "./lib/export.js";
import { viewToScene } from "./lib/excalidraw-scene.js";
import { loadProject } from "./lib/protocol.js";

const FONT = 13;

// ---- datasets --------------------------------------------------------------
function makeData(edgePairs, labels, titles = {}) {
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
  // Rank = depth in the same spanning forest the radial layout builds, so a
  // multi-parent node is coloured for the ring it is actually placed on —
  // walking the first-listed parent chain can disagree with the layout.
  const forest = buildForest(
    order.map((id) => ({ id })),
    edgePairs.map(([a, b]) => ({ source: a, target: b })),
  );
  const rankOf = (id) => forest.depth.get(id) ?? 0;
  const descendants = (id) => (children.get(id) || []).flatMap((c) => [c, ...descendants(c)]);
  return { order, parent, children, roots, rankOf, descendants, edgePairs, labels, titles };
}

// ---- data: a served project, or the demo -----------------------------------
// With HG_PROJECT set, the dev server exposes that project's graph exports
// (written by `hypergraph export`) at /hg/ and the real graphs load here;
// otherwise the built-in research example below renders.
const PROJECT = await loadProject();
if (PROJECT) document.title = PROJECT.name + " — hypergraph";

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
const DEMO_RECORD = makeData([
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
const DEMO_STATE = makeData([
  ["now", "design"], ["now", "knowledge"], ["now", "methods"],
  ["design", "mutantA"], ["design", "stability"],
  ["knowledge", "mechanism"],
  ["methods", "assay"],
], {
  now: "Current state", design: "Enzyme design", knowledge: "Knowledge", methods: "Methods",
  mutantA: DEMO_ASPECTS.mutantA.label, stability: DEMO_ASPECTS.stability.label,
  mechanism: DEMO_ASPECTS.mechanism.label, assay: DEMO_ASPECTS.assay.label,
});

// A project's aspects come keyed by state slug, so a state node and its
// hyperedge share an id — same identity trick the demo plays.
const ASPECTS = PROJECT ? PROJECT.aspects : DEMO_ASPECTS;
const RECORD_DATA = PROJECT
  ? makeData(PROJECT.record.pairs, PROJECT.record.labels, PROJECT.record.titles)
  : DEMO_RECORD;
const STATE_DATA = PROJECT
  ? makeData(PROJECT.state.pairs, PROJECT.state.labels, PROJECT.state.titles)
  : DEMO_STATE;

// ---- shared panel rows ------------------------------------------------------
// Both modes lay out and route the same way — the equal-split radial with bow
// arrows — so they share the layout and edge rows too. What differs is only
// the data and the node styling.
const RADIAL_LAYOUT_ROWS = [
  { key: "startAngle", label: "start angle", type: "range", min: -180, max: 180, step: 5 },
  { key: "nodesep", label: "nodesep", type: "range", min: 0, max: 600, step: 5 },
  { key: "ranksep", label: "ranksep", type: "range", min: 60, max: 1200, step: 5 },
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
  { title: "Canvas", rows: [
    { key: "bgDots", label: "dots", type: "range", min: 0, max: 1, step: 0.05 },
  ] },
];

// ---- record colours --------------------------------------------------------
// One colour per rank (step in the progression). The root keeps its purple;
// every deeper ring cycles through the wheel instead of clamping, so a
// 40-rank record reads as rings all the way down rather than going one
// colour after rank 4. First four entries match the old r1–r4 classes.
const RECORD_ROOT = { hue: "#7c3aed", fill: "#d0bfff" };
const RECORD_RING_COLORS = [
  { hue: "#339af0", fill: "#a5d8ff" }, // blue
  { hue: "#22b8cf", fill: "#99e9f2" }, // cyan
  { hue: "#40c057", fill: "#b2f2bb" }, // green
  { hue: "#f59f00", fill: "#ffec99" }, // yellow
  { hue: "#e8590c", fill: "#ffd8a8" }, // orange
  { hue: "#e64980", fill: "#fcc2d7" }, // pink
  { hue: "#82c91e", fill: "#d8f5a2" }, // lime
  { hue: "#12b886", fill: "#c3fae8" }, // teal
];
const recordColor = (rank) =>
  rank === 0 ? RECORD_ROOT : RECORD_RING_COLORS[(rank - 1) % RECORD_RING_COLORS.length];

// ---- modes -----------------------------------------------------------------
const RECORD = {
  key: "record",
  data: RECORD_DATA,
  folded: new Set(),
  settings: {
    startAngle: 0, nodesep: 0, ranksep: 250,
    shape: "circle", nodeScale: 1.25,
    style: "bow", originSpread: 0, bowScale: 2.1, gap: 9,
    edgeWidth: 4, arrowSize: 28, arrowHollow: true,
    durMs: 100, mono: false, bgDots: 0.1,
    hyperView: "blobs", blobPadding: 27, blobCorridor: 40, blobSmoothing: 60,
    blobOpacity: 0.25, blobLabels: true, focusKids: true,
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
    const rank = this.data.rankOf(id);
    const color = recordColor(rank);
    return {
      w: (circle ? 110 : 150) * k,
      h: (circle ? 110 : 56) * k,
      shape: circle ? "ellipse" : "rectangle",
      cls: rank === 0 ? "r0" : "rn",
      hue: color.hue,
      fill: color.fill,
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
    startAngle: 0, nodesep: 0, ranksep: 250,
    shape: "circle", nodeScale: 1.25,
    style: "bow", originSpread: 0, bowScale: 2.1, gap: 9,
    edgeWidth: 4, arrowSize: 28, arrowHollow: true,
    durMs: 100, mono: false, bgDots: 0.1,
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

// Both draws each side with that side's own tuned settings — layout, edges,
// nodes all come from RECORD.settings / STATE.settings, so the combined view
// always matches the two solo modes. Only the overlay and canvas knobs below
// belong to the combined view itself.
const BOTH = {
  key: "both",
  // Combined data: disjoint id sets, so a plain merge gives two roots. Used
  // by the viewer's ancestor lookups and by the focus view; the two sides lay
  // themselves out from their own data.
  data: makeData(
    [...RECORD_DATA.edgePairs, ...STATE_DATA.edgePairs],
    { ...RECORD_DATA.labels, ...STATE_DATA.labels },
    { ...RECORD_DATA.titles, ...STATE_DATA.titles },
  ),
  folded: RECORD.folded, // the focus view only ever asks about record ids
  settings: {
    durMs: 100, mono: false, bgDots: 0.1,
    hyperView: "blobs", blobPadding: 27, blobCorridor: 40, blobSmoothing: 60,
    blobOpacity: 0.25, blobLabels: true, focusKids: true,
  },
  hyper: RECORD.hyper,
  hyperRows: RECORD.hyperRows,
  node(id) {
    const side = RECORD_IDS.has(id) ? RECORD : STATE;
    return side.node(id);
  },
  edgeNormal(e, boxOf) {
    const onRecord = e.source.startsWith("hy:") || RECORD_IDS.has(e.source);
    const side = onRecord ? RECORD : STATE;
    return side.edgeNormal(e, boxOf);
  },
};

// ---- bow auto-fit on load --------------------------------------------------
// The spacing defaults are fixed (nodesep 0, ranksep 250): dense on purpose,
// and a little overlap on a big record is fine — the sliders tune it. The
// bowScale is still computed per mode: the value that merges each sibling
// fan into one line that forks partway out, from the fan angles this dataset
// actually produces at those defaults.
function autoBow(mode, data) {
  const s = mode.settings;
  const nodes = data.order.map((id) => {
    const n = mode.node(id);
    return { id, width: n.w, height: n.h };
  });
  const edges = data.edgePairs.map(([a, b]) => ({ source: a, target: b }));
  const bow = bowScaleFor(nodes, edges, { nodesep: s.nodesep, ranksep: s.ranksep, startAngle: s.startAngle });
  if (bow !== null) s.bowScale = bow;
}
autoBow(RECORD, RECORD_DATA);
autoBow(STATE, STATE_DATA);

let MODE = STATE;
let FOCUS = null; // focused hyperedge id (record/both mode); an overlay state

// The settings that drive routing and export styling. Both has no edge
// settings of its own — the record's stand in (per-edge routeOpts carry each
// side's real values), and the focus overlay is a record view anyway.
function routeSettings() {
  return MODE === BOTH ? RECORD.settings : MODE.settings;
}

// The routing options for the current view, shared by the live viewer, the
// SVG export and the Excalidraw scene builder. The focus view is radial, so
// it always bows, whatever mode it overlays.
function currentRouteOpts() {
  const s = routeSettings();
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
  // The focus overlay is a record-side view; in Both it borrows the record's
  // settings (Both's own settings carry no layout or node knobs).
  const { data } = MODE, s = routeSettings(), k = s.nodeScale;
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
      // The overlay toggles live on the current mode (Both keeps its own).
      if (!MODE.settings.focusKids || nodes.some((n) => n.id === c)) return;
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
  const seen = new Set();
  // A multi-parent node is reachable through each parent; count it once.
  const walk = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
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
  // Each side renders and routes with its own mode's settings.
  const left = modeView(RECORD);
  const right = modeView(STATE);
  const routeOptsOf = (m) => ({
    style: m.settings.style, gap: m.settings.gap,
    originSpread: m.settings.originSpread, bowScale: m.settings.bowScale,
  });
  left.edges.forEach((e) => { e.routeOpts = routeOptsOf(RECORD); });
  right.edges.forEach((e) => { e.routeOpts = routeOptsOf(STATE); });
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
    // Foldable nodes explain the click; truncated labels tell the full title.
    const full = MODE.data.titles[n.id];
    el.title = n.kids ? (n.folded ? "Unfold" : "Fold") : full && full !== n.label ? full : "";
  },
  onNodeClick(id, n) {
    if (id.startsWith("hy:")) { setFocus(FOCUS === id ? null : id); return; }
    // In Both, a state aspect node IS a hyperedge — clicking it focuses the
    // record events behind it, exactly like clicking its blob or hub.
    if (MODE === BOTH && !FOCUS && ASPECTS[id]) {
      setFocus("hy:" + id);
      return;
    }
    if (FOCUS || !n || !n.kids) return;
    // In Both, a fold lands on whichever side owns the node.
    const folded = MODE === BOTH && !RECORD_IDS.has(id) ? STATE.folded : MODE.folded;
    if (folded.has(id)) folded.delete(id);
    else folded.add(id);
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

// ---- exports ---------------------------------------------------------------
// The exported file is the settled current view: same layout, same routing,
// same blobs, drawn from the same geometry code the screen uses. The
// .excalidraw export builds the scene on demand through the excaligraph
// library — same view, same opts, hand-drawn file.
const exportName = () => MODE.key + (FOCUS ? "-" + FOCUS.replace(/^hy:/, "") : "");
function exportSvg() {
  if (!lastRenderedView) lastRenderedView = viewFor();
  const s = routeSettings();
  const svgText = viewToSvg(lastRenderedView, {
    routeOpts: currentRouteOpts(),
    edgeWidth: s.edgeWidth, arrowSize: s.arrowSize, arrowHollow: s.arrowHollow,
    edgeNormal: currentEdgeNormal,
    blobs: blobInput(),
  });
  downloadSvg(svgText, exportName() + ".svg");
}
async function exportExcalidraw() {
  if (!lastRenderedView) lastRenderedView = viewFor();
  const s = routeSettings();
  const scene = await viewToScene(lastRenderedView, {
    routeOpts: currentRouteOpts(),
    edgeNormal: currentEdgeNormal,
    arrowHollow: s.arrowHollow,
    edgeWidth: s.edgeWidth,
    blobs: blobInput(),
  });
  downloadFile(JSON.stringify(scene, null, 2), exportName() + ".excalidraw", "application/json");
}

// ---- PNG export ------------------------------------------------------------
// Framing: "screen" captures exactly the on-screen window (same pan, same
// zoom, partial nodes clipped at the edge); "full" frames every node of the
// current graph. The settings toggle paints the capture's settings into a
// corner card, so a good-looking configuration can be read back later.
// These are UI preferences, not view settings — they live outside the
// per-mode settings objects and their JSON.
const EXPORT_PREFS = { pngArea: "screen", pngSettings: false };

function screenCrop() {
  const v = viewer.view();
  return {
    x: -v.x / v.k,
    y: -v.y / v.k,
    width: stage.clientWidth / v.k,
    height: stage.clientHeight / v.k,
  };
}

// The settings card, drawn onto the finished canvas: one column per settings
// object (Both shows all three), sized relative to the image so it stays
// readable at any export resolution.
function settingsCaption(ctx, W, H) {
  const sections = MODE === BOTH
    ? [["both", BOTH.settings], ["record", RECORD.settings], ["state", STATE.settings]]
    : [[MODE.key, MODE.settings]];
  const fs = Math.max(11, Math.min(28, Math.round(W / 140)));
  const lh = Math.round(fs * 1.5);
  const pad = fs;
  ctx.font = `${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const cols = sections.map(([name, s]) => ({
    title: name.toUpperCase(),
    lines: Object.entries(s).map(([key, v]) => `${key}: ${v}`),
  }));
  const colWidths = cols.map((c) => Math.max(
    ctx.measureText(c.title).width,
    ...c.lines.map((t) => ctx.measureText(t).width),
  ));
  const gap = fs * 2;
  const cardW = colWidths.reduce((a, b) => a + b, 0) + gap * (cols.length - 1) + pad * 2;
  const rows = 1 + Math.max(...cols.map((c) => c.lines.length));
  const cardH = rows * lh + pad * 2;
  const x = fs, y = H - cardH - fs;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = Math.max(1, fs / 12);
  ctx.beginPath();
  ctx.roundRect(x, y, cardW, cardH, fs * 0.75);
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = 1;
  let cx = x + pad;
  cols.forEach((c, i) => {
    ctx.fillStyle = "#64748b";
    ctx.fillText(c.title, cx, y + pad + fs);
    ctx.fillStyle = "#334155";
    c.lines.forEach((t, j) => ctx.fillText(t, cx, y + pad + fs + (j + 1) * lh));
    cx += colWidths[i] + gap;
  });
  ctx.restore();
}

async function exportPng() {
  if (!lastRenderedView) lastRenderedView = viewFor();
  const s = routeSettings();
  const svgText = viewToSvg(lastRenderedView, {
    routeOpts: currentRouteOpts(),
    edgeWidth: s.edgeWidth, arrowSize: s.arrowSize, arrowHollow: s.arrowHollow,
    edgeNormal: currentEdgeNormal,
    blobs: blobInput(),
    crop: EXPORT_PREFS.pngArea === "screen" ? screenCrop() : undefined,
  });
  // A screen capture always lands at twice the on-screen pixel size, whatever
  // the zoom; a full capture asks for 2× view units (capped inside svgToPng).
  const blob = await svgToPng(svgText, {
    scale: EXPORT_PREFS.pngArea === "screen" ? 2 * viewer.view().k : 2,
    annotate: EXPORT_PREFS.pngSettings ? settingsCaption : undefined,
  });
  downloadBlob(blob, exportName() + (EXPORT_PREFS.pngArea === "screen" ? "-screen" : "") + ".png");
}

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
// In Both, a state aspect node doubles as its hyperedge, so hovering it
// lights the record events behind it even with the overlays switched off.
const hyperIdOf = (el) => {
  if (!el) return null;
  if (el.classList.contains("hub")) return el.dataset.id;
  if (MODE === BOTH && ASPECTS[el.dataset.id]) return "hy:" + el.dataset.id;
  return null;
};
plane.addEventListener("mouseover", (e) => {
  const id = hyperIdOf(e.target.closest(".node"));
  if (id) highlight(id);
});
plane.addEventListener("mouseout", (e) => {
  if (hyperIdOf(e.target.closest(".node"))) highlight(null);
});

// ---- settings panel --------------------------------------------------------
function applyEdgeStyle() {
  const s = routeSettings(); // stroke width and arrowheads are one global style
  document.documentElement.style.setProperty("--edge-w", s.edgeWidth + "px");
  document.documentElement.style.setProperty("--bg-dots", MODE.settings.bgDots);
  applyArrow(document.getElementById("edges"), { size: s.arrowSize, hollow: s.arrowHollow, width: s.edgeWidth });
}

// The Record/State/Both toggle lives at the top of the panel; switching
// rebuilds the panel, so the segment is recreated with the right button on.
function setMode(next) {
  if (next === MODE) return;
  MODE = next;
  FOCUS = null; // focus is an overlay of the record; leaving clears it
  backEl.style.display = "none";
  highlight(null);
  applyEdgeStyle();
  buildPanel();
  render(true);
}

function modeSegment() {
  const seg = document.createElement("span");
  seg.className = "tp-seg";
  [[RECORD, "Record"], [STATE, "State"], [BOTH, "Both"]].forEach(([mode, label]) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.classList.toggle("on", mode === MODE);
    b.addEventListener("click", () => setMode(mode));
    seg.appendChild(b);
  });
  return seg;
}

let panel = null;
function buildPanel() {
  if (panel) panel.root.remove();
  const viewGroup = { title: "View", rows: [
    { type: "button", label: "Reset view", onClick: () => viewer.refit(),
      hint: "Re-fit the whole graph on screen" },
  ] };
  const exportGroup = { title: "Export", rows: [
    { type: "button", label: "Export SVG", onClick: exportSvg,
      hint: "Download the current view as an SVG file" },
    { type: "button", label: "Export .excalidraw", onClick: exportExcalidraw,
      hint: "Download the current view as an .excalidraw file" },
    { key: "pngArea", label: "png area", type: "segment", bind: EXPORT_PREFS,
      options: [{ value: "screen", label: "Screen" }, { value: "full", label: "Full" }] },
    { key: "pngSettings", label: "settings", type: "check", bind: EXPORT_PREFS },
    { type: "button", label: "Export PNG", onClick: exportPng,
      hint: "Download a PNG — the on-screen window or the whole graph, with the settings painted in if ticked" },
  ] };
  // Both draws each side with that side's own settings, so it only offers
  // the combined view's own knobs: overlays, motion, canvas.
  const groups = MODE === BOTH
    ? [
        viewGroup,
        { title: "Hyperedges", rows: MODE.hyperRows },
        { title: "Motion", rows: [
          { key: "durMs", label: "duration", type: "range", min: 100, max: 1400, step: 20 },
        ] },
        { title: "Canvas", rows: [
          { key: "bgDots", label: "dots", type: "range", min: 0, max: 1, step: 0.05 },
          { key: "mono", label: "b & w", type: "check" },
        ] },
        exportGroup,
      ]
    : [
        viewGroup,
        { title: "Layout", rows: MODE.layoutRows },
        ...(MODE.hyperRows ? [{ title: "Hyperedges", rows: MODE.hyperRows }] : []),
        { title: "Edges", rows: [...MODE.edgeRows, ...EDGE_SHARED_ROWS] },
        ...SHARED_ROWS,
        exportGroup,
      ];
  panel = createPanel({
    mount: stage,
    title: "⚙ Settings",
    top: modeSegment(),
    settings: MODE.settings,
    groups,
    onChange(key, discrete) {
      if (key === "pngArea" || key === "pngSettings") return; // export prefs: no repaint
      applyEdgeStyle();
      render(discrete); // the settle/debounce path refreshes the blobs
    },
  });
}

window.addEventListener("resize", () => viewer.refit(true));

applyEdgeStyle();
buildPanel();
render(false);
