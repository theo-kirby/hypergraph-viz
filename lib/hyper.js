// ===========================================================================
// The blob overlay: draws one translucent bubble-set outline per hyperedge
// into its own SVG layer under the arrows. Blob tracing is too heavy for the
// per-frame paint, so the layer works on settled views only: transitions mark
// it stale (CSS fades it out) and the viewer's onSettle asks for a refresh,
// trailing-debounced so slider drags do not grind. A fingerprint of the
// inputs skips the trace entirely when nothing that shapes a blob has moved.
// ===========================================================================

import { blobOutline } from "./blob.js";

// Fixed tracing internals; the tunable knobs come in with the input.
const CLEARANCE = 14;   // px the boundary keeps away from a non-member
const RESOLUTION = 6;   // grid step for the contour
const TOLERANCE = 1.5;  // simplification tolerance
const MAX_POINTS = 96;  // cap on traced points per loop
const CORNER = 12;      // fillet radius, so the loops read as one smooth body
const SETTLE_MS = 120;  // trailing debounce after the viewer settles

// cfg: { svg, getInput() -> null | {hyper, boxes, settings}, onHover(id|null),
//        onClick(id) }
//   hyper: [{id, label, hue, fill, members: [visible node ids]}]
//   boxes: id -> {shape, box: {x, y, width, height}}  (plane coordinates)
//   settings: {padding, corridor, smoothing, opacity, labels}
export function createBlobLayer(cfg) {
  const { svg } = cfg;
  const els = {}; // hyperedge id -> {path, label}
  let fp = "";
  let timer = null;

  function markStale() {
    svg.classList.add("stale");
  }

  // Debounced entry point, wired to the viewer's onSettle.
  function settle() {
    clearTimeout(timer);
    timer = setTimeout(refresh, SETTLE_MS);
  }

  function fingerprint(input) {
    const round = (v) => Math.round(v * 2) / 2;
    const boxes = Object.entries(input.boxes).map(([id, s]) =>
      [id, round(s.box.x), round(s.box.y), round(s.box.width), round(s.box.height)].join(","));
    const sets = input.hyper.map((h) => h.id + ":" + h.members.join(","));
    return JSON.stringify([sets, boxes, input.settings]);
  }

  function refresh() {
    clearTimeout(timer);
    const input = cfg.getInput();
    if (!input) {
      svg.classList.add("off");
      fp = ""; // a hidden layer must retrace when it comes back
      return;
    }
    svg.classList.remove("off");
    const next = fingerprint(input);
    if (next !== fp) {
      fp = next;
      draw(input);
    }
    svg.classList.remove("stale");
  }

  function draw({ hyper, boxes, settings }) {
    const alive = new Set();
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
        smoothing: settings.smoothing, clearance: CLEARANCE,
        resolution: RESOLUTION, tolerance: TOLERANCE,
        maxPoints: MAX_POINTS, cornerRadius: CORNER,
      });
      if (!loops.length) return;
      alive.add(h.id);

      let rec = els[h.id];
      if (!rec) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", "blob");
        path.addEventListener("mouseenter", () => cfg.onHover && cfg.onHover(path._hid));
        path.addEventListener("mouseleave", () => cfg.onHover && cfg.onHover(null));
        path.addEventListener("click", () => cfg.onClick && cfg.onClick(path._hid));
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "blob-label");
        label.setAttribute("text-anchor", "middle");
        svg.append(path, label);
        rec = els[h.id] = { path, label };
      }
      rec.path._hid = h.id;
      // The fillets already rounded every corner, so plain line segments
      // render the loops faithfully; each loop is one closed subpath.
      rec.path.setAttribute("d", loops.map((loop) =>
        "M " + loop.map(([x, y]) => x + " " + y).join(" L ") + " Z").join(" "));
      rec.path.setAttribute("fill", h.fill);
      rec.path.setAttribute("fill-opacity", settings.opacity);
      rec.path.setAttribute("stroke", h.hue);
      rec.path.setAttribute("stroke-width", 2);

      // Label at the topmost traced point of the largest loop.
      if (settings.labels) {
        let top = loops[0][0];
        loops[0].forEach((p) => { if (p[1] < top[1]) top = p; });
        rec.label.textContent = h.label;
        rec.label.setAttribute("x", top[0]);
        rec.label.setAttribute("y", top[1] - 7);
        rec.label.setAttribute("fill", h.hue);
        rec.label.style.display = "";
      } else {
        rec.label.style.display = "none";
      }
    });

    Object.keys(els).forEach((id) => {
      if (alive.has(id)) return;
      els[id].path.remove();
      els[id].label.remove();
      delete els[id];
    });
  }

  return { markStale, settle, refresh };
}
