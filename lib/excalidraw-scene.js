// ===========================================================================
// Excalidraw scene export: rebuild the current view as a real ExcalidrawFile
// via the excaligraph library — the static sibling of viewToSvg in export.js.
// Both take the same view + opts, and both draw from viewGeometry, so the
// hand-drawn render always matches the live screen: same boxes, same routed
// edge points, same blob outlines. The library lays down nodes, labels and
// arrows; then each arrow's geometry is overwritten with the screen's own
// route points, and the blobs are prepended as closed line elements.
// ===========================================================================

import { Graph, measureWidth, lineHeightFor } from "excaligraph";
import { viewGeometry, CLASS_STYLES, DEFAULT_STYLE } from "./export.js";

const BLOB_LABEL_FS = 12;

// view/opts exactly as viewToSvg: {routeOpts, edgeNormal, blobs, arrowHollow,
// edgeWidth}. Returns a Promise<ExcalidrawFile>.
export async function viewToScene(view, opts) {
  const { boxOf, routes, blobShapes } = viewGeometry(view, opts);

  // ---- nodes and edges through the library --------------------------------
  const g = new Graph({
    seed: "hypergraph",
    defaults: {
      edge: { routing: "straight", roundness: "round", gap: opts.routeOpts?.gap ?? 4 },
    },
  });

  const drawn = [];
  view.nodes.forEach((n) => {
    const b = boxOf(n.id);
    if (!b) return;
    const base = CLASS_STYLES[n.cls] || DEFAULT_STYLE;
    g.node(n.id, {
      label: n.label + (n.folded ? " ×" + n.hidden : ""),
      x: b.x, y: b.y, width: b.width, height: b.height,
      shape: n.shape === "ellipse" ? "ellipse" : "rectangle",
      fontSize: n.fs || 13,
      strokeColor: n.hue || base.stroke,
      backgroundColor: n.fill || base.fill,
      strokeWidth: base.width ?? 2,
      strokeStyle: base.dashed || n.folded ? "dashed" : "solid",
    });
    drawn.push(n.id);
  });
  const has = new Set(drawn);
  const drawnEdges = view.edges.filter((e) => has.has(e.source) && has.has(e.target));
  drawnEdges.forEach((e) => {
    g.edge(e.source, e.target, {
      endArrowhead: e.noArrow ? "none" : opts.arrowHollow ? "triangle_outline" : "triangle",
      strokeStyle: e.dashed ? "dashed" : "solid",
      strokeColor: e.stroke || "#94a3b8",
      strokeWidth: opts.edgeWidth ?? 2,
    });
  });

  const scene = await g.toFile();

  // ---- the screen's own arrow geometry ------------------------------------
  // Arrows appear in scene.elements in edge-insertion order; overwrite each
  // one's points with the route the live view drew.
  const arrows = scene.elements.filter((el) => el.type === "arrow");
  drawnEdges.forEach((e, i) => {
    const points = routes.get(e.id);
    const arrow = arrows[i];
    if (!points || !arrow) return;
    const [ox, oy] = points[0];
    const local = points.map(([x, y]) => [x - ox, y - oy]);
    arrow.x = ox;
    arrow.y = oy;
    arrow.points = local;
    arrow.width = Math.max(...local.map(([x]) => x)) - Math.min(...local.map(([x]) => x));
    arrow.height = Math.max(...local.map(([, y]) => y)) - Math.min(...local.map(([, y]) => y));
  });

  // ---- paint order: arrows under the node shapes, as on the screen --------
  scene.elements = [
    ...scene.elements.filter((el) => el.type === "arrow"),
    ...scene.elements.filter((el) => el.type !== "arrow"),
  ];

  // ---- blobs, underneath everything ---------------------------------------
  // Closed line elements from the screen's traced loops, plus a label above
  // each blob's top point — prepended so they sit under nodes and arrows.
  // Plain objects: the shared fields are copied from elements the Graph
  // produced, so they match whatever shape the library emits.
  if (blobShapes.length) {
    const lineTmpl = scene.elements.find((el) => el.type === "arrow") || {};
    const textTmpl = scene.elements.find((el) => el.type === "text") || {};
    const blobEls = [];
    blobShapes.forEach(({ h, loops, settings }, bi) => {
      loops.forEach((loop, li) => {
        const xs = loop.map(([x]) => x), ys = loop.map(([, y]) => y);
        const ox = loop[0][0], oy = loop[0][1];
        const points = [...loop, loop[0]].map(([x, y]) => [x - ox, y - oy]);
        blobEls.push({
          ...lineTmpl,
          id: "blob-" + h.id + "-" + li,
          type: "line",
          x: ox, y: oy, angle: 0,
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          points,
          strokeColor: h.hue,
          backgroundColor: h.fill,
          fillStyle: "solid",
          strokeWidth: 2,
          strokeStyle: "solid",
          opacity: Math.round(settings.opacity * 100),
          roundness: null,
          seed: 1000 + bi * 8 + li,
          boundElements: [],
          startBinding: null, endBinding: null,
          startArrowhead: null, endArrowhead: null,
        });
      });
      if (settings.labels && loops.length) {
        let top = loops[0][0];
        loops[0].forEach((p) => { if (p[1] < top[1]) top = p; });
        const family = textTmpl.fontFamily ?? 5;
        const w = measureWidth(h.label, BLOB_LABEL_FS, family);
        const lh = lineHeightFor(family) * BLOB_LABEL_FS;
        blobEls.push({
          ...textTmpl,
          id: "blob-label-" + h.id,
          type: "text",
          x: top[0] - w / 2, y: top[1] - 7 - lh, angle: 0,
          width: w, height: lh,
          text: h.label, originalText: h.label,
          fontSize: BLOB_LABEL_FS, fontFamily: family,
          strokeColor: h.hue,
          opacity: 100,
          textAlign: "center", verticalAlign: "top",
          containerId: null,
          seed: 2000 + bi,
          boundElements: [],
        });
      }
    });
    scene.elements = [...blobEls, ...scene.elements];
  }

  return scene;
}
