// ===========================================================================
// A tuning panel: sliders and toggles bound to a live settings object, in the
// framework's visual style. Pages describe their controls as groups of rows;
// every change mutates the settings object and calls onChange(key, discrete),
// where `discrete` is true for toggles (worth animating) and false for slider
// drags (repaint instantly). Comes with Reset and Copy JSON, so a good set of
// values can be captured as the new defaults.
// ===========================================================================

const CSS = `
.tunepanel { position: absolute; top: 12px; right: 12px; z-index: 10; width: 252px;
  background: rgba(255,255,255,0.97); border: 1px solid #e2e8f0; border-radius: 12px;
  box-shadow: 0 4px 18px rgba(15,23,42,0.14); color: #0f172a;
  font: 12.5px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.tunepanel .tp-head { display: flex; align-items: center; justify-content: space-between;
  padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 700; cursor: pointer; }
.tunepanel .tp-head .tp-caret { color: #64748b; font-weight: 400; }
.tunepanel .tp-body { padding: 4px 12px 10px; max-height: min(66vh, 560px); overflow-y: auto; }
.tunepanel.closed .tp-body { display: none; }
.tunepanel .tp-title { margin: 10px 0 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: #64748b; }
.tunepanel .tp-row { display: flex; align-items: center; gap: 8px; margin: 5px 0; }
.tunepanel .tp-label { flex: 0 0 76px; color: #334155; }
.tunepanel input[type="range"] { flex: 1; min-width: 0; accent-color: #2563eb; }
.tunepanel .tp-val { flex: 0 0 38px; text-align: right; font-variant-numeric: tabular-nums; color: #0f172a; }
.tunepanel input[type="checkbox"] { accent-color: #2563eb; width: 15px; height: 15px; }
.tunepanel .tp-seg { display: inline-flex; border: 1px solid #cbd5e1; border-radius: 7px; overflow: hidden; }
.tunepanel .tp-seg button { border: 0; background: #fff; color: #334155; padding: 3px 10px;
  font: inherit; cursor: pointer; }
.tunepanel .tp-seg button + button { border-left: 1px solid #cbd5e1; }
.tunepanel .tp-seg button.on { background: #2563eb; color: #fff; }
.tunepanel .tp-top { display: flex; justify-content: center; padding: 10px 0 2px; }
.tunepanel .tp-top .tp-seg button { font-weight: 700; padding: 5px 14px; }
.tunepanel .tp-btn { display: block; width: 100%; margin: 6px 0; padding: 6px 0; border-radius: 7px;
  border: 1px solid #cbd5e1; background: #fff; color: #334155; font: inherit; font-weight: 600; cursor: pointer; }
.tunepanel .tp-btn:hover { background: #f1f5f9; }
.tunepanel .tp-foot { display: flex; gap: 8px; margin-top: 12px; }
.tunepanel .tp-foot button { flex: 1; padding: 6px 0; border-radius: 7px; border: 1px solid #cbd5e1;
  background: #fff; color: #334155; font: inherit; font-weight: 600; cursor: pointer; }
.tunepanel .tp-foot button:hover { background: #f1f5f9; }
.tunepanel .tp-json { margin: 8px 0 0; padding: 7px 8px; background: #f8fafc; border: 1px solid #e2e8f0;
  border-radius: 7px; font: 10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; color: #475569;
  white-space: pre-wrap; word-break: break-all; max-height: 120px; overflow-y: auto; }
`;

let styled = false;
function injectStyle() {
  if (styled) return;
  styled = true;
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
}

