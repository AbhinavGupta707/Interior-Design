#!/usr/bin/env python3
"""Emit an offline package/licence and RTX/GTSAM capability record."""

from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import stat
import subprocess
from pathlib import Path

EXPECTED_BUILD_INPUTS = {
    "/opt/c14-10-vggt/vggt_nc_capture.py": (
        "a81ded95615441e2bde6e7a01a09e3267b8a97d939ae142ca6ee1af10c4b06ec"
    ),
    "/opt/c14-10-vggt/requirements.lock": (
        "0c1637c560d74c160da07572d77dc5a018565d88617a9a2d93e1e737e373e1ff"
    ),
    "/opt/c14-10-vggt/vggt-slam-headless-no-loop.patch": (
        "2b2dcfc2cb9b6ad9783cfafd26f1110c662d110c12af36b7bc7c3a9735ab7805"
    ),
    "/opt/c14-10-vggt/vggt-spark-offline.patch": (
        "59fa19e16050c117e1866bbd38fa6aa4ac92ef14a87683662ce0b1a059f37b38"
    ),
    "/opt/c14-10-vggt/source/vggt-slam/LICENSE": (
        "dc493d7ac51f587fd71184315999c792ead523bf46da0f0cbf3e26a577b1a580"
    ),
    "/opt/c14-10-vggt/source/vggt/LICENSE.txt": (
        "1d8ca66080a2701508a70be4ddad4be28c509bcc3397a682fb8edf767fdd7a00"
    ),
}

CUDA_TOOLKIT_TERMS_URL = "https://docs.nvidia.com/cuda/archive/13.2.0/eula/index.html"

