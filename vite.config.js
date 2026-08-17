// Dev-server wiring for the Excaligraph mode: the app imports the excaligraph
// library ("excaligraph" → the built dist), and the real Excalidraw renderer
// (the preview harness) is served under /harness/*. This is a dev-server
// tool: `vite build` output will not include the harness — the app is run
// with `npm run dev`.
import { defineConfig, searchForWorkspaceRoot } from "vite";
import { readFile } from "node:fs/promises";
import { join, normalize, extname } from "node:path";

const EXCALIGRAPH_DIST = "/Users/theo/excaligraph/dist";
const HARNESS = join(EXCALIGRAPH_DIST, "harness");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

export default defineConfig({
  resolve: {
    alias: { excaligraph: join(EXCALIGRAPH_DIST, "index.js") },
  },
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), EXCALIGRAPH_DIST] },
  },
  plugins: [
    {
      // /harness/* → the excaligraph preview harness. Its bundle's relative
      // chunk and font imports resolve under /harness/assets/* by themselves.
      name: "excaligraph-harness",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const path = normalize(new URL(req.url, "http://localhost").pathname);
          if (!path.startsWith("/harness/")) return next();
          const file = normalize(join(HARNESS, path.slice("/harness/".length)));
          if (!file.startsWith(HARNESS)) return next(); // traversal attempt
          try {
            const body = await readFile(file);
            res.setHeader("content-type", MIME[extname(file)] ?? "application/octet-stream");
            res.end(body);
          } catch {
            res.statusCode = 404;
            res.end("not found");
          }
        });
      },
    },
  ],
});
