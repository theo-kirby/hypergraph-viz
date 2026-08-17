// ===========================================================================
// Loader for the excaligraph preview harness — the real Excalidraw renderer,
// served by the dev server under /harness/*. Booting it injects its module
// bundle (a few MB, so it happens lazily on the first Excaligraph render) and
// a hidden #root div; once globalThis.excaligraphReady is true the page can
// call excaligraphHarness.exportToSvg on any Excalidraw scene object.
// ===========================================================================

let bootPromise = null;

// Idempotent: the first call injects the harness, later calls await the same
// boot. The bundle filenames are content-hashed, so they are read out of the
// harness's own index.html.
export function ensureHarness() {
  if (globalThis.excaligraphReady === true) return Promise.resolve();
  if (!bootPromise) {
    bootPromise = (async () => {
      const res = await fetch("/harness/index.html");
      if (!res.ok) throw new Error("harness not served (" + res.status + ")");
      const html = await res.text();
      const js = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
      const css = html.match(/href="\.\/(assets\/[^"]+\.css)"/)?.[1];
      if (!js) throw new Error("could not find the harness bundle name");

      if (!document.getElementById("root")) {
        const root = document.createElement("div");
        root.id = "root";
        root.style.display = "none";
        document.body.appendChild(root);
      }
      if (css) {
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = "/harness/" + css;
        document.head.appendChild(link);
      }
      const script = document.createElement("script");
      script.type = "module";
      script.src = "/harness/" + js;
      document.head.appendChild(script);

      while (globalThis.excaligraphReady !== true) {
        await new Promise((r) => setTimeout(r, 50));
      }
    })();
    bootPromise.catch(() => { bootPromise = null; }); // allow a retry
  }
  return bootPromise;
}

// scene: an ExcalidrawFile object. Returns the rendered SVG markup.
export async function renderScene(scene, opts = {}) {
  await ensureHarness();
  return globalThis.excaligraphHarness.exportToSvg(scene, {
    exportPadding: 24,
    scale: 1,
    ...opts,
  });
}
