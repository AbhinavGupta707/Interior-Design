"""Fixed-command and authority tests for the gsplat appearance adapter."""

from __future__ import annotations

import json
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import cast

from inference_worker.reconstruction.gsplat import GsplatAppearanceAdapter
from inference_worker.reconstruction.nerfstudio.adapter import (
    ArtifactPublisher,
    TrustedStagedFrames,
)
from inference_worker.reconstruction.nerfstudio.contracts import JsonObject
from inference_worker.reconstruction.nerfstudio.runtime import (
    CommandExecutor,
    CommandResult,
    fixture_runtime,
)

FRAME_ID = "33333333-3333-4333-8333-333333333333"
SYNTHETIC_FRAME_BYTES = b"C8 visibly synthetic public-domain frame fixture"


def appearance_input() -> JsonObject:
    repository_root = Path(__file__).resolve().parents[5]
    fixture = repository_root / "ml/reconstruction/fixtures/synthetic-appearance-gsplat.json"
    return cast("JsonObject", json.loads(fixture.read_text(encoding="utf-8")))


class GsplatFixtureExecutor(CommandExecutor):
    """Visibly synthetic executable double; never algorithm or CUDA evidence."""

    def __init__(self, *, leaked_marker: bytes | None = None) -> None:
        self.commands: list[tuple[str, ...]] = []
        self.leaked_marker = leaked_marker

    def run(
        self,
        argv: Sequence[str],
        *,
        cwd: Path,
        timeout_seconds: int,
        cancelled: Callable[[], bool],
    ) -> CommandResult:
        del cwd, timeout_seconds, cancelled
        self.commands.append(tuple(argv))
        output = Path(argv[argv.index("--output-dir") + 1])
        if argv[1] == "splatfacto":
            config = output / "c8-appearance" / "splatfacto" / "attempt-01" / "config.yml"
            config.parent.mkdir(parents=True)
            config.write_text("method: visibly-synthetic-splatfacto\n", encoding="utf-8")
        else:
            output.mkdir(parents=True)
            payload = (
                b"ply\nformat binary_little_endian 1.0\n"
                b"comment visibly synthetic and non-dimensional\n"
                b"element vertex 0\nproperty float x\nend_header\n"
            )
            if self.leaked_marker is not None:
                payload += self.leaked_marker
            (output / "splat.ply").write_bytes(payload)
        return CommandResult(
            duration_milliseconds=7,
            exit_code=0,
            peak_resident_memory_bytes=2_048,
        )


class Publisher(ArtifactPublisher):
    def __init__(self) -> None:
        self.calls = 0
        self.payload = b""
        self.result: JsonObject | None = None

    def publish(self, artifact_file: Path, public_result: JsonObject) -> None:
        self.calls += 1
        self.payload = artifact_file.read_bytes()
        self.result = public_result


def _staged(tmp_path: Path) -> TrustedStagedFrames:
    root = tmp_path / "sanitized"
    root.mkdir()
    frame = root / f"{FRAME_ID}.png"
    frame.write_bytes(SYNTHETIC_FRAME_BYTES)
    return TrustedStagedFrames(root=root, by_frame_id={FRAME_ID: frame})


def test_splatfacto_and_export_commands_are_fixed_and_publish_non_dimensional_ply(
    tmp_path: Path,
) -> None:
    executor = GsplatFixtureExecutor()
    publisher = Publisher()
    adapter = GsplatAppearanceAdapter.with_runtime(fixture_runtime(tmp_path), executor=executor)

    outcome = adapter.execute(
        appearance_input(),
        workspace_root=tmp_path,
        staged_frames=_staged(tmp_path),
        cancelled=lambda: False,
        publication_fence=lambda: True,
        publisher=publisher,
    )

    assert outcome.status == "completed"
    assert publisher.calls == 1
    assert publisher.payload.startswith(b"ply\nformat binary_little_endian 1.0")
    result = cast("JsonObject", outcome.result)
    artifact = cast("list[JsonObject]", result["artifacts"])[0]
    assert result["method"] == "gsplat"
    assert artifact["kind"] == "gaussian-splat"
    assert artifact["dimensionalAuthority"] == "non-dimensional"
    assert result["geometryManifestSha256"] == "4" * 64
    assert json.dumps(result).find("proposal-only") == -1

    assert len(executor.commands) == 2
    train, export = executor.commands
    assert train[1] == "splatfacto"
    assert export[1] == "gaussian-splat"
    assert "--load-config" in export
    assert all("--eval" not in value and "attacker" not in value for value in train + export)


def test_splat_private_path_bytes_are_rejected_before_publication(tmp_path: Path) -> None:
    staged = _staged(tmp_path)
    publisher = Publisher()
    executor = GsplatFixtureExecutor(leaked_marker=str(staged.root.resolve()).encode())
    outcome = GsplatAppearanceAdapter.with_runtime(
        fixture_runtime(tmp_path), executor=executor
    ).execute(
        appearance_input(),
        workspace_root=tmp_path,
        staged_frames=staged,
        cancelled=lambda: False,
        publication_fence=lambda: True,
        publisher=publisher,
    )

    assert outcome.status == "failed"
    assert outcome.safe_code == "APPEARANCE_OUTPUT_INVALID"
    assert publisher.calls == 0
