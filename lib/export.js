// ===========================================================================
// SVG export: rebuild the current view — blobs, edges, arrowheads, nodes and
// labels — as one standalone SVG string, then hand it to the browser as a
// download. The geometry comes from the same code that paints the screen
// (routeEdges / roundedPathD / blobOutline), so the file matches the view
// exactly; only the node chrome (colours, corner radii, text wrapping) is
// replicated here from the stylesheet, because the live nodes are DOM divs.
// ===========================================================================

import { routeEdges, roundedPathD } from "./excaligraph.js";
import { blobOutline } from "./blob.js";

const BG = "#f8fafc";
const EDGE_STROKE = "#94a3b8";
const TEXT_COLOR = "#0f172a";
const FONT_FAMILY = `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
const PAD = 32; // margin around the drawing, in px

// One entry per node class in index.html; hue/fill on the node override these.
// Shared with the Excalidraw scene builder (excalidraw-scene.js).
export const CLASS_STYLES = {
  r0: { stroke: "#7c3aed", fill: "#d0bfff", width: 3 },
  r1: { stroke: "#339af0", fill: "#a5d8ff" },
  r2: { stroke: "#22b8cf", fill: "#99e9f2" },
  r3: { stroke: "#40c057", fill: "#b2f2bb" },
  r4: { stroke: "#f59f00", fill: "#ffec99" },
  g0: { stroke: "#7c3aed", fill: "#d0bfff", width: 3 },
  g1: { stroke: "#339af0", fill: "#a5d8ff" },
  g2: { stroke: "#40c057", fill: "#b2f2bb" },
  hub: { stroke: "#93c5fd", fill: "#fff", width: 2, dashed: true },
};
export const DEFAULT_STYLE = { stroke: "#93c5fd", fill: "#fff", width: 2 };

// Same fixed tracing internals as the on-screen blob layer (hyper.js).
const BLOB_CLEARANCE = 14;
const BLOB_RESOLUTION = 6;
const BLOB_TOLERANCE = 1.5;
const BLOB_MAX_POINTS = 96;
const BLOB_CORNER = 12;

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");
const f = (v) => (Math.round(v * 10) / 10).toString();

// Wrap a label the way the flexbox node does: measured, greedy, centred.
const measureCtx = document.createElement("canvas").getContext("2d");
function wrapLabel(text, fs, maxWidth) {
  measureCtx.font = `600 ${fs}px ${FONT_FAMILY}`;
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((w) => {
    const probe = line ? line + " " + w : w;
    if (line && measureCtx.measureText(probe).width > maxWidth) {
      lines.push(line);
      line = w;
    } else line = probe;
  });
  if (line) lines.push(line);
  return lines.length ? lines : [String(text)];
}

// The geometry of a view, from the same engines that paint the screen:
// per-node boxes, routed edge points, and traced blob outlines. Shared by the
// SVG export below and the Excalidraw scene builder (excalidraw-scene.js), so
// both files always match the screen.
// view: {nodes, edges, pos, hyper} as produced by the page's viewFor().
// opts: {
//   routeOpts: {style, gap, radius, lean, spread, originSpread, bowScale},
//   edgeNormal?(edge, boxOf) -> [nx, ny] | null,
//   blobs?: null | {hyper, boxes, settings: {padding, corridor, smoothing,
//                   opacity, labels}}   — same input the blob layer takes,
// }
export function viewGeometry(view, opts) {
  const nodeById = {};
  view.nodes.forEach((n) => { nodeById[n.id] = n; });

  const boxOf = (id) => {
    const n = nodeById[id], p = view.pos[id];
    if (!n || !p) return null;
    return { x: p.cx - n.w / 2, y: p.cy - n.h / 2, width: n.w, height: n.h, shape: n.shape };
  };

  const routes = routeEdges(
    view.edges, boxOf,
    opts.edgeNormal ? (e) => opts.edgeNormal(e, boxOf) : null,
    opts.routeOpts,
  );

  const blobShapes = [];
  if (opts.blobs) {
    const { hyper, boxes, settings } = opts.blobs;
    hyper.forEach((h) => {
      const members = h.members.map((id) => boxes[id]).filter(Boolean);
      if (!members.length) return;
      const memberSet = new Set(h.members);
      const avoid = Object.entries(boxes)
        .filter(([id]) => !memberSet.has(id))
        .map(([, s]) => s);
      const loops = blobOutline({
        members, avoid,
        padding: settings.padding, corridor: settings.corridor,
        smoothing: settings.smoothing, clearance: BLOB_CLEARANCE,
        resolution: BLOB_RESOLUTION, tolerance: BLOB_TOLERANCE,
        maxPoints: BLOB_MAX_POINTS, cornerRadius: BLOB_CORNER,
      });
      if (loops.length) blobShapes.push({ h, loops, settings });
    });
  }

  return { boxOf, routes, blobShapes };
}

// view/opts as viewGeometry, plus {edgeWidth, arrowSize, arrowHollow} and an
// optional crop: {x, y, width, height} in view coordinates — the file then
// frames exactly that window (the on-screen viewport, say) instead of the
// whole drawing, clipping whatever crosses its edge.
export function viewToSvg(view, opts) {
  const { boxOf, routes, blobShapes } = viewGeometry(view, opts);

  // ---- bounding box over everything the file will contain -----------------
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  view.nodes.forEach((n) => {
    const b = boxOf(n.id);
    if (!b) return;
    grow(b.x, b.y); grow(b.x + b.width, b.y + b.height);
  });
  routes.forEach((pts) => pts.forEach(([x, y]) => grow(x, y)));
  blobShapes.forEach(({ loops }) => loops.forEach((loop) => loop.forEach(([x, y]) => grow(x, y))));
  if (x0 > x1) { x0 = 0; y0 = 0; x1 = 1; y1 = 1; }
  x0 -= PAD; y0 -= PAD; x1 += PAD; y1 += PAD;
  if (opts.crop) {
    x0 = opts.crop.x; y0 = opts.crop.y;
    x1 = opts.crop.x + opts.crop.width; y1 = opts.crop.y + opts.crop.height;
  }
  const width = Math.ceil(x1 - x0), height = Math.ceil(y1 - y0);

  // ---- assemble, in the on-screen paint order: blobs, edges, nodes --------
  const out = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${width} ${height}" ` +
    `width="${width}" height="${height}" font-family="${esc(FONT_FAMILY)}">`,
  );

  // Arrowhead marker, mirroring applyArrow in panel.js.
  const size = opts.arrowSize, mh = size * 1.15, mpad = 3;
  const markerPath = opts.arrowHollow
    ? `<path d="M${mpad},${mpad} L${size + mpad},${mh / 2 + mpad} L${mpad},${mh + mpad} z" ` +
      `fill="${BG}" stroke="${EDGE_STROKE}" stroke-width="${Math.max(1, opts.edgeWidth)}" stroke-linejoin="round"/>`
    : `<path d="M${mpad},${mpad} L${size + mpad},${mh / 2 + mpad} L${mpad},${mh + mpad} z" fill="${EDGE_STROKE}"/>`;
  out.push(
    `<defs><marker id="arrow" markerWidth="${size + 2 * mpad}" markerHeight="${mh + 2 * mpad}" ` +
    `refX="${size + mpad}" refY="${mh / 2 + mpad}" orient="auto" markerUnits="userSpaceOnUse">` +
    markerPath + `</marker></defs>`,
  );

  out.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${width}" height="${height}" fill="${BG}"/>`);

  // Blobs, then their labels (labels sit in the same under-the-arrows layer).
  blobShapes.forEach(({ h, loops, settings }) => {
    const d = loops.map((loop) => "M " + loop.map(([x, y]) => x + " " + y).join(" L ") + " Z").join(" ");
    out.push(
      `<path d="${d}" fill="${h.fill}" fill-opacity="${settings.opacity}" stroke="${h.hue}" stroke-width="2"/>`,
    );
    if (settings.labels) {
      let top = loops[0][0];
      loops[0].forEach((p) => { if (p[1] < top[1]) top = p; });
      out.push(
        `<text x="${f(top[0])}" y="${f(top[1] - 7)}" text-anchor="middle" ` +
        `font-size="12" font-weight="700" fill="${h.hue}" ` +
        `stroke="${BG}" stroke-width="3" paint-order="stroke">${esc(h.label)}</text>`,
      );
    }
  });

  view.edges.forEach((e) => {
    const pts = routes.get(e.id);
    if (!pts) return;
    const attrs = [
      `d="${roundedPathD(pts)}"`,
      `fill="none"`,
      `stroke="${e.stroke || EDGE_STROKE}"`,
      `stroke-width="${opts.edgeWidth}"`,
    ];
    if (e.dashed) attrs.push(`stroke-dasharray="7 7"`);
    if (!e.noArrow) attrs.push(`marker-end="url(#arrow)"`);
    out.push(`<path ${attrs.join(" ")}/>`);
  });

  view.nodes.forEach((n) => {
    const b = boxOf(n.id);
    if (!b) return;
    const base = CLASS_STYLES[n.cls] || DEFAULT_STYLE;
    const stroke = n.hue || base.stroke;
    const fill = n.fill || base.fill;
    const bw = base.width ?? 2;
    const dashed = base.dashed || n.folded;
    const dash = dashed ? ` stroke-dasharray="6 5"` : "";
    if (n.shape === "ellipse") {
      out.push(
        `<ellipse cx="${f(b.x + b.width / 2)}" cy="${f(b.y + b.height / 2)}" ` +
        `rx="${f(b.width / 2)}" ry="${f(b.height / 2)}" ` +
        `fill="${fill}" stroke="${stroke}" stroke-width="${bw}"${dash}/>`,
      );
    } else {
      // .node radius 10; a hub is a pill (radius clamps to half the height).
      const rx = n.cls === "hub" ? b.height / 2 : 10;
      out.push(
        `<rect x="${f(b.x)}" y="${f(b.y)}" width="${f(b.width)}" height="${f(b.height)}" ` +
        `rx="${f(rx)}" fill="${fill}" stroke="${stroke}" stroke-width="${bw}"${dash}/>`,
      );
    }

    const label = n.label + (n.folded ? " ×" + n.hidden : "");
    const fs = n.fs || 13;
    const maxWidth = n.shape === "ellipse" ? b.width * 0.85 : b.width - 16;
    const lines = wrapLabel(label, fs, maxWidth);
    const lineH = fs * 1.15;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const spans = lines.map((line, i) => {
      const y = cy + (i - (lines.length - 1) / 2) * lineH;
      return `<tspan x="${f(cx)}" y="${f(y)}">${esc(line)}</tspan>`;
    }).join("");
    out.push(
      `<text text-anchor="middle" dominant-baseline="central" ` +
      `font-size="${fs}" font-weight="600" fill="${TEXT_COLOR}">${spans}</text>`,
    );
  });

  out.push(`</svg>`);
  return out.join("\n");
}

// ---- PNG rasterization -----------------------------------------------------
// Draw an SVG string (one of ours: fixed width/height attributes) onto a
// canvas and encode a PNG. `scale` asks for extra resolution; it is capped so
// the canvas stays inside browser limits, whatever the graph's size. The
// optional annotate(ctx, width, height, scale) hook draws over the finished
// image — the settings caption uses it.
const PNG_MAX_DIM = 8000;
export function svgToPng(svgText, { scale = 2, annotate } = {}) {
  const m = svgText.match(/width="(\d+)" height="(\d+)"/);
  if (!m) return Promise.reject(new Error("no size in svg"));
  const w = +m[1], h = +m[2];
  const k = Math.min(scale, PNG_MAX_DIM / Math.max(w, h));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * k));
      canvas.height = Math.max(1, Math.round(h * k));
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      if (annotate) annotate(ctx, canvas.width, canvas.height, k);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG encode failed"))), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("SVG rasterize failed")); };
    img.src = url;
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadFile(text, filename, type) {
  downloadBlob(new Blob([text], { type }), filename);
}

export function downloadSvg(svgText, filename) {
  downloadFile(svgText, filename, "image/svg+xml");
}
