// ===========================================================================
// The bridge to hypergraph-protocol. A project's graphs reach us as the two
// JSON exports (`hypergraph export` → .hypergraph/cache/{record,state}.json),
// served by the dev server at /hg/ when HG_PROJECT points at the project.
// This module fetches them and reshapes them for app.js:
//   - each export's nodes + parent_ids       → edge pairs and labels
//   - each state node's cited record slugs   → its hyperedge on the record
// The citations live in the state node's markdown body — the `## Provenance`
// list, inline `[rec: <slug>]` marks, and `evidence: <slug>` fields — exactly
// the shapes templates/state-node.md defines.
// ===========================================================================

// One hue/fill pair per hyperedge, dealt in order (Open Color pastels, same
// family as the demo aspects).
const PALETTE = [
  { hue: "#e64980", fill: "#ffdeeb" },
  { hue: "#12b886", fill: "#c3fae8" },
  { hue: "#f59f00", fill: "#ffec99" },
  { hue: "#4263eb", fill: "#dbe4ff" },
  { hue: "#ae3ec9", fill: "#f3d9fa" },
  { hue: "#15aabf", fill: "#c5f6fa" },
  { hue: "#e8590c", fill: "#ffe8cc" },
  { hue: "#74b816", fill: "#e9fac8" },
];

const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// Export nodes → the (parentSlug, childSlug) pairs and per-slug labels that
// makeData consumes. Labels are truncated to fit the node shapes; the full
// title rides along for tooltips.
function graphOf(nodes, maxLabel) {
  const slugOf = new Map(nodes.map((n) => [n.node_id, n.slug_name]));
  const pairs = [];
  const labels = {};
  const titles = {};
  nodes.forEach((n) => {
    labels[n.slug_name] = truncate(n.title, maxLabel);
    titles[n.slug_name] = n.title;
    n.parent_ids.forEach((pid) => {
      const p = slugOf.get(pid);
      if (p) pairs.push([p, n.slug_name]);
    });
  });
  return { pairs, labels, titles };
}

// Every record slug a state node's body cites, in first-mention order.
function citedSlugs(content) {
  const out = [];
  const add = (slug) => { if (!out.includes(slug)) out.push(slug); };

  // The `## Provenance` section: "- <record-slug> — why" per line.
  const lines = content.split("\n");
  const start = lines.findIndex((l) => /^##\s+Provenance\b/.test(l));
  if (start !== -1) {
    for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
      const m = lines[i].match(/^\s*-\s*([a-z]+-[a-z]+-\d{4})\b/);
      if (m) add(m[1]);
    }
  }
  // Inline claim citations and negative-knowledge evidence fields.
  for (const m of content.matchAll(/\[rec:\s*([a-z]+-[a-z]+-\d{4})\s*\]/g)) add(m[1]);
  for (const m of content.matchAll(/evidence:\s*([a-z-]+-\d{4}(?:\s*,\s*[a-z-]+-\d{4})*)/g)) {
    m[1].split(",").forEach((s) => add(s.trim()));
  }
  return out;
}

// The two exports → what app.js renders. `aspects` is keyed by state slug, so
// a state node and its hyperedge share an id — that identity is what lets the
// Both view light the state node up when its blob is hovered.
export function fromExports(recordExport, stateExport) {
  const record = graphOf(recordExport.nodes, 44);
  const state = graphOf(stateExport.nodes, 44);
  const recordSlugs = new Set(recordExport.nodes.map((n) => n.slug_name));

  const aspects = {};
  let dealt = 0;
  stateExport.nodes.forEach((n) => {
    if (!n.parent_ids.length) return; // the state root distills, it doesn't cite
    const members = citedSlugs(n.content).filter((s) => recordSlugs.has(s));
    if (!members.length) return;
    const c = PALETTE[dealt++ % PALETTE.length];
    aspects[n.slug_name] = { label: truncate(n.title, 24), hue: c.hue, fill: c.fill, members };
  });

  return { record, state, aspects };
}

// null when no project is being served (no HG_PROJECT, or its cache is
// missing) — the caller falls back to the demo dataset.
export async function loadProject() {
  try {
    const [meta, record, state] = await Promise.all(
      ["meta", "record", "state"].map((f) =>
        fetch("/hg/" + f + ".json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(f)))),
      ),
    );
    return { name: meta.project, ...fromExports(record, state) };
  } catch {
    return null;
  }
}
