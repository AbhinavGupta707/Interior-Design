"""Fixed-location offline entrypoint for Windows/NVIDIA evidence collection.

This runner accepts no command-line arguments. The host mounts privacy-approved
input at /c8/input and an empty output at /c8/output. Production orchestration
still owns tenant/lease/retry fencing; this runner exists only to collect the
named workstation's real tool/hardware evidence through the same adapters.
"""

from __future__ import annotations

import json
import os
import shutil
from pathlib import Path
from typing import cast

from inference_worker.reconstruction.gsplat import GsplatAppearanceAdapter
from inference_worker.reconstruction.nerfstudio import (
    ArtifactPublisher,
    NeuralAppearanceAdapter,
    TrustedStagedFrames,
    parse_appearance_input,
)
from inference_worker.reconstruction.nerfstudio.contracts import (
    AppearanceMethod,
    JsonObject,
    as_json_value,
    canonical_json_bytes,
)

INPUT_ROOT = Path("/c8/input")
OUTPUT_ROOT = Path("/c8/output")
WORK_ROOT = Path("/c8/work")
INPUT_MANIFEST = INPUT_ROOT / "appearance-input.json"
MAXIMUM_MANIFEST_BYTES = 64 * 1_024 * 1_024
ALLOWED_FRAME_SUFFIXES = (".jpeg", ".jpg", ".png")


class FixedOutputPublisher(ArtifactPublisher):
    """Publish to fixed filenames without returning or logging local paths."""

    def publish(self, artifact_file: Path, public_result: JsonObject) -> None:
        method = public_result.get("method")
        if method == "nerfstudio":
            artifact_name = "appearance.nerfstudio.tar"
        elif method == "gsplat":
            artifact_name = "appearance.gsplat.ply"
        else:
            raise ValueError("APPEARANCE_METHOD_INVALID")
        artifact_target = OUTPUT_ROOT / artifact_name
        result_target = OUTPUT_ROOT / "appearance-result.json"
        if artifact_target.exists() or result_target.exists():
            raise ValueError("APPEARANCE_OUTPUT_NOT_EMPTY")
        artifact_temporary = OUTPUT_ROOT / ".appearance-artifact.pending"
        result_temporary = OUTPUT_ROOT / ".appearance-result.pending"
        with artifact_file.open("rb") as source, artifact_temporary.open("xb") as target:
            shutil.copyfileobj(source, target, length=1_048_576)
            target.flush()
            os.fsync(target.fileno())
        with result_temporary.open("xb") as target:
            target.write(canonical_json_bytes(public_result))
            target.flush()
            os.fsync(target.fileno())
        artifact_temporary.replace(artifact_target)
        result_temporary.replace(result_target)


def _safe_manifest() -> tuple[JsonObject, AppearanceMethod]:
    if (
        INPUT_MANIFEST.is_symlink()
        or not INPUT_MANIFEST.is_file()
        or INPUT_MANIFEST.stat().st_size > MAXIMUM_MANIFEST_BYTES
    ):
        raise ValueError("APPEARANCE_INPUT_INVALID")
    parsed_json = as_json_value(json.loads(INPUT_MANIFEST.read_bytes()))
    if not isinstance(parsed_json, dict):
        raise ValueError("APPEARANCE_INPUT_INVALID")
    raw = parsed_json
    method = raw.get("method")
    if method not in {"nerfstudio", "gsplat"}:
        raise ValueError("APPEARANCE_METHOD_INVALID")
    appearance_method = cast("AppearanceMethod", method)
    parse_appearance_input(raw, expected_method=appearance_method)
    return raw, appearance_method


def _staged_frames(raw: JsonObject, method: AppearanceMethod) -> TrustedStagedFrames:
    parsed = parse_appearance_input(raw, expected_method=method)
    frame_root = INPUT_ROOT / "sanitized"
    if frame_root.is_symlink() or not frame_root.is_dir():
        raise ValueError("STAGED_FRAME_ROOT_INVALID")
    by_frame_id: dict[str, Path] = {}
    for camera in parsed.cameras:
        candidates = [
            frame_root / f"{camera.frame_id}{suffix}" for suffix in ALLOWED_FRAME_SUFFIXES
        ]
        present = [candidate for candidate in candidates if candidate.is_file()]
        if len(present) != 1:
            raise ValueError("STAGED_FRAME_INVALID")
        by_frame_id[camera.frame_id] = present[0]
    return TrustedStagedFrames(root=frame_root, by_frame_id=by_frame_id)


def main() -> int:
    """Run one exact offline attempt and emit only a safe status code."""

    try:
        raw, method = _safe_manifest()
        staged = _staged_frames(raw, method)
        adapter = (
            NeuralAppearanceAdapter.discover()
            if method == "nerfstudio"
            else GsplatAppearanceAdapter.discover()
        )
        outcome = adapter.execute(
            raw,
            workspace_root=WORK_ROOT,
            staged_frames=staged,
            cancelled=lambda: False,
            publication_fence=lambda: True,
            publisher=FixedOutputPublisher(),
        )
        print(
            json.dumps(
                {"safeCode": outcome.safe_code, "status": outcome.status},
                separators=(",", ":"),
                sort_keys=True,
            )
        )
        return 0 if outcome.status == "completed" else 2
    except (OSError, ValueError, json.JSONDecodeError):
        print('{"safeCode":"APPEARANCE_INPUT_REJECTED","status":"failed"}')
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
