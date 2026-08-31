#!/usr/bin/env python3
"""Build a quarantined control/direct/hybrid point-cloud comparison viewer."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path

from capture_benchmark import canonical_bytes, private_copy, private_write, safe_root, sha256_file

LANES = ("retained-control", "vggt-direct", "vggt-slam-hybrid")
VIEWS = ("principal-a", "principal-b", "elevated")
LABELS = {
    "retained-control": "Retained ARKit-prior dense COLMAP control",
    "vggt-direct": "VGGT-1B direct proposal (48-frame early stop)",
    "vggt-slam-hybrid": ("Patched VGGT-SLAM-derived no-loop adapter proposal (165 frames)"),
}


def private_existing(path: Path, label: str) -> Path:
    if not path.is_absolute() or path.is_symlink() or not path.exists():
        raise ValueError(f"{label} must be a private WSL ext4 path")
    resolved = path.resolve()
    if resolved == Path("/home") or not resolved.is_relative_to(Path("/home")):
        raise ValueError(f"{label} must be a private WSL ext4 path")
    return resolved


def sources(values: list[str]) -> dict[str, Path]:
    parsed: dict[str, Path] = {}
    for value in values:
        lane, separator, raw_path = value.partition("=")
        if not separator or lane not in LANES or lane in parsed:
            raise ValueError("sources require each unique frozen lane=absolute-path")
        parsed[lane] = private_existing(Path(raw_path), "inspection source")
    if set(parsed) != set(LANES):
        raise ValueError("viewer requires the retained control, direct and hybrid lanes")
    return parsed


def validated_inspection(root: Path) -> tuple[dict[str, object], dict[str, Path]]:
    manifest_path = root / "inspection.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError("inspection manifest is missing or unsafe")
    manifest = json.loads(manifest_path.read_bytes())
    if manifest.get("schemaVersion") != "c14-10-private-ply-inspection-v1":
        raise ValueError("inspection schema is invalid")
    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ValueError("inspection artifact map is invalid")
    paths: dict[str, Path] = {}
    for view in VIEWS:
        name = f"{view}.png"
        path = root / name
        if (
            not isinstance(artifacts.get(name), str)
            or path.is_symlink()
            or not path.is_file()
            or sha256_file(path) != artifacts[name]
        ):
            raise ValueError("inspection artifact hash differs")
        paths[view] = path
    return manifest, paths


def document() -> bytes:
    cells = "".join(
        '<article class="cell">'
        f"<h2>{html.escape(LABELS[lane])}</h2>"
        f'<img data-lane="{lane}" alt="{html.escape(LABELS[lane])}" '
        + " ".join(f'data-{view}="assets/{lane}-{view}.png"' for view in VIEWS)
        + "></article>"
        for lane in LANES
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>C14.10 private non-commercial VGGT comparison</title>
<style>
:root {{ color-scheme: dark; font-family: Inter,ui-sans-serif,system-ui,sans-serif; }}
body {{ margin:0; background:#0b0d10; color:#eef1f5; }}
main {{ max-width:1780px; margin:auto; padding:28px; }}
h1 {{ margin:0 0 8px; font-size:24px; }}
.notice {{ color:#b2bdc9; max-width:1100px; }}
.controls {{ display:flex; gap:8px; margin:20px 0; }}
button {{ background:#1a2028; color:#eef1f5; border:1px solid #3a4552;
  border-radius:8px; padding:8px 12px; cursor:pointer; }}
button.active {{ background:#335eea; border-color:#86a0ff; }}
.grid {{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }}
.cell {{ background:#12171d; border:1px solid #27303a; border-radius:10px; overflow:hidden; }}
.cell h2 {{ font-size:14px; margin:12px 14px; }}
.cell img {{ width:100%; aspect-ratio:8/5; object-fit:contain; display:block; }}
footer {{ color:#8f9aa7; font-size:12px; margin-top:24px; }}
@media (max-width:900px) {{ .grid {{ grid-template-columns:1fr; }} }}
</style></head><body><main>
<h1>C14.10 learned reconstruction comparison</h1>
<p class="notice">Strictly private, non-commercial research evidence. Normalized proposal views
only; no dimensional, representative, canonical, production, structural or regulatory claim.
The SALAD loop-closure path was not run.</p>
<div class="controls" role="group" aria-label="Inspection view">
<button class="active" data-view="principal-a">Principal A</button>
<button data-view="principal-b">Principal B</button>
<button data-view="elevated">Elevated</button></div>
<section class="grid">{cells}</section>
<footer>The 165-frame capture is one independent segment. No segment joining or canonical mutation
has occurred. Adapter behaviour does not establish upstream VGGT-SLAM 2.0 loop-closure
performance. Future commercial evaluation requires appropriately licensed weights.</footer>
</main><script>
const buttons=[...document.querySelectorAll('button[data-view]')];
const images=[...document.querySelectorAll('img[data-lane]')];
function show(view){{images.forEach(i=>i.src=i.getAttribute('data-'+view));
buttons.forEach(b=>b.classList.toggle('active',b.dataset.view===view));}}
buttons.forEach(b=>b.addEventListener('click',()=>show(b.dataset.view)));show('principal-a');
</script></body></html>""".encode()


def build(args: argparse.Namespace) -> None:
    source_map = sources(args.source)
    output = safe_root(Path(args.output))
    if output == Path("/home") or not output.is_relative_to(Path("/home")):
        raise ValueError("viewer output must stay on private WSL ext4")
    assets = output / "assets"
    if assets.exists() or assets.is_symlink():
        raise ValueError("viewer assets target must be fresh")
    assets.mkdir(mode=0o700)
    records: dict[str, object] = {}
    for lane in LANES:
        manifest, paths = validated_inspection(source_map[lane])
        copied: dict[str, str] = {}
        for view, source in paths.items():
            name = f"{lane}-{view}.png"
            destination = assets / name
            private_copy(source, destination)
            copied[name] = sha256_file(destination)
        records[lane] = {
            "artifacts": copied,
            "inputSha256": manifest["inputSha256"],
            "renderedPointCount": manifest["renderedPointCount"],
            "sourceVertexCount": manifest["sourceVertexCount"],
        }
    private_write(output / "index.html", document())
    manifest = {
        "authority": "strictly-private-non-commercial-research-only",
        "claims": "no-dimensional-representative-canonical-or-production-authority",
        "records": records,
        "schemaVersion": "c14-10-vggt-nc-private-viewer-v1",
        "viewerSha256": sha256_file(output / "index.html"),
    }
    private_write(output / "viewer-manifest.json", canonical_bytes(manifest) + b"\n")
    print(json.dumps({"assetCount": 9, "viewerSha256": manifest["viewerSha256"]}, sort_keys=True))


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser()
    value.add_argument("--output", required=True)
    value.add_argument("--source", action="append", required=True)
    value.set_defaults(function=build)
    return value


if __name__ == "__main__":
    parsed = parser().parse_args()
    parsed.function(parsed)
