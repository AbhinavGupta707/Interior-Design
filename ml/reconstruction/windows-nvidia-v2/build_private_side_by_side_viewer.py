#!/usr/bin/env python3
"""Build a path-redacted private side-by-side reconstruction inspection viewer."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any

from capture_benchmark import canonical_bytes, private_copy, private_write, safe_root, sha256_file
from run_da3_matrix import private_existing

CAPTURES = ("baseline-25", "capture-132", "capture-165")
LANES = ("unconstrained", "arkit-prior", "gsplat", "da3-small")
VIEWS = ("principal-a", "principal-b", "elevated")
CAPTURE_LABELS = {
    "baseline-25": "C14.8 retained 25-view baseline",
    "capture-132": "C14.10 complete 132-frame capture",
    "capture-165": "C14.10 complete 165-frame capture",
}
LANE_LABELS = {
    "unconstrained": "Unconstrained dense COLMAP",
    "arkit-prior": "ARKit-prior dense COLMAP",
    "gsplat": "Recovered fixed-geometry gsplat",
    "da3-small": "Exact DA3-SMALL",
}


def parse_sources(values: list[str]) -> dict[str, Path]:
    expected = {f"{capture}/{lane}" for capture in CAPTURES for lane in LANES}
    sources: dict[str, Path] = {}
    for value in values:
        key, separator, raw_path = value.partition("=")
        if not separator or key not in expected or key in sources:
            raise ValueError("sources require one unique declared capture/lane=absolute-path")
        sources[key] = private_existing(Path(raw_path), "inspection source")
    if set(sources) != expected:
        raise ValueError("viewer requires every declared capture and lane exactly once")
    return sources


def load_inspection(root: Path) -> tuple[dict[str, Any], dict[str, Path]]:
    manifest_path = root / "inspection.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("inspection manifest is missing or unsafe")
    manifest = json.loads(manifest_path.read_bytes())
    if manifest.get("schemaVersion") != "c14-10-private-ply-inspection-v1":
        raise ValueError("inspection manifest schema is invalid")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ValueError("inspection artifact manifest is invalid")
    paths: dict[str, Path] = {}
    for view in VIEWS:
        name = f"{view}.png"
        path = root / name
        expected_sha = artifacts.get(name)
        if (
            not isinstance(expected_sha, str)
            or len(expected_sha) != 64
            or path.is_symlink()
            or not path.is_file()
            or sha256_file(path) != expected_sha
        ):
            raise ValueError("inspection artifact differs from its manifest")
        paths[view] = path
    return manifest, paths


def image_cell(capture: str, lane: str) -> str:
    attributes = " ".join(f'data-{view}="assets/{capture}-{lane}-{view}.png"' for view in VIEWS)
    return (
        '<article class="cell">'
        f'<img data-cell alt="{html.escape(CAPTURE_LABELS[capture])}, '
        f'{html.escape(LANE_LABELS[lane])}" {attributes}>'
        "</article>"
    )


def viewer_html() -> bytes:
    headers = "".join(
        f'<div class="column-head">{html.escape(CAPTURE_LABELS[capture])}</div>'
        for capture in CAPTURES
    )
    rows = []
    for lane in LANES:
        cells = "".join(image_cell(capture, lane) for capture in CAPTURES)
        rows.append(
            f'<section class="lane"><h2>{html.escape(LANE_LABELS[lane])}</h2>'
            f'<div class="grid">{cells}</div></section>'
        )
    document = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>C14.10 private reconstruction inspection</title>
<style>
:root {{ color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }}
body {{ margin: 0; background: #0b0d10; color: #eef1f5; }}
main {{ max-width: 1760px; margin: auto; padding: 28px; }}
h1 {{ font-size: 24px; margin: 0 0 8px; }}
.notice {{ color: #aeb7c2; margin: 0 0 20px; max-width: 1100px; }}
.controls {{ display: flex; gap: 8px; margin: 18px 0; }}
button {{ border: 1px solid #39414c; border-radius: 8px; color: #eef1f5;
  padding: 8px 12px; background: #1b2027; cursor: pointer; }}
button.active {{ background: #335eea; border-color: #6f8fff; }}
.head-grid, .grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }}
.column-head {{ color: #cbd4df; font-size: 13px; font-weight: 650; padding: 0 4px; }}
.lane {{ margin-top: 24px; }}
.lane h2 {{ font-size: 16px; margin: 0 0 10px; }}
.cell {{ background: #12161c; border: 1px solid #252c35; border-radius: 10px;
  overflow: hidden; min-height: 220px; }}
.cell img {{ display: block; width: 100%; height: auto; aspect-ratio: 4 / 3; object-fit: contain; }}
footer {{ color: #8f99a6; font-size: 12px; margin-top: 28px; }}
</style>
</head>
<body>
<main>
<h1>C14.10 private side-by-side reconstruction inspection</h1>
<p class="notice">Normalized deterministic point-cloud views for proposal-usefulness
inspection only. These images do not establish dimensional, representative, structural,
regulatory, or as-built accuracy.</p>
<div class="controls" role="group" aria-label="Inspection view">
<button class="active" data-view="principal-a">Principal A</button>
<button data-view="principal-b">Principal B</button>
<button data-view="elevated">Elevated</button>
</div>
<div class="head-grid">{headers}</div>
{"".join(rows)}
<footer>Private WSL ext4 artifact. Captures remain independent; recovered gsplat is
appearance-only and DA3 output remains a proposal.</footer>
</main>
<script>
const buttons = [...document.querySelectorAll("button[data-view]")];
const images = [...document.querySelectorAll("img[data-cell]")];
function show(view) {{
  images.forEach(image => {{ image.src = image.getAttribute("data-" + view); }});
  buttons.forEach(button => button.classList.toggle("active", button.dataset.view === view));
}}
buttons.forEach(button => button.addEventListener("click", () => show(button.dataset.view)));
show("principal-a");
</script>
</body>
</html>
"""
    return document.encode("utf-8")


