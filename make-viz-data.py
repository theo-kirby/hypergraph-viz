#!/usr/bin/env python3
"""Attach hypergraph-viz to a Hypergraph project — or detach it again.

Reads the project's JSON exports (the integration contract pinned by
hypergraph-protocol: `.hypergraph/cache/{record,state}.json`, written by
`hypergraph export`) and writes `data.local.js` next to this script. The
viewer picks that file up automatically; without it, the built-in demo shows.

    Attach:  python3 make-viz-data.py ~/some-project
    Detach:  python3 make-viz-data.py --detach

Stdlib only — no pyyaml, no npm involvement. If the exports are missing or
stale, run `hypergraph export --config .hypergraph/config.yml` in the project
first (in a dev checkout of hypergraph-protocol: `uv run tools/hypergraph.py
export …`).

Shapes produced (what app.js consumes):
  RECORD_EDGES / STATE_EDGES — [parent_slug, child_slug] pairs
  RECORD_LABELS / STATE_LABELS — slug → display label
  ASPECTS — state_slug → {label, hue, fill, members: [record_slugs]}
            members are the `[rec: slug]` provenance references in the state
            node's body: each state node is a hyperedge over the record graph.
"""

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_OUT = HERE / "data.local.js"

LABEL_MAX = 34
REC_REF = re.compile(r"\[rec: ([a-z0-9-]+)\]")

# hue (stroke) / fill pairs in the demo's Open Color style, cycled over aspects.
PALETTE = [
    ("#e64980", "#ffdeeb"), ("#12b886", "#c3fae8"), ("#f59f00", "#ffec99"),
    ("#4263eb", "#dbe4ff"), ("#ae3ec9", "#f3d9fa"), ("#f76707", "#ffe8cc"),
    ("#2f9e44", "#d3f9d8"), ("#1098ad", "#c5f6fa"), ("#7048e8", "#e5dbff"),
    ("#d6336c", "#ffdeeb"), ("#0ca678", "#c3fae8"), ("#e8590c", "#ffe8cc"),
]


def cache_dir_of(project: Path) -> Path:
    """The project's cache dir: `cache_dir:` from config.yml, else the default."""
    config = project / ".hypergraph" / "config.yml"
    if not config.is_file():
        sys.exit(f"error: {config} not found — is {project} a Hypergraph project?")
    for line in config.read_text().splitlines():
        m = re.match(r"^cache_dir:\s*(\S+)", line)
        if m:
            return project / m.group(1)
    return project / ".hypergraph" / "cache"


def load_nodes(cache: Path, graph: str) -> list:
    path = cache / f"{graph}.json"
    if not path.is_file():
        sys.exit(
            f"error: {path} not found — run `hypergraph export` in the project first"
        )
    return json.loads(path.read_text())["nodes"]


def truncate(text: str, limit: int = LABEL_MAX) -> str:
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def edges_and_labels(nodes: list):
    """[parent_slug, child_slug] pairs plus slug → label, in created_at order."""
    nodes = sorted(nodes, key=lambda n: n["created_at"])
    slug_of = {n["node_id"]: n["slug_name"] for n in nodes}
    edges, labels = [], {}
    for n in nodes:
        labels[n["slug_name"]] = truncate(n["title"])
        for pid in n["parent_ids"]:
            if pid in slug_of:
                edges.append([slug_of[pid], n["slug_name"]])
    return edges, labels


def aspects_of(state_nodes: list, record_slugs: set) -> dict:
    """Each non-root state node with resolvable [rec:] refs is a hyperedge."""
    aspects = {}
    for n in sorted(state_nodes, key=lambda n: n["created_at"]):
        if not n["parent_ids"]:
            continue
        members, seen = [], set()
        for slug in REC_REF.findall(n["content"]):
            if slug in record_slugs and slug not in seen:
                seen.add(slug)
                members.append(slug)
        if not members:
            continue
        hue, fill = PALETTE[len(aspects) % len(PALETTE)]
        aspects[n["slug_name"]] = {
            "label": truncate(n["title"], 24),
            "hue": hue,
            "fill": fill,
            "members": members,
        }
    return aspects


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("project", nargs="?", type=Path,
                    help="root of a Hypergraph project (holds .hypergraph/)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT,
                    help=f"output module (default: {DEFAULT_OUT.name} next to this script)")
    ap.add_argument("--detach", action="store_true",
                    help="remove the output module so the demo shows again")
    args = ap.parse_args()

    if args.detach:
        if args.out.exists():
            args.out.unlink()
            print(f"detached: removed {args.out}")
        else:
            print(f"already detached: {args.out} does not exist")
        return
    if args.project is None:
        ap.error("project is required unless --detach is given")

    cache = cache_dir_of(args.project.resolve())
    record = load_nodes(cache, "record")
    state = load_nodes(cache, "state")

    record_edges, record_labels = edges_and_labels(record)
    state_edges, state_labels = edges_and_labels(state)
    aspects = aspects_of(state, {n["slug_name"] for n in record})

    dump = lambda v: json.dumps(v, indent=2, ensure_ascii=True)
    args.out.write_text(
        "// Generated by make-viz-data.py — do not hand-edit.\n"
        f"export const RECORD_EDGES = {dump(record_edges)};\n"
        f"export const RECORD_LABELS = {dump(record_labels)};\n"
        f"export const STATE_EDGES = {dump(state_edges)};\n"
        f"export const STATE_LABELS = {dump(state_labels)};\n"
        f"export const ASPECTS = {dump(aspects)};\n"
    )
    print(
        f"attached: {args.out} ← {cache}\n"
        f"  record: {len(record)} nodes, {len(record_edges)} edges\n"
        f"  state:  {len(state)} nodes, {len(state_edges)} edges, "
        f"{len(aspects)} aspects"
    )


if __name__ == "__main__":
    main()
