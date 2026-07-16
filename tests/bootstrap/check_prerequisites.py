#!/usr/bin/env python3
"""Fail-fast prerequisite audit for a clean C0 development checkout."""

from __future__ import annotations

import argparse
import json
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def run(command: list[str]) -> str:
    completed = subprocess.run(
        command,
        cwd=REPOSITORY_ROOT,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    if completed.returncode != 0:
        output = completed.stdout.strip() or "no diagnostic output"
        raise RuntimeError(f"`{' '.join(command)}` failed: {output}")
    return completed.stdout.strip()


def executable(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise RuntimeError(f"required executable `{name}` is not on PATH")
    return path


def exact_version(name: str, command: list[str], expected: str, prefix: str = "") -> str:
    executable(name)
    actual = run(command).splitlines()[0].strip()
    normalised = actual.removeprefix(prefix)
    if normalised != expected:
        raise RuntimeError(f"{name} must be {expected}; found {actual}")
    return actual


def check_python_runtime(expected: str) -> str:
    executable("uv")
    runtime = Path(run(["uv", "python", "find", expected]).splitlines()[-1])
    actual = run([str(runtime), "--version"]).splitlines()[0]
    match = re.fullmatch(r"Python (\d+\.\d+)(?:\.\d+)?", actual)
    if match is None or match.group(1) != expected:
        raise RuntimeError(f"uv must resolve Python {expected}; found {actual}")
    return f"{actual} ({runtime})"


def check_repository() -> str:
    inside = run(["git", "rev-parse", "--is-inside-work-tree"])
    if inside != "true":
        raise RuntimeError("the current directory is not a Git worktree")
    root = Path(run(["git", "rev-parse", "--show-toplevel"])).resolve()
    if root != REPOSITORY_ROOT:
        raise RuntimeError(f"run from the repository worktree; Git resolved {root}")
    return run(["git", "rev-parse", "--short", "HEAD"])


def check_docker() -> str:
    executable("docker")
    compose = run(["docker", "compose", "version", "--short"])
    server = run(["docker", "info", "--format", "{{.ServerVersion}}"])
    if not server:
        raise RuntimeError("Docker is installed but its daemon did not report a version")
    return f"Compose {compose}; engine {server}"


def check_ios() -> str:
    if platform.system() != "Darwin":
        raise RuntimeError("iOS Simulator verification requires macOS")
    executable("xcodebuild")
    executable("xcrun")
    executable("xcodegen")
    xcode = run(["xcodebuild", "-version"]).replace("\n", "; ")
    runtimes = run(["xcrun", "simctl", "list", "runtimes", "available"])
    if "iOS" not in runtimes:
        raise RuntimeError("Xcode has no available iOS Simulator runtime")
    return f"{xcode}; XcodeGen {run(['xcodegen', '--version'])}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--include-ios",
        action="store_true",
        help="also require full Xcode, XcodeGen, and an iOS Simulator runtime",
    )
    args = parser.parse_args()

    package = json.loads((REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8"))
    node_version = (REPOSITORY_ROOT / ".nvmrc").read_text(encoding="utf-8").strip()
    python_version = (REPOSITORY_ROOT / ".python-version").read_text(encoding="utf-8").strip()
    pnpm_version = package["packageManager"].split("@", maxsplit=1)[1]

    checks = [
        ("Git worktree", check_repository),
        ("Node.js", lambda: exact_version("node", ["node", "--version"], node_version, "v")),
        ("pnpm", lambda: exact_version("pnpm", ["pnpm", "--version"], pnpm_version)),
        ("uv", lambda: run([executable("uv"), "--version"])),
        ("Python", lambda: check_python_runtime(python_version)),
        ("local containers", check_docker),
    ]
    if args.include_ios:
        checks.append(("iOS toolchain", check_ios))

    failures: list[str] = []
    for label, check in checks:
        try:
            detail = check()
            print(f"[ok] {label}: {detail}")
        except (KeyError, OSError, RuntimeError, ValueError) as error:
            failures.append(f"{label}: {error}")
            print(f"[failed] {label}: {error}", file=sys.stderr)

    if failures:
        print("\nPrerequisite audit failed:", file=sys.stderr)
        for failure in failures:
            print(f"- {failure}", file=sys.stderr)
        return 1

    print("\nAll requested development prerequisites are available.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