// groups: [{title, rows: [{key, label, type: "range"|"check"|"segment"|"button",
//                          min?, max?, step?, options?: [{value, label}],
//                          onClick?, hint?, bind?}]}]
// A row normally reads and writes settings[key]; `bind` points it at another
// object instead (UI state that does not belong in the settings JSON, like
// export preferences).
// `top` is an optional element mounted above the groups (e.g. a view toggle).
export function createPanel({ mount, groups, settings, onChange, title = "⚙ Tune", top = null }) {
  injectStyle();
  const defaults = JSON.parse(JSON.stringify(settings));
  const refreshers = [];

  const root = document.createElement("div");
  root.className = "tunepanel";
  const head = document.createElement("div");
  head.className = "tp-head";
  head.innerHTML = '<span></span><span class="tp-caret">▾</span>';
  head.querySelector("span").textContent = title;
  head.addEventListener("click", () => {
    root.classList.toggle("closed");
    head.querySelector(".tp-caret").textContent = root.classList.contains("closed") ? "▸" : "▾";
  });
  const body = document.createElement("div");
  body.className = "tp-body";
  root.append(head, body);
  if (top) {
    const wrap = document.createElement("div");
    wrap.className = "tp-top";
    wrap.appendChild(top);
    body.appendChild(wrap);
  }

  const json = document.createElement("pre");
  json.className = "tp-json";
  const updateJson = () => { json.textContent = JSON.stringify(settings, null, 1).replace(/\n\s*/g, " ").replace(/[{}]/g, "").trim(); };

  const fire = (key, discrete) => { updateJson(); onChange(key, discrete); };

  groups.forEach((group) => {
    const title = document.createElement("div");
    title.className = "tp-title";
    title.textContent = group.title;
    body.appendChild(title);

    group.rows.forEach((row) => {
      if (row.type === "button") {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "tp-btn";
        b.textContent = row.label;
        if (row.hint) b.title = row.hint;
        b.addEventListener("click", row.onClick);
        body.appendChild(b);
        return;
      }
      const store = row.bind ?? settings;
      const line = document.createElement("label");
      line.className = "tp-row";
      const label = document.createElement("span");
      label.className = "tp-label";
      label.textContent = row.label;
      line.appendChild(label);

      if (row.type === "range") {
        const input = document.createElement("input");
        input.type = "range";
        input.min = row.min; input.max = row.max; input.step = row.step ?? 1;
        const val = document.createElement("span");
        val.className = "tp-val";
        const show = () => { val.textContent = String(store[row.key]); };
        input.addEventListener("input", () => {
          store[row.key] = parseFloat(input.value);
          show();
          fire(row.key, false);
        });
        refreshers.push(() => { input.value = store[row.key]; show(); });
        line.append(input, val);
      } else if (row.type === "check") {
        const input = document.createElement("input");
        input.type = "checkbox";
        input.addEventListener("change", () => {
          store[row.key] = input.checked;
          fire(row.key, true);
        });
        refreshers.push(() => { input.checked = !!store[row.key]; });
        line.appendChild(input);
      } else if (row.type === "segment") {
        const seg = document.createElement("span");
        seg.className = "tp-seg";
        const buttons = row.options.map((opt) => {
          const b = document.createElement("button");
          b.type = "button";
          b.textContent = opt.label;
          b.addEventListener("click", (ev) => {
            ev.preventDefault();
            store[row.key] = opt.value;
            paint();
            fire(row.key, true);
          });
          seg.appendChild(b);
          return { b, opt };
        });
        const paint = () => buttons.forEach(({ b, opt }) => b.classList.toggle("on", store[row.key] === opt.value));
        refreshers.push(paint);
        line.appendChild(seg);
      }
      body.appendChild(line);
    });
  });

  const foot = document.createElement("div");
  foot.className = "tp-foot";
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";
  reset.addEventListener("click", () => {
    Object.assign(settings, JSON.parse(JSON.stringify(defaults)));
    refreshers.forEach((fn) => fn());
    fire("*", true);
  });
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = "Copy JSON";
  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(settings, null, 2));
      copy.textContent = "Copied ✓";
    } catch {
      copy.textContent = "Copy failed";
    }
    setTimeout(() => { copy.textContent = "Copy JSON"; }, 1200);
  });
  foot.append(reset, copy);
  body.append(foot, json);

  refreshers.forEach((fn) => fn());
  updateJson();
  mount.appendChild(root);
  return { root };
}

// Reshape the SVG arrowhead marker. `size` is the triangle's length in px;
// `hollow` draws it as an outline filled with the page background, so the
// line underneath does not show through it.
export function applyArrow(svg, { size, hollow, width }) {
  const marker = svg.querySelector("marker");
  const path = marker.querySelector("path");
  const h = size * 1.15;
  const pad = 3; // room for the outline stroke, so it does not clip
  marker.setAttribute("markerWidth", size + 2 * pad);
  marker.setAttribute("markerHeight", h + 2 * pad);
  marker.setAttribute("refX", size + pad);
  marker.setAttribute("refY", h / 2 + pad);
  path.setAttribute("d", `M${pad},${pad} L${size + pad},${h / 2 + pad} L${pad},${h + pad} z`);
  if (hollow) {
    path.setAttribute("fill", "#f8fafc");
    path.setAttribute("stroke", "#94a3b8");
    path.setAttribute("stroke-width", Math.max(1, width ?? 1.6));
    path.setAttribute("stroke-linejoin", "round");
  } else {
    path.setAttribute("fill", "#94a3b8");
    path.removeAttribute("stroke");
    path.removeAttribute("stroke-width");
  }
}