SOURCE_TREES = {
    "vggt": {
        "root": "/opt/c14-10-vggt/source/vggt/vggt",
        "unpatchedSha256": "58553c36591da1db87c1def2125c65f615193a86da2ce4f31bcbda8ec6d0434a",
        "patchedSha256": "77abed7ccbef4d47a79026f98e9a8f26a951939bafada26ea0ddb6d916018b88",
        "fileCount": 41,
    },
    "vggt-slam": {
        "root": "/opt/c14-10-vggt/source/vggt-slam/vggt_slam",
        "unpatchedSha256": "c8fc9cf37a097f8c78d68a398fe383943f7acaf9daf83e6ba880c2d49ee62820",
        "patchedSha256": "ef078b9e30e5e744a6b0fc2c2af0d96672654ca87201400ace811f9fb6ddffb7",
        "fileCount": 11,
    },
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def source_tree_sha256(root: Path) -> tuple[str, int]:
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise RuntimeError("source tree root is unsafe")
    rows: list[dict[str, str]] = []
    for path in sorted(root.rglob("*")):
        mode = path.lstat().st_mode
        if stat.S_ISDIR(mode):
            continue
        if not stat.S_ISREG(mode):
            raise RuntimeError(f"source tree contains a non-regular entry: {path}")
        rows.append(
            {
                "path": path.relative_to(root).as_posix(),
                "sha256": sha256_file(path),
            }
        )
    payload = json.dumps(rows, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()
    return hashlib.sha256(payload).hexdigest(), len(rows)


def verified_source_trees(state: str) -> dict[str, dict[str, str | int]]:
    if state not in {"unpatched", "patched"}:
        raise RuntimeError("source tree state is invalid")
    records: dict[str, dict[str, str | int]] = {}
    expected_key = f"{state}Sha256"
    for name, declaration in SOURCE_TREES.items():
        digest, file_count = source_tree_sha256(Path(str(declaration["root"])))
        if digest != declaration[expected_key] or file_count != declaration["fileCount"]:
            raise RuntimeError(f"{name} {state} source tree identity differs")
        records[name] = {
            "fileCount": file_count,
            "sha256": digest,
            "state": state,
        }
    return records


def system_packages() -> list[dict[str, str | None]]:
    completed = subprocess.run(
        ["dpkg-query", "-W", "-f=${binary:Package}\t${Version}\\n"],
        check=True,
        capture_output=True,
        text=True,
    )
    packages = []
    for line in sorted(completed.stdout.splitlines()):
        name, version = line.split("\t", maxsplit=1)
        documentation_name = name.split(":", maxsplit=1)[0]
        copyright_file = Path("/usr/share/doc") / documentation_name / "copyright"
        packages.append(
            {
                "copyrightSha256": (
                    sha256_file(copyright_file) if copyright_file.is_file() else None
                ),
                "name": name,
                "version": version,
            }
        )
    missing = [item["name"] for item in packages if item["copyrightSha256"] is None]
    if missing:
        raise RuntimeError(f"system package copyright evidence is incomplete: {missing}")
    return packages


def verified_build_inputs() -> dict[str, str]:
    actual = {path: sha256_file(Path(path)) for path in EXPECTED_BUILD_INPUTS}
    if actual != EXPECTED_BUILD_INPUTS:
        raise RuntimeError("source licence, patch or dependency lock identity differs")
    return actual


def vendored_apache_headers() -> list[dict[str, str]]:
    root = Path("/opt/c14-10-vggt/source/vggt/vggt/layers")
    records = []
    for path in sorted(root.glob("*.py")):
        if "Apache License, Version 2.0" in path.read_text(encoding="utf-8"):
            records.append(
                {
                    "path": path.relative_to(root.parent.parent).as_posix(),
                    "sha256": sha256_file(path),
                }
            )
    if not records:
        raise RuntimeError("vendored Apache-2.0 layer headers are absent")
    return records


def container_licence_evidence() -> list[dict[str, str]]:
    candidates = (
        Path("/NGC-DL-CONTAINER-LICENSE"),
        Path("/usr/local/cuda/LICENSE"),
        Path("/usr/local/cuda-13.2/LICENSE"),
    )
    records = [
        {"path": path.as_posix(), "sha256": sha256_file(path)}
        for path in candidates
        if path.is_file()
    ]
    if not records:
        raise RuntimeError("CUDA container licence evidence is absent")
    return records


def metadata_only_licence_exception(
    distribution: importlib.metadata.Distribution,
) -> dict[str, str] | None:
    """Recognise the exact zero-code CUDA metapackage; never waive payload licences."""
    metadata = distribution.metadata
    if metadata["Name"] != "cuda-toolkit" or distribution.version != "13.2.1":
        return None
    description = metadata.get("Description") or ""
    marker = "meta-package (a package that contains no software"
    files = [path.as_posix() for path in distribution.files or []]
    expected_prefix = "cuda_toolkit-13.2.1.dist-info/"
    if (
        marker not in description
        or not files
        or any(not path.startswith(expected_prefix) for path in files)
    ):
        raise RuntimeError("cuda-toolkit is not the frozen zero-code metapackage")
    return {
        "basis": "zero-code-metapackage; component and container licences audited separately",
        "descriptionSha256": hashlib.sha256(description.encode()).hexdigest(),
        "termsUrl": CUDA_TOOLKIT_TERMS_URL,
    }


def execute(output: Path) -> None:
    import gtsam  # type: ignore[import-not-found]
    import torch  # type: ignore[import-not-found]
    from vggt.models.vggt import VGGT  # type: ignore[import-not-found]
    from vggt_slam.solver import Solver  # type: ignore[import-not-found]

    packages = []
    names = set()
    for distribution in sorted(
        importlib.metadata.distributions(), key=lambda item: item.metadata["Name"].lower()
    ):
        metadata = distribution.metadata
        name = metadata["Name"]
        names.add(name.lower().replace("_", "-"))
        legacy_licence = metadata.get("License")
        if legacy_licence is not None and legacy_licence.strip().upper() == "UNKNOWN":
            legacy_licence = None
        metadata_exception = metadata_only_licence_exception(distribution)
        licence_files = []
        for declared in metadata.get_all("License-File") or []:
            path = Path(str(distribution.locate_file(declared)))
            if path.is_file() and not path.is_symlink():
                licence_files.append({"name": declared, "sha256": sha256_file(path)})
        packages.append(
            {
                "name": name,
                "version": distribution.version,
                "licenceExpression": metadata.get("License-Expression"),
                "metadataOnlyLicenceException": metadata_exception,
                "licenceClassifiers": sorted(
                    value
                    for value in metadata.get_all("Classifier") or []
                    if value.startswith("License ::")
                ),
                "legacyLicenceFieldSha256": (
                    hashlib.sha256(legacy_licence.encode()).hexdigest() if legacy_licence else None
                ),
                "licenceFiles": licence_files,
            }
        )
    missing_licence_evidence = [
        item["name"]
        for item in packages
        if not (
            item["licenceExpression"]
            or item["licenceClassifiers"]
            or item["legacyLicenceFieldSha256"]
            or item["licenceFiles"]
            or item["metadataOnlyLicenceException"]
        )
    ]
    if missing_licence_evidence:
        raise RuntimeError(
            f"Python package licence evidence is incomplete: {missing_licence_evidence}"
        )
    prohibited = {
        "gradio",
        "huggingface-hub",
        "matplotlib",
        "opencv-python-headless",
        "open3d",
        "perception-models",
        "salad",
        "sam3",
        "viser",
    }
    present = sorted(prohibited & names)
    if present:
        raise RuntimeError(f"optional dependency quarantine failed: {present}")
    required_symbols = ("SL4", "PriorFactorSL4", "BetweenFactorSL4")
    missing = [name for name in required_symbols if not hasattr(gtsam, name)]
    if missing:
        raise RuntimeError(f"GTSAM SL4 bindings are incomplete: {missing}")
    capability = torch.cuda.get_device_capability(0) if torch.cuda.is_available() else None
    if capability != (12, 0):
        raise RuntimeError("compute capability differs from the frozen RTX 5080 path")
    payload = {
        "auditorSha256": sha256_file(Path(__file__)),
        "authority": "private-non-commercial-research-only",
        "buildInputs": verified_build_inputs(),
        "containerLicenceFiles": container_licence_evidence(),
        "cudaAvailable": torch.cuda.is_available(),
        "cudaCapability": list(capability),
        "executedImportClosure": [VGGT.__module__, Solver.__module__],
        "gtsamSl4Symbols": list(required_symbols),
        "optionalPackagesPresent": present,
        "packages": packages,
        "python": platform.python_version(),
        "schemaVersion": "c14-10-vggt-nc-environment-audit-v1",
        "sourceTrees": verified_source_trees("patched"),
        "systemPackages": system_packages(),
        "torch": torch.__version__,
        "vendoredApache20HeaderFiles": vendored_apache_headers(),
    }
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(
            json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True).encode()
            + b"\n"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    parser.add_argument("--verify-source-trees", choices=("unpatched", "patched"))
    args = parser.parse_args()
    if args.verify_source_trees is not None:
        if args.output is not None:
            parser.error("--output is not used for a source-tree-only verification")
        print(
            json.dumps(
                verified_source_trees(args.verify_source_trees),
                ensure_ascii=True,
                separators=(",", ":"),
                sort_keys=True,
            )
        )
        return
    if args.output is None:
        parser.error("--output is required for the complete environment audit")
    execute(args.output)


if __name__ == "__main__":
    main()
