"""Independent, pinned OpenImageIO inspection for one staged C14 EXR artifact."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy  # type: ignore[import-not-found]  # Blender-only runtime module.
import numpy as np  # type: ignore[import-not-found]  # Authorised-host dependency.
import OpenImageIO as oiio  # type: ignore[import-not-found]  # Authorised-host dependency.

MAX_CHANNELS = 128
MAX_SUBIMAGES = 16


def parse_arguments() -> argparse.Namespace:
    try:
        separator = sys.argv.index("--")
    except ValueError as exc:
        raise RuntimeError("C14_EXR_ARGUMENT_SEPARATOR_MISSING") from exc
    parser = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("--input", required=True)
    parser.add_argument(
        "--role",
        required=True,
        choices=("depth-exr", "multilayer-exr", "normal-exr"),
    )
    arguments, unknown = parser.parse_known_args(sys.argv[separator + 1 :])
    if unknown:
        raise RuntimeError("C14_EXR_ARGUMENT_UNKNOWN")
    return arguments


def require_staged_input(value: str) -> Path:
    workspace = Path.cwd().resolve(strict=True)
    candidate = Path(value)
    if not candidate.is_absolute():
        raise RuntimeError("C14_EXR_PATH_NOT_ABSOLUTE")
    resolved = candidate.resolve(strict=True)
    if resolved.parent != workspace or resolved.name != "input.exr":
        raise RuntimeError("C14_EXR_PATH_OUTSIDE_WORKSPACE")
    stat = resolved.lstat()
    if resolved.is_symlink() or not resolved.is_file() or stat.st_size < 1:
        raise RuntimeError("C14_EXR_PATH_TYPE_INVALID")
    return resolved


def inspect(path: Path) -> dict[str, object]:
    image = oiio.ImageInput.open(str(path))
    if image is None:
        raise RuntimeError("C14_EXR_OPEN_FAILED")
    channels: list[str] = []
    dimensions: tuple[int, int] | None = None
    all_finite = True
    try:
        for subimage in range(MAX_SUBIMAGES):
            spec = image.spec()
            width, height = spec.width, spec.height
            if width < 1 or height < 1:
                raise RuntimeError("C14_EXR_DIMENSIONS_INVALID")
            if dimensions is None:
                dimensions = (width, height)
            elif dimensions != (width, height):
                raise RuntimeError("C14_EXR_DIMENSIONS_MISMATCH")
            names = [str(name) for name in spec.channelnames]
            if not names or len(names) > MAX_CHANNELS or len(channels) + len(names) > MAX_CHANNELS:
                raise RuntimeError("C14_EXR_CHANNELS_INVALID")
            pixels = image.read_image(format=oiio.FLOAT)
            if pixels is None:
                raise RuntimeError("C14_EXR_PIXELS_UNREADABLE")
            all_finite = all_finite and bool(np.isfinite(pixels).all())
            channels.extend(names)
            if not image.seek_subimage(subimage + 1, 0):
                break
        else:
            raise RuntimeError("C14_EXR_SUBIMAGE_LIMIT")
    finally:
        image.close()
    if dimensions is None:
        raise RuntimeError("C14_EXR_NO_SUBIMAGE")
    return {
        "allFinite": all_finite,
        "channels": channels,
        "heightPx": dimensions[1],
        "schemaVersion": "c14-exr-inspection-v1",
        "widthPx": dimensions[0],
    }


def main() -> None:
    arguments = parse_arguments()
    result = inspect(require_staged_input(arguments.input))
    # bpy is imported to pin this script to Blender's bundled OIIO ABI. Do not
    # remove it even though no scene is opened by this non-rendering inspector.
    assert bpy.app.version_string
    print("C14_EXR_INSPECTION " + json.dumps(result, separators=(",", ":"), sort_keys=True))


if __name__ == "__main__":
    main()
