#!/usr/bin/env python3
"""Record a redacted WSL/Docker/NVIDIA benchmark capability snapshot."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
from pathlib import Path

DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")


def run(argv: list[str]) -> str:
    return subprocess.run(argv, check=True, capture_output=True, text=True).stdout.strip()


def canonical(value: object) -> bytes:
    return json.dumps(
        value, allow_nan=False, ensure_ascii=False, separators=(",", ":"), sort_keys=True
    ).encode()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host-alias", required=True)
    parser.add_argument("--image", action="append", default=[])
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    images: dict[str, object] = {}
    for declaration in args.image:
        candidate, separator, digest = declaration.partition("=")
        if (
            not separator
            or not re.fullmatch(r"[a-z0-9][a-z0-9_.-]{1,63}", candidate)
            or DIGEST.fullmatch(digest) is None
        ):
            raise ValueError("images must be candidate=sha256:<64 lowercase hex>")
        inspected = json.loads(run(["docker", "image", "inspect", digest]))
        if len(inspected) != 1 or inspected[0].get("Id") != digest:
            raise ValueError("local image does not match its immutable digest")
        images[candidate] = {
            "id": digest,
            "labels": inspected[0].get("Config", {}).get("Labels") or {},
            "sizeBytes": inspected[0].get("Size"),
        }
    gpu_lines = run(
        [
            "nvidia-smi",
            "--query-gpu=index,name,driver_version,memory.total,compute_cap",
            "--format=csv,noheader,nounits",
        ]
    ).splitlines()
    gpus = []
    for line in gpu_lines:
        index, name, driver, memory_mib, capability = (part.strip() for part in line.split(","))
        gpus.append(
            {
                "computeCapability": capability,
                "driverVersion": driver,
                "index": int(index),
                "memoryBytes": int(memory_mib) * 1024 * 1024,
                "name": name,
            }
        )
    docker = json.loads(run(["docker", "version", "--format", "{{json .}}"]))
    usage = shutil.disk_usage(Path.cwd())
    inventory = {
        "docker": {
            "clientVersion": docker.get("Client", {}).get("Version"),
            "engineVersion": docker.get("Server", {}).get("Version"),
        },
        "filesystem": {"freeBytes": usage.free, "totalBytes": usage.total},
        "gpus": gpus,
        "hostAlias": args.host_alias,
        "images": images,
        "kernel": platform.release(),
        "platform": platform.system(),
        "python": platform.python_version(),
        "schemaVersion": "c14-9-host-capabilities-v1",
    }
    output = Path(args.output)
    if (
        not output.is_absolute()
        or output.exists()
        or output.is_symlink()
        or not output.parent.is_dir()
    ):
        raise ValueError("output must be a new absolute file")
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    data = canonical(inventory) + b"\n"
    with os.fdopen(descriptor, "wb") as target:
        target.write(data)
    print(
        json.dumps(
            {"output": str(output), "sha256": hashlib.sha256(data).hexdigest()}, sort_keys=True
        )
    )


if __name__ == "__main__":
    main()
