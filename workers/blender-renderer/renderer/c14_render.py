"""C14 authorised-host Blender driver.

This file is deliberately not executed by repository tests. The Mac checkpoint gate is on hold;
tests exercise the TypeScript subprocess boundary with inert fixtures. On an authorised render
host Blender imports this script via the fixed, offline argument array.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
import shutil
import sys

import bpy
from mathutils import Vector


REQUIRED_SCHEMA = "c14-render-scene-manifest-v1"
SAFE_WORLD = "neutral-studio-no-address-or-daylight-inference-v1"


def parse_arguments() -> argparse.Namespace:
    try:
        separator = sys.argv.index("--")
    except ValueError as exc:
        raise RuntimeError("C14_ARGUMENT_SEPARATOR_MISSING") from exc
    parser = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    parser.add_argument("--render-scene", required=True)
    parser.add_argument("--source-glb", required=True)
    parser.add_argument("--output-directory", required=True)
    arguments, unknown = parser.parse_known_args(sys.argv[separator + 1 :])
    if unknown:
        raise RuntimeError("C14_ARGUMENT_UNKNOWN")
    return arguments


def require_workspace_path(value: str, workspace: Path, *, directory: bool) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        raise RuntimeError("C14_PATH_NOT_ABSOLUTE")
    resolved = candidate.resolve(strict=True)
    if resolved.parent != workspace and not (directory and resolved == workspace / "output"):
        raise RuntimeError("C14_PATH_OUTSIDE_WORKSPACE")
    stat = resolved.lstat()
    if resolved.is_symlink() or (directory and not resolved.is_dir()) or (not directory and not resolved.is_file()):
        raise RuntimeError("C14_PATH_TYPE_INVALID")
    if stat.st_size > 100 * 1024 * 1024 and not directory:
        raise RuntimeError("C14_INPUT_TOO_LARGE")
    return resolved


def load_manifest(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("C14_MANIFEST_INVALID")
    if payload.get("schemaVersion") != REQUIRED_SCHEMA or payload.get("worldAssumption") != SAFE_WORLD:
        raise RuntimeError("C14_MANIFEST_POLICY_INVALID")
    forbidden = {"blend", "python", "driver", "expression", "path", "uri", "environment"}
    serialized_keys: list[str] = []

    def visit(value: object) -> None:
        if isinstance(value, dict):
            serialized_keys.extend(str(key).lower() for key in value)
            for nested in value.values():
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    visit(payload)
    if forbidden.intersection(serialized_keys):
        raise RuntimeError("C14_MANIFEST_EXECUTABLE_FIELD")
    return payload


def point_metres(point: dict[str, int]) -> Vector:
    return Vector((point["xMm"] / 1000.0, point["yMm"] / 1000.0, point["zMm"] / 1000.0))


def configure_camera(manifest: dict[str, object]) -> None:
    camera_manifest = manifest["camera"]
    assert isinstance(camera_manifest, dict)
    position = point_metres(camera_manifest["position"])
    target = point_metres(camera_manifest["target"])
    direction = target - position
    if not all(math.isfinite(value) for value in direction) or direction.length <= 1e-9:
        raise RuntimeError("C14_CAMERA_INVALID")
    camera_data = bpy.data.cameras.new("C14CanonicalCamera")
    camera = bpy.data.objects.new("C14CanonicalCamera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = position
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    camera_data.angle_y = math.radians(camera_manifest["verticalFovMilliDegrees"] / 1000.0)
    camera_data.clip_start = camera_manifest["clipStartMm"] / 1000.0
    camera_data.clip_end = camera_manifest["clipEndMm"] / 1000.0
    bpy.context.scene.camera = camera


def configure_scene(manifest: dict[str, object], output: Path) -> None:
    profile = manifest["profile"]
    assert isinstance(profile, dict)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if profile["engine"] == "eevee" else "CYCLES"
    scene.render.resolution_x = profile["widthPx"]
    scene.render.resolution_y = profile["heightPx"]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = profile["transparentBackground"]
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.display_settings.display_device = "sRGB"
    scene.render.filepath = str(output / "multilayer.exr")
    scene.render.image_settings.file_format = "OPEN_EXR_MULTILAYER"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.exr_codec = "ZIP"
    view_layer = scene.view_layers[0]
    view_layer.use_pass_z = True
    view_layer.use_pass_normal = True
    view_layer.use_pass_cryptomatte_object = True
    view_layer.pass_cryptomatte_depth = 6
    if profile["engine"] == "cycles":
        scene.cycles.samples = profile["samples"]
        scene.cycles.seed = profile["seed"]
        scene.cycles.use_denoising = profile["denoise"] != "none"
        scene.render.threads_mode = "FIXED"
        scene.render.threads = profile["threads"]


def configure_diagnostic_outputs(output: Path) -> None:
    scene = bpy.context.scene
    scene.use_nodes = True
    nodes = scene.node_tree.nodes
    links = scene.node_tree.links
    nodes.clear()
    layers = nodes.new("CompositorNodeRLayers")
    for name, socket in (("depth", "Depth"), ("normal", "Normal")):
        target = nodes.new("CompositorNodeOutputFile")
        target.base_path = str(output)
        target.file_slots[0].path = name
        target.format.file_format = "OPEN_EXR"
        target.format.color_depth = "32"
        target.format.exr_codec = "ZIP"
        links.new(layers.outputs[socket], target.inputs[0])


def imported_objects_by_element() -> dict[str, bpy.types.Object]:
    result: dict[str, bpy.types.Object] = {}
    for item in bpy.context.scene.objects:
        element_id = item.get("canonicalElementId") or item.name
        if isinstance(element_id, str) and element_id:
            result[element_id] = item
    return result


def render_segmentation(manifest: dict[str, object], output: Path) -> None:
    palette = manifest["segmentationPalette"]
    assert isinstance(palette, list)
    objects = imported_objects_by_element()
    for entry in palette:
        assert isinstance(entry, dict)
        element_id = entry["elementId"]
        rgb = entry["rgb8"]
        item = objects.get(element_id)
        if item is None:
            raise RuntimeError("C14_PROTECTED_OBJECT_MISSING")
        material = bpy.data.materials.new(f"C14Segmentation-{element_id}")
        material.diffuse_color = (rgb[0] / 255.0, rgb[1] / 255.0, rgb[2] / 255.0, 1.0)
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        emission = nodes.new("ShaderNodeEmission")
        emission.inputs["Color"].default_value = material.diffuse_color
        output_node = nodes.new("ShaderNodeOutputMaterial")
        material.node_tree.links.new(emission.outputs[0], output_node.inputs[0])
        item.data.materials.clear()
        item.data.materials.append(material)
    scene = bpy.context.scene
    scene.use_nodes = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.filepath = str(output / "segmentation.png")
    if scene.world is not None:
        scene.world.color = (0.0, 0.0, 0.0)
    for light in [item for item in scene.objects if item.type == "LIGHT"]:
        light.hide_render = True
    bpy.ops.render.render(write_still=True)


def rename_diagnostic_outputs(output: Path) -> None:
    for role in ("depth", "normal"):
        candidates = sorted(output.glob(f"{role}*.exr"))
        if len(candidates) != 1:
            raise RuntimeError("C14_DIAGNOSTIC_OUTPUT_MISSING")
        shutil.move(str(candidates[0]), str(output / f"{role}.exr"))


def main() -> None:
    arguments = parse_arguments()
    workspace = Path.cwd().resolve(strict=True)
    manifest_path = require_workspace_path(arguments.render_scene, workspace, directory=False)
    glb_path = require_workspace_path(arguments.source_glb, workspace, directory=False)
    output = require_workspace_path(arguments.output_directory, workspace, directory=True)
    manifest = load_manifest(manifest_path)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path), import_pack_images=False)
    configure_camera(manifest)
    configure_scene(manifest, output)
    configure_diagnostic_outputs(output)
    bpy.ops.render.render(write_still=True)
    rename_diagnostic_outputs(output)
    scene = bpy.context.scene
    scene.use_nodes = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(output / "geometry-safe.png")
    bpy.ops.render.render(write_still=True)
    render_segmentation(manifest, output)


if __name__ == "__main__":
    main()
