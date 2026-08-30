# hypergraph-viz
visualization library for hypergraph-protocol

## Run

```
npm install
npm run dev
```

Without project data attached, a built-in demo shows.

## Attach a project / detach

The integration contract is hypergraph-protocol's JSON exports
(`.hypergraph/cache/{record,state}.json`, written by `hypergraph export`).
`make-viz-data.py` (stdlib-only) translates them into `data.local.js`, which
the viewer picks up automatically:

```
# in the project: refresh the exports
hypergraph export --config .hypergraph/config.yml

# here: attach (writes data.local.js — gitignored, per-machine)
python3 make-viz-data.py ~/path/to/project

# detach (the demo returns)
python3 make-viz-data.py --detach
```

Each outer state node becomes an aspect — a hyperedge over the record graph,
built from the `[rec: slug]` provenance references in its body.

## Use

- **Record / State** — switch between the two graphs (top left).
- **Drag** to pan, **scroll** to zoom, **double-click** the background to re-fit.
- **Click** a node with children to fold or unfold its subtree.
- **Click** a blob, hub, or legend chip to focus that hyperedge. **Esc** goes back.
- **Tune** panel (top right) — adjust layout, edges, arrowheads, and blobs live.
- **Export SVG** (bottom right) — download the current view as a standalone `.svg` file.
