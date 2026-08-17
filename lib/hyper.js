// ===========================================================================
// The blob overlay: draws one translucent bubble-set outline per hyperedge
// into its own SVG layer under the arrows. Blob tracing is too heavy for the
// per-frame paint, so the layer works on settled views only: transitions mark
// it stale (CSS fades it out) and the viewer's onSettle asks for a refresh,
// trailing-debounced so slider drags do not grind. A fingerprint of the
// inputs skips the trace entirely when nothing that shapes a blob has moved.
// The trace itself runs in a Web Worker (blob-worker.js), so it never blocks
// the main thread; the layer fades back in when the worker answers. If the
// worker cannot start, tracing falls back to the main thread.
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
  let gen = 0; // refresh generation; stale worker answers are dropped

  // ---- the tracer: a worker when possible, inline otherwise ---------------
  let worker = null;
  let workerBroken = false;
  let jobId = 0;
  const pending = new Map(); // job id -> callback(results | null)
  function traceAll(jobs, done) {
    if (!workerBroken && !worker) {
      try {
        worker = new Worker(new URL("./blob-worker.js", import.meta.url), { type: "module" });
        worker.onmessage = (e) => {
          const cb = pending.get(e.data.id);
          pending.delete(e.data.id);
          if (cb) cb(e.data.results);
        };
        worker.onerror = () => {
          // The worker could not boot (or died): finish every waiting job on
          // the main thread and stop trying.
          workerBroken = true;
          worker.terminate();
          worker = null;
          const waiting = [...pending.values()];
          pending.clear();
          waiting.forEach((cb) => cb(null));
        };
      } catch {
        workerBroken = true;
      }
    }
    if (workerBroken) {
      done(jobs.map((job) => blobOutline(job)));
      return;
    }
    const id = ++jobId;
    pending.set(id, (results) => {
      done(results ?? jobs.map((job) => blobOutline(job)));
    });
    worker.postMessage({ id, jobs });
  }

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
    // Colours are part of the identity: the b&w toggle changes hue/fill with
    // the boxes untouched, and the paths must repaint.
    const sets = input.hyper.map((h) => [h.id, h.hue, h.fill, h.members.join(",")].join("|"));
    return JSON.stringify([sets, boxes, input.settings]);
  }

  function requestFor(h, { boxes, settings }) {
    const members = h.members.map((id) => boxes[id]).filter(Boolean);
    const memberSet = new Set(h.members);
    const avoid = Object.entries(boxes)
      .filter(([id]) => !memberSet.has(id))
      .map(([, s]) => s);
    return {
      members, avoid,
      padding: settings.padding, corridor: settings.corridor,
      smoothing: settings.smoothing, clearance: CLEARANCE,
      resolution: RESOLUTION, tolerance: TOLERANCE,
      maxPoints: MAX_POINTS, cornerRadius: CORNER,
    };
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
    if (next === fp) {
      svg.classList.remove("stale");
      return;
    }
    const my = ++gen;
    const jobs = input.hyper.map((h) => requestFor(h, input));
    traceAll(jobs, (results) => {
      if (my !== gen) return; // a newer refresh superseded this one
      fp = next;
      draw(input, results);
      svg.classList.remove("stale");
    });
  }

  function draw({ hyper, settings }, results) {
    const alive = new Set();
    hyper.forEach((h, i) => {
      const loops = results[i];
      if (!loops || !loops.length) return;
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
