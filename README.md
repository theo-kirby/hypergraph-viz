# hypergraph-viz
visualization library for hypergraph-protocol

## Run

```
npm install
npm run dev
```

Without a project, a built-in demo dataset renders.

## Visualize a hypergraph project

Point the dev server at any project that runs the
[hypergraph protocol](https://github.com/theo-kirby/hypergraph-protocol):

```
HG_PROJECT=/path/to/project npm run dev
```

The server reads the project's graph exports —
`.hypergraph/cache/{record,state}.json`, written by `hypergraph export` (or
`hypergraph sync`) — and serves them to the app at `/hg/`. The record graph
renders from the nodes' causal parents; each state node's cited record slugs
(`## Provenance`, `[rec: …]`, `evidence: …`) become its hyperedge over the
record. Exports are re-read per request, so after new work lands just re-run
`hypergraph export` and refresh the page. If the cache is missing, the server
prints the export command to run and the app falls back to the demo.

## Use

- **Settings** panel (top right) — switch between the Record / State / Both views,
  adjust layout, edges, arrowheads, and blobs live, and export the current view
  as a standalone `.svg` or `.excalidraw` file.
- **Drag** to pan, **scroll** to zoom, **double-click** the background to re-fit.
- **Click** a node with children to fold or unfold its subtree.
- **Click** a blob or hub to focus that hyperedge. **Esc** goes back.
