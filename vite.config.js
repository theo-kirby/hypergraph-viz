// The app imports the excaligraph library ("excaligraph" → the built dist of
// the sibling checkout) for the .excalidraw scene export.
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const EXCALIGRAPH_DIST = "/Users/theo/excaligraph/dist";

// ---- hypergraph-protocol project serving -----------------------------------
// HG_PROJECT=/path/to/project npm run dev
// Serves the project's graph exports (.hypergraph/cache/{record,state}.json —
// written by `hypergraph export` / `hypergraph sync`) at /hg/, plus a tiny
// /hg/meta.json with the project name from .hypergraph/config.yml. Files are
// read per request, so re-exporting and refreshing the page picks up new
// nodes. Without HG_PROJECT the app falls back to its built-in demo dataset.
function hgProject() {
  const dir = process.env.HG_PROJECT;
  if (!dir) return null;
  const root = resolve(dir.replace(/^~(?=\/|$)/, process.env.HOME || "~"));
  const cache = join(root, ".hypergraph", "cache");
  if (!existsSync(join(root, ".hypergraph"))) {
    throw new Error(`HG_PROJECT=${dir}: no .hypergraph/ directory — not a hypergraph project?`);
  }
  let project = basename(root);
  try {
    const m = readFileSync(join(root, ".hypergraph", "config.yml"), "utf8").match(/^project:\s*(.+)$/m);
    if (m) project = m[1].trim();
  } catch { /* keep the directory name */ }
  if (!existsSync(join(cache, "record.json")) || !existsSync(join(cache, "state.json"))) {
    console.warn(
      `[hypergraph] ${project}: no exports in ${cache} — run \`hypergraph export --config ` +
      `${join(root, ".hypergraph", "config.yml")}\` (or \`hypergraph sync\`) and refresh.`,
    );
  }
  return { root, cache, project };
}

const hgServe = () => ({
  name: "hypergraph-project",
  configureServer(server) {
    const p = hgProject();
    if (!p) return;
    console.log(`[hypergraph] serving ${p.project} (${p.root}) at /hg/`);
    server.middlewares.use("/hg", (req, res, next) => {
      const name = req.url.replace(/^\//, "").replace(/[?#].*$/, "");
      res.setHeader("Content-Type", "application/json");
      if (name === "meta.json") { res.end(JSON.stringify({ project: p.project })); return; }
      if (name !== "record.json" && name !== "state.json") { next(); return; }
      try {
        res.end(readFileSync(join(p.cache, name)));
      } catch {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: name + " not exported yet" }));
      }
    });
  },
});

export default defineConfig({
  plugins: [hgServe()],
  resolve: {
    alias: { excaligraph: join(EXCALIGRAPH_DIST, "index.js") },
  },
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), EXCALIGRAPH_DIST] },
  },
});
