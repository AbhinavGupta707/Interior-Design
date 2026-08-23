"""Hardened Docker argv builder for the WSL-ext4 C8 v2 topology."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

SHA256_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


@dataclass(frozen=True, slots=True)
class ContainerInvocation:
    image_digest: str
    input_root: Path
    output_root: Path
    memory_gib: int = 24
    cpu_count: int = 12
    pids_limit: int = 512

    def __post_init__(self) -> None:
        if SHA256_DIGEST.fullmatch(self.image_digest) is None:
            raise ValueError("container image must use an exact sha256 digest")
        resolved_roots: list[Path] = []
        for root, name in ((self.input_root, "input"), (self.output_root, "output")):
            if not root.is_absolute() or root.is_symlink():
                raise ValueError(f"{name} root must be an absolute non-symlink path")
            try:
                resolved = root.resolve(strict=True)
            except FileNotFoundError as error:
                raise ValueError(f"{name} root must exist") from error
            if resolved != root or not resolved.is_dir():
                raise ValueError(f"{name} root must resolve to a real directory")
            resolved_roots.append(resolved)
        input_root, output_root = resolved_roots
        if (
            input_root == output_root
            or input_root in output_root.parents
            or output_root in input_root.parents
        ):
            raise ValueError("input and output roots must be independent")
        if any(output_root.iterdir()):
            raise ValueError("output root must be empty")
        if not 4 <= self.memory_gib <= 48:
            raise ValueError("container memory bound is invalid")
        if not 1 <= self.cpu_count <= 24:
            raise ValueError("container CPU bound is invalid")
        if not 64 <= self.pids_limit <= 2_048:
            raise ValueError("container PID bound is invalid")

    def argv(self) -> tuple[str, ...]:
        return (
            "docker",
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--gpus",
            "device=0",
            "--cpus",
            str(self.cpu_count),
            "--memory",
            f"{self.memory_gib}g",
            "--pids-limit",
            str(self.pids_limit),
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev,size=2g",
            "--tmpfs",
            "/c8/work:rw,noexec,nosuid,nodev,size=12g",
            "--mount",
            f"type=bind,src={self.input_root},dst=/c8/input,readonly",
            "--mount",
            f"type=bind,src={self.output_root},dst=/c8/output",
            self.image_digest,
        )
