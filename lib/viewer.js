// ===========================================================================
// The animation engine from main.js, generalized: per-node sizes and shapes,
// branch-routed edges redrawn each frame, and fold/unfold anchored on the
// nearest ancestor instead of a single centroid. Pages give it views
// ({nodes, edges, pos}) and it animates between them, refitting the stage.
// ===========================================================================

import { routeEdges, roundedPathD } from "./excaligraph.js";

function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const fx = (t) => ((ax * t + bx) * t + cx) * t, fy = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => { let t = x; for (let i = 0; i < 6; i++) { const e = fx(t) - x, d = (3 * ax * t + 2 * bx) * t + cx; if (Math.abs(e) < 1e-4 || d === 0) break; t -= e / d; } return fy(Math.max(0, Math.min(1, t))); };
}
const lerp = (a, b, t) => a + (b - a) * t;

// cfg: { stage, plane, svg, parentOf(id), decorate(el, node), onNodeClick(id, node),
//        edgeNormal?(edge, boxOf) -> [nx, ny] | null   — the way a branch arrow
//          leaves its source (a radial page returns the node's own radial line;
//          null falls back to the tree behaviour: the side facing the target),
//        routeOpts?() -> {gap, radius, lean, spread}   — live routing overrides,
//        onSettle?()   — called when a transition finishes (heavy overlays
//          such as the hyperedge blobs recompute here, never per frame),
//        stagePad?, durMs? (number or () => number), bezier? }
// Views: { nodes: [{id, w, h, shape?, ...}], edges: [{id, source, target}], pos: {id: {cx, cy}} }
export function createViewer(cfg) {
  const { stage, plane, svg } = cfg;
  const stagePad = cfg.stagePad ?? 48;
  const durOf = () => (typeof cfg.durMs === "function" ? cfg.durMs() : cfg.durMs) ?? 520;
  const ease = cubicBezier(...(cfg.bezier ?? [0.4, 0, 0.2, 1]));

  let cur = {};        // id -> {cx, cy, s, o}  (live rendered positions)
  let lastEdges = [];  // edges from the last committed view
  let lastView = null;
  let generation = 0;  // bumped per transition; stale frames bail
  let curView = { k: 1, x: 0, y: 0 };
  let userAdjusted = false; // set on manual pan/zoom; stops auto-fit fighting the user
  const nodeEls = {}, edgeEls = {};

  function tween(step, done) {
    const my = ++generation, t0 = performance.now(), durMs = Math.max(1, durOf());
    (function frame(now) {
      if (my !== generation) return;
      const raw = Math.min(1, (now - t0) / durMs);
      step(ease(raw));
      if (raw < 1) requestAnimationFrame(frame);
      else if (done) done();
    })(t0);
  }

  function ensureNode(id, n) {
    let el = nodeEls[id];
    if (!el) {
      el = document.createElement("div");
      el.addEventListener("click", () => cfg.onNodeClick && cfg.onNodeClick(id, el._meta));
      plane.appendChild(el);
      nodeEls[id] = el;
    }
    el._meta = n;
    el.style.width = n.w + "px";
    el.style.height = n.h + "px";
    cfg.decorate(el, n);
    return el;
  }
  function ensureEdge(e) {
    let el = edgeEls[e.id];
    if (!el) {
      el = document.createElementNS("http://www.w3.org/2000/svg", "path");
      el.setAttribute("class", "edge");
      svg.appendChild(el);
      edgeEls[e.id] = el;
    }
    // An edge record may carry its own styling (hyperedge spokes: coloured,
    // dashed, no arrowhead); plain records reset to the stylesheet defaults.
    el.style.stroke = e.stroke || "";
    el.style.strokeDasharray = e.dashed ? "7 7" : "";
    if (e.noArrow) el.removeAttribute("marker-end");
    else el.setAttribute("marker-end", "url(#arrow)");
    return el;
  }
  // Nodes sit at 0,0 and move by transform: translate composites on the GPU,
  // so a transition animates without re-rasterising every node every frame
  // (left/top would repaint the whole plane per frame — a visible freeze on
  // large canvases and Retina screens). Same geometry: with the 50% 50%
  // transform-origin, translate puts the centre at (cx, cy) and scale works
  // around it, exactly as left/top + scale did.
  function placeNode(el, c, n) {
    el.style.transform = `translate(${c.cx - n.w / 2}px, ${c.cy - n.h / 2}px) scale(${c.s})`;
    el.style.opacity = c.o;
  }

  // ---- fit-to-view ---------------------------------------------------------
  function bboxOf(view, nodeById) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    Object.entries(view.pos).forEach(([id, p]) => {
      const n = nodeById[id];
      x0 = Math.min(x0, p.cx - n.w / 2); y0 = Math.min(y0, p.cy - n.h / 2);
      x1 = Math.max(x1, p.cx + n.w / 2); y1 = Math.max(y1, p.cy + n.h / 2);
    });
    return { minX: x0, minY: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }
  function computeFit(bbox) {
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const k = Math.max(0.3, Math.min(1.4, (sw - 2 * stagePad) / bbox.w, (sh - 2 * stagePad) / bbox.h));
    return { k, x: (sw - bbox.w * k) / 2 - bbox.minX * k, y: (sh - bbox.h * k) / 2 - bbox.minY * k };
  }
  function applyView(v) { curView = v; plane.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.k})`; }
  function sizeSvg(bbox) {
    // Layout coordinates may be negative (the radial root is pinned at the
    // origin); overflow is visible, so the size only needs to be valid.
    svg.setAttribute("width", Math.max(1, Math.ceil(bbox.minX + bbox.w + 200)));
    svg.setAttribute("height", Math.max(1, Math.ceil(bbox.minY + bbox.h + 200)));
  }

  // ---- fold anchors: the nearest ancestor with a position ------------------
  const anchorIn = (id, table) => {
    for (let a = cfg.parentOf(id); a !== undefined && a !== null; a = cfg.parentOf(a)) {
      if (table[a]) return table[a];
    }
    return null;
  };

  // ---- the one transition --------------------------------------------------
  function transition(view, animate) {
    lastView = view;
    const nodeById = {};
    view.nodes.forEach((n) => { nodeById[n.id] = n; });
    const bbox = bboxOf(view, nodeById);
    sizeSvg(bbox);
    const fromView = { ...curView };
    const toView = userAdjusted ? { ...curView } : computeFit(bbox);

    const targetIds = Object.keys(view.pos);
    const leavingIds = Object.keys(cur).filter((id) => !(id in view.pos));

    const ntracks = [];
    targetIds.forEach((id) => {
      const n = nodeById[id];
      const el = ensureNode(id, n);
      const to = { cx: view.pos[id].cx, cy: view.pos[id].cy, s: 1, o: 1 };
      let from;
      if (id in cur) from = { ...cur[id] };
      else {
        // New nodes fan out from the ancestor they were folded into.
        const a = anchorIn(id, cur) || anchorIn(id, view.pos);
        from = a ? { cx: a.cx, cy: a.cy, s: 0.3, o: 0 } : { ...to, o: 0 };
      }
      ntracks.push({ id, el, from, to, n });
    });
    leavingIds.forEach((id) => {
      const el = nodeEls[id];
      if (!el) return;
      const from = { ...cur[id] };
      // Leaving nodes fold into the ancestor that stays visible.
      const a = anchorIn(id, view.pos) || anchorIn(id, cur);
      const to = a ? { cx: a.cx, cy: a.cy, s: 0.3, o: 0 } : { ...from, o: 0 };
      ntracks.push({ id, el, from, to, n: el._meta, remove: true });
    });

    const targetEdgeIds = new Set(view.edges.map((e) => e.id));
    const drawEdges = [...view.edges];
    const etracks = view.edges.map((e) => ({
      e, el: ensureEdge(e),
      oFrom: lastEdges.some((p) => p.id === e.id) ? 1 : 0, oTo: 1,
    }));
    lastEdges.forEach((e) => {
      if (!targetEdgeIds.has(e.id) && edgeEls[e.id]) {
        drawEdges.push(e);
        etracks.push({ e, el: edgeEls[e.id], oFrom: 1, oTo: 0, remove: e.id });
      }
    });

    const metaOf = (id) => nodeById[id] || (nodeEls[id] && nodeEls[id]._meta);
    const boxOf = (id) => {
      const c = cur[id], n = metaOf(id);
      if (!c || !n) return null;
      const s = c.s ?? 1, w = n.w * s, h = n.h * s;
      if (w < 1 || h < 1) return null;
      return { x: c.cx - w / 2, y: c.cy - h / 2, width: w, height: h, shape: n.shape };
    };

    function paint(t) {
      applyView({ k: lerp(fromView.k, toView.k, t), x: lerp(fromView.x, toView.x, t), y: lerp(fromView.y, toView.y, t) });
      ntracks.forEach((tr) => {
        const c = {
          cx: lerp(tr.from.cx, tr.to.cx, t), cy: lerp(tr.from.cy, tr.to.cy, t),
          s: lerp(tr.from.s ?? 1, tr.to.s ?? 1, t), o: lerp(tr.from.o ?? 1, tr.to.o ?? 1, t),
        };
        placeNode(tr.el, c, tr.n);
        cur[tr.id] = c;
      });
      // Re-route the whole edge set from the live boxes, so the branch fans
      // and turns stay attached mid-flight.
      const routes = routeEdges(
        drawEdges, boxOf,
        cfg.edgeNormal ? (e) => cfg.edgeNormal(e, boxOf) : null,
        cfg.routeOpts ? cfg.routeOpts() : undefined,
      );
      etracks.forEach((tr) => {
        const pts = routes.get(tr.e.id);
        const o = lerp(tr.oFrom, tr.oTo, t);
        if (pts) tr.el.setAttribute("d", roundedPathD(pts));
        tr.el.style.opacity = String(pts ? o : 0);
      });
    }
    function finalize() {
      ntracks.forEach((tr) => { if (tr.remove) { tr.el.remove(); delete nodeEls[tr.id]; delete cur[tr.id]; } });
      etracks.forEach((tr) => { if (tr.remove) { tr.el.remove(); delete edgeEls[tr.remove]; } });
      lastEdges = view.edges.slice();
      if (cfg.onSettle) cfg.onSettle();
    }

    if (!animate) { generation++; paint(1); finalize(); }
    else tween(paint, finalize);
  }

  // autoOnly: only refit when the user has not taken the view over manually
  // (used by the window-resize handler).
  function refit(autoOnly = false) {
    if (autoOnly && userAdjusted) return;
    if (!lastView) return;
    const nodeById = {};
    lastView.nodes.forEach((n) => { nodeById[n.id] = n; });
    const bbox = bboxOf(lastView, nodeById);
    sizeSvg(bbox);
    applyView(computeFit(bbox));
  }

  // ---- pan / zoom ----------------------------------------------------------
  // Drag the background to pan, scroll or pinch to zoom at the cursor,
  // double-click the background to re-fit (which hands the view back to
  // auto-fit). Nodes and the tune panel keep their own pointer behaviour.
  // Buttons (the Back toggle, panel controls) and blobs keep their clicks:
  // starting a pan on them would capture the pointer and swallow the click.
  const onCanvas = (e) => !e.target.closest(".node, .tunepanel, button, .blob");
  stage.style.touchAction = "none";
  stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !onCanvas(e)) return;
    const sx = e.clientX, sy = e.clientY, v0 = { ...curView };
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("panning");
    // A plain click is not a pan: auto-fit stays in charge until the pointer
    // actually travels.
    const move = (ev) => {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 3) userAdjusted = true;
      applyView({ k: v0.k, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy });
    };
    const up = () => {
      stage.removeEventListener("pointermove", move);
      stage.removeEventListener("pointerup", up);
      stage.removeEventListener("pointercancel", up);
      stage.classList.remove("panning");
    };
    stage.addEventListener("pointermove", move);
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
  });
  stage.addEventListener("wheel", (e) => {
    if (e.target.closest(".tunepanel")) return; // let the panel scroll itself
    e.preventDefault();
    userAdjusted = true;
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    // Trackpad pinch arrives as ctrl+wheel with small deltas; give it more bite.
    const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    const k = Math.max(0.15, Math.min(5, curView.k * factor));
    const r = k / curView.k;
    applyView({ k, x: mx - (mx - curView.x) * r, y: my - (my - curView.y) * r });
  }, { passive: false });
  stage.addEventListener("dblclick", (e) => {
    if (!onCanvas(e)) return;
    userAdjusted = false;
    refit();
  });

  return { transition, refit };
}
