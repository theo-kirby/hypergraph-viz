// ===========================================================================
// A tiny on-screen performance readout, for hunting jank on the machine that
// actually shows it. Displays, per interaction:
//   click→screen  — Event Timing API: from the click to the frame that shows
//                   its effect, including raster/present time. Catches
//                   compositor stalls the main thread never sees.
//   block         — Long Animation Frames: main-thread blocks with script
//                   attribution (file + function), so third-party/extension
//                   code shows up by name.
// Mounted unconditionally for now; cheap when idle. Toggle with the P key.
// ===========================================================================

export function mountPerfHud() {
  const el = document.createElement("div");
  el.id = "perfhud";
  el.style.cssText =
    "position:absolute;left:50%;bottom:12px;transform:translateX(-50%);z-index:40;" +
    "background:rgba(15,23,42,0.88);color:#e2e8f0;border-radius:8px;padding:6px 12px;" +
    "font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;pointer-events:none;" +
    "white-space:pre;max-width:90vw;overflow:hidden;";
  el.textContent = "perf: waiting for a click…";
  document.body.appendChild(el);
  window.addEventListener("keydown", (e) => {
    if (e.key === "p" || e.key === "P") el.style.display = el.style.display === "none" ? "" : "none";
  });

  const t0 = performance.now();
  const log = [];
  const show = () => { el.textContent = log.slice(-5).join("\n") || "perf: waiting…"; };
  const stamp = () => ((performance.now() - t0) / 1000).toFixed(1) + "s";

  // Input → presented frame, includes raster/compositor time.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.name !== "click") continue;
        if (e.duration < 80) continue;
        log.push(`${stamp()}  click→screen ${Math.round(e.duration)}ms`);
        show();
      }
    }).observe({ type: "event", durationThreshold: 16 });
  } catch { /* older browser */ }

  // Main-thread blocks, with the script that caused them.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration < 100) continue;
        const s = (e.scripts || []).slice().sort((a, b) => b.duration - a.duration)[0];
        const src = s
          ? `${(s.sourceURL || s.name || "?").split("/").slice(-1)[0].split("?")[0]}` +
            (s.sourceFunctionName ? `:${s.sourceFunctionName}` : "") +
            ` ${Math.round(s.duration)}ms`
          : "no script (style/layout)";
        log.push(`${stamp()}  main-thread block ${Math.round(e.duration)}ms → ${src}`);
        show();
      }
    }).observe({ type: "long-animation-frame" });
  } catch { /* older browser */ }
}