def private_output(path: Path) -> Path:
    output = safe_root(path)
    if not str(output).startswith("/home/"):
        raise ValueError("viewer output must remain on private WSL ext4")
    return output


def build(args: argparse.Namespace) -> None:
    sources = parse_sources(args.source)
    output = private_output(Path(args.output))
    assets = output / "assets"
    if assets.exists() or assets.is_symlink():
        raise ValueError("viewer assets target must be fresh")
    assets.mkdir(mode=0o700)
    records: dict[str, dict[str, Any]] = {}
    for capture in CAPTURES:
        for lane in LANES:
            key = f"{capture}/{lane}"
            manifest, paths = load_inspection(sources[key])
            copied: dict[str, str] = {}
            for view, source in paths.items():
                name = f"{capture}-{lane}-{view}.png"
                destination = assets / name
                private_copy(source, destination)
                copied[name] = sha256_file(destination)
            records[key] = {
                "artifacts": copied,
                "inputSha256": manifest["inputSha256"],
                "renderedPointCount": manifest["renderedPointCount"],
                "sourceVertexCount": manifest["sourceVertexCount"],
            }
    private_write(output / "index.html", viewer_html())
    manifest = {
        "authority": "private-proposal-inspection-only",
        "claims": "no-dimensional-or-representative-accuracy",
        "records": records,
        "schemaVersion": "c14-10-private-side-by-side-viewer-v1",
        "viewerSha256": sha256_file(output / "index.html"),
    }
    private_write(output / "viewer-manifest.json", canonical_bytes(manifest) + b"\n")
    print(
        json.dumps(
            {
                "artifactCount": len(CAPTURES) * len(LANES) * len(VIEWS),
                "viewerSha256": manifest["viewerSha256"],
            },
            sort_keys=True,
        )
    )


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--output", required=True)
    value.add_argument("--source", action="append", required=True)
    value.set_defaults(function=build)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
