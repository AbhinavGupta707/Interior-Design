"""Isolated reconstruction workspaces and verified source staging."""

import hashlib
import os
import shutil
import tempfile
from pathlib import Path, PurePosixPath

from .errors import ReconstructionError
from .hashing import validate_sha256


def safe_workspace_path(root: Path, relative: str) -> Path:
    """Resolve a portable relative path without following workspace symlinks."""

    if not relative or "\\" in relative or "\x00" in relative:
        raise ReconstructionError("UNSAFE_PATH", "workspace path is not portable")
    parsed = PurePosixPath(relative)
    if parsed.is_absolute() or any(part in {"", ".", ".."} for part in parsed.parts):
        raise ReconstructionError("UNSAFE_PATH", "workspace path escapes its root")
    resolved_root = root.resolve(strict=True)
    current = resolved_root
    for part in parsed.parts:
        current = current / part
        if current.is_symlink():
            raise ReconstructionError("UNSAFE_PATH", "workspace path crosses a symlink")
    resolved = current.resolve(strict=False)
    if not resolved.is_relative_to(resolved_root):
        raise ReconstructionError("UNSAFE_PATH", "workspace path escapes its root")
    return resolved


class IsolatedWorkspace:
    """A mode-0700 temporary tree that is always recursively removed."""

    def __init__(self, *, base_directory: Path | None = None) -> None:
        self._base_directory = base_directory
        self._root: Path | None = None

    @property
    def root(self) -> Path:
        if self._root is None:
            raise RuntimeError("workspace has not been entered")
        return self._root

    def __enter__(self) -> "IsolatedWorkspace":
        if self._base_directory is not None:
            self._base_directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            if self._base_directory.is_symlink():
                raise ReconstructionError("UNSAFE_PATH", "workspace base is a symlink")
        created = tempfile.mkdtemp(
            prefix="c8-reconstruction-",
            dir=str(self._base_directory) if self._base_directory is not None else None,
        )
        self._root = Path(created)
        self._root.chmod(0o700)
        return self

    def path(self, relative: str, *, create_parent: bool = False) -> Path:
        result = safe_workspace_path(self.root, relative)
        if create_parent:
            result.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        return result

    def stage_verified_file(
        self,
        source: Path,
        relative_destination: str,
        *,
        expected_sha256: str,
        maximum_bytes: int,
    ) -> Path:
        """Copy an internal source into the workspace after exact hash validation."""

        validate_sha256(expected_sha256, name="source sha256")
        if source.is_symlink() or not source.is_file():
            raise ReconstructionError("UNSAFE_SOURCE", "source is not a regular non-symlink file")
        destination = self.path(relative_destination, create_parent=True)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        digest = hashlib.sha256()
        total = 0
        descriptor = os.open(destination, flags, 0o600)
        try:
            with source.open("rb") as input_handle, os.fdopen(descriptor, "wb") as output_handle:
                descriptor = -1
                while chunk := input_handle.read(1_048_576):
                    total += len(chunk)
                    if total > maximum_bytes:
                        raise ReconstructionError(
                            "RESOURCE_LIMIT", "source exceeds its byte ceiling"
                        )
                    digest.update(chunk)
                    output_handle.write(chunk)
                output_handle.flush()
                os.fsync(output_handle.fileno())
        except Exception:
            destination.unlink(missing_ok=True)
            raise
        finally:
            if descriptor >= 0:
                os.close(descriptor)
        if total == 0 or digest.hexdigest() != expected_sha256:
            destination.unlink(missing_ok=True)
            raise ReconstructionError("SOURCE_MISMATCH", "staged source hash does not match")
        return destination

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        root = self._root
        self._root = None
        if root is not None:
            shutil.rmtree(root, ignore_errors=False)
