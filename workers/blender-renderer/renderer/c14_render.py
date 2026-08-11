"""C14 authorised-host Blender driver.

The TypeScript subprocess boundary is covered by inert-fixture tests. This driver is run only
through the fixed, offline argument array after its hash has been pinned in a render-scene
manifest. The authorised-host C14 acceptance profile uses a repository-owned synthetic scene and
records the exact Blender build and output inspection separately from those unit tests.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
from pathlib import Path

import bpy  # type: ignore[import-not-found]  # Blender-only runtime module.
from mathutils import Vector  # type: ignore[import-not-found]  # Blender-only runtime module.

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
    parser.add_argument("--protected-objects", required=True)
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
    if (
        resolved.is_symlink()
        or (directory and not resolved.is_dir())
        or (not directory and not resolved.is_file())
    ):
        raise RuntimeError("C14_PATH_TYPE_INVALID")
    if stat.st_size > 100 * 1024 * 1024 and not directory:
        raise RuntimeError("C14_INPUT_TOO_LARGE")
    return resolved


def load_manifest(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("C14_MANIFEST_INVALID")
    if (
        payload.get("schemaVersion") != REQUIRED_SCHEMA
        or payload.get("worldAssumption") != SAFE_WORLD
    ):
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


def load_protected_objects(path: Path, manifest: dict[str, object]) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise RuntimeError("C14_PROTECTED_OBJECTS_INVALID")
    object_ids = payload.get("objectIds")
    object_bounds = payload.get("objectBounds")
    protected_ids = manifest.get("protectedElementIds")
    if (
        not isinstance(object_ids, list)
        or not isinstance(object_bounds, list)
        or not isinstance(protected_ids, list)
        or any(not isinstance(item, str) or not item for item in object_ids)
        or sorted(object_ids) != object_ids
        or sorted(protected_ids) != protected_ids
        or object_ids != protected_ids
        or len(object_ids) != len(set(object_ids))
        or len(object_bounds) != len(object_ids)
    ):
        raise RuntimeError("C14_PROTECTED_OBJECTS_INVALID")
    bounds_by_id: dict[str, tuple[Vector, Vector]] = {}
    for entry in object_bounds:
        if not isinstance(entry, dict):
            raise RuntimeError("C14_PROTECTED_OBJECTS_INVALID")
        element_id = entry.get("elementId")
        minimum = entry.get("minimumMetres")
        maximum = entry.get("maximumMetres")
        if (
            not isinstance(element_id, str)
            or element_id in bounds_by_id
            or not isinstance(minimum, list)
            or not isinstance(maximum, list)
            or len(minimum) != 3
            or len(maximum) != 3
            or any(
                not isinstance(value, (int, float)) or not math.isfinite(value)
                for value in minimum + maximum
            )
            or any(minimum[index] > maximum[index] for index in range(3))
        ):
            raise RuntimeError("C14_PROTECTED_OBJECTS_INVALID")
        bounds_by_id[element_id] = (Vector(minimum), Vector(maximum))
    if sorted(bounds_by_id) != object_ids:
        raise RuntimeError("C14_PROTECTED_OBJECTS_INVALID")
    return {"bounds": bounds_by_id, "objectIds": object_ids}


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


def srgb8_to_scene_linear(value: int) -> float:
    channel = value / 255.0
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def colour_temperature_rgb(kelvin: int) -> tuple[float, float, float]:
    # This is intentionally identical to the pinned C10 compiler conversion.
    temperature = kelvin / 100.0
    red = 255.0 if temperature <= 66 else 329.698727446 * (temperature - 60) ** -0.1332047592
    green = (
        99.4708025861 * math.log(temperature) - 161.1195681661
        if temperature <= 66
        else 288.1221695283 * (temperature - 60) ** -0.0755148492
    )
    blue = (
        255.0
        if temperature >= 66
        else 0.0
        if temperature <= 19
        else 138.5177312231 * math.log(temperature - 10) - 305.0447927307
    )
    def normalise(channel: float) -> float:
        return min(255.0, max(0.0, channel)) / 255.0

    return (normalise(red), normalise(green), normalise(blue))


def configure_materials(manifest: dict[str, object]) -> None:
    values = manifest["materials"]
    assert isinstance(values, list)
    objects = imported_objects_by_element()
    for entry in values:
        assert isinstance(entry, dict)
        element_id = entry["elementId"]
        item = objects.get(element_id)
        if item is None or item.type != "MESH":
            raise RuntimeError("C14_MATERIAL_TARGET_MISSING")
        base_colour = entry["baseColourSrgb8"]
        emissive = entry["emissiveSrgb8"]
        if not isinstance(base_colour, list) or not isinstance(emissive, list):
            raise RuntimeError("C14_MATERIAL_INVALID")
        material = bpy.data.materials.new(f"C14Material-{entry['materialId']}")
        material.use_nodes = True
        nodes = material.node_tree.nodes
        nodes.clear()
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        output = nodes.new("ShaderNodeOutputMaterial")
        material.node_tree.links.new(shader.outputs["BSDF"], output.inputs["Surface"])
        shader.inputs["Base Color"].default_value = tuple(
            srgb8_to_scene_linear(int(channel)) for channel in base_colour
        ) + (1.0,)
        shader.inputs["Metallic"].default_value = entry["metallicBasisPoints"] / 10_000.0
        shader.inputs["Roughness"].default_value = entry["roughnessBasisPoints"] / 10_000.0
        emission_colour = tuple(
            srgb8_to_scene_linear(int(channel)) for channel in emissive
        ) + (1.0,)
        if "Emission Color" in shader.inputs:
            shader.inputs["Emission Color"].default_value = emission_colour
        elif "Emission" in shader.inputs:
            shader.inputs["Emission"].default_value = emission_colour
        item.data.materials.clear()
        item.data.materials.append(material)


def configure_lights(manifest: dict[str, object]) -> None:
    values = manifest["lights"]
    assert isinstance(values, list)
    scene = bpy.context.scene
    for item in list(scene.objects):
        if item.type == "LIGHT":
            bpy.data.objects.remove(item, do_unlink=True)
    for entry in values:
        assert isinstance(entry, dict)
        if entry["kind"] != "point" or entry["conversionPolicy"] != "c14-photometric-to-blender-v1":
            raise RuntimeError("C14_LIGHT_POLICY_INVALID")
        light_data = bpy.data.lights.new(f"C14Light-{entry['lightId']}", "POINT")
        light_data.energy = entry["luminousFluxLumens"] / (4.0 * math.pi)
        light_data.color = colour_temperature_rgb(entry["colourTemperatureKelvin"])
        light = bpy.data.objects.new(f"C14Light-{entry['lightId']}", light_data)
        bpy.context.collection.objects.link(light)
        light.location = point_metres(entry["position"])


def configure_cycles_device(requested_device: object) -> None:
    """Select the exact declared Cycles device or fail before any render starts.

    In particular, do not accept Blender's CPU fallback for a declared Metal,
    CUDA or OptiX profile: the profile is part of the immutable result manifest.
    """
    if requested_device == "cpu":
        bpy.context.scene.cycles.device = "CPU"
        return
    backends = {"metal": "METAL", "cuda": "CUDA", "optix": "OPTIX"}
    backend = backends.get(str(requested_device))
    if backend is None:
        raise RuntimeError("C14_RENDER_DEVICE_INVALID")
    addon = bpy.context.preferences.addons.get("cycles")
    if addon is None or not hasattr(addon, "preferences"):
        raise RuntimeError("C14_RENDER_DEVICE_UNAVAILABLE")
    preferences = addon.preferences
    try:
        preferences.compute_device_type = backend
        preferences.get_devices()
        candidates = [
            device
            for device in preferences.devices
            if str(getattr(device, "type", "")).upper() == backend
        ]
        if not candidates:
            raise RuntimeError("C14_RENDER_DEVICE_UNAVAILABLE")
        for device in candidates:
            device.use = True
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("C14_RENDER_DEVICE_UNAVAILABLE") from exc
    bpy.context.scene.cycles.device = "GPU"


def configure_scene(manifest: dict[str, object], output: Path) -> None:
    profile = manifest["profile"]
    assert isinstance(profile, dict)
    scene = bpy.context.scene
    # Blender 5.2 exposes the maintained Eevee engine as ``BLENDER_EEVEE``.
    # Earlier 4.x/5.0-era builds used ``BLENDER_EEVEE_NEXT``; selecting that
    # retired identifier makes the otherwise deterministic acceptance profile
    # fail before it can create any controlled artifact.
    scene.render.engine = "BLENDER_EEVEE" if profile["engine"] == "eevee" else "CYCLES"
    scene.render.resolution_x = profile["widthPx"]
    scene.render.resolution_y = profile["heightPx"]
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = profile["transparentBackground"]
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.display_settings.display_device = "sRGB"
    # The render-result file is only a compositor input. The compositor below writes
    # the published multilayer artifact; this transient is deleted after the pass.
    scene.render.filepath = str(output / "render-result.exr")
    # Blender 5.2 removed the legacy ``OPEN_EXR_MULTILAYER`` enum value from
    # Scene.render image settings. The compositor file-output node still supports
    # it and is therefore the only source of the published diagnostic EXR.
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.exr_codec = "ZIP"
    view_layer = scene.view_layers[0]
    view_layer.use_pass_z = True
    view_layer.use_pass_normal = True
    view_layer.use_pass_cryptomatte_object = True
    view_layer.pass_cryptomatte_depth = 6
    if profile["engine"] == "cycles":
        configure_cycles_device(profile["device"])
        scene.cycles.samples = profile["samples"]
        scene.cycles.seed = profile["seed"]
        scene.cycles.use_denoising = profile["denoise"] != "none"
        scene.render.threads_mode = "FIXED"
        scene.render.threads = profile["threads"]


def configure_diagnostic_outputs(output: Path) -> None:
    scene = bpy.context.scene
    # Blender 5.2 moved compositor state from ``Scene.node_tree`` to a named
    # compositor node group. Keep the legacy branch for pinned pre-5.2 hosts
    # because the render manifest records the exact Blender build.
    if bpy.app.version >= (5, 2, 0):
        tree = bpy.data.node_groups.new("C14DiagnosticCompositor", "CompositorNodeTree")
        scene.compositing_node_group = tree
        tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        nodes = tree.nodes
        links = tree.links
    else:
        scene.use_nodes = True
        nodes = scene.node_tree.nodes
        links = scene.node_tree.links
    nodes.clear()
    final_output = nodes.new(
        "NodeGroupOutput" if bpy.app.version >= (5, 2, 0) else "CompositorNodeComposite"
    )
    layers = nodes.new("CompositorNodeRLayers")
    links.new(layers.outputs["Image"], final_output.inputs[0])
    # Blender 5.2 removed ``OPEN_EXR_MULTILAYER`` from Scene.render settings,
    # but retains it for a compositor file-output node. One compositor target
    # owns the exact Combined, depth, normal and Cryptomatte channel bundle.
    # It is separate from the scene render-result file, which is never published.
    multilayer = nodes.new("CompositorNodeOutputFile")
    multilayer.format.file_format = "OPEN_EXR_MULTILAYER"
    multilayer.format.color_depth = "32"
    multilayer.format.exr_codec = "ZIP"
    if bpy.app.version >= (5, 2, 0):
        multilayer.directory = str(output)
        multilayer.file_name = "multilayer"
        for socket_type, name, source in (
            ("RGBA", "Combined", "Image"),
            ("FLOAT", "Z", "Depth"),
            ("VECTOR", "Normal", "Normal"),
            ("RGBA", "CryptoObject00", "CryptoObject00"),
        ):
            multilayer.file_output_items.new(socket_type, name)
            links.new(layers.outputs[source], multilayer.inputs[name])
    else:
        multilayer.base_path = str(output)
        multilayer.file_slots[0].path = "multilayer"
        links.new(layers.outputs["Image"], multilayer.inputs[0])
    for name, socket in (("depth", "Depth"), ("normal", "Normal")):
        target = nodes.new("CompositorNodeOutputFile")
        # The Blender 5.2 render-result enum and compositor file-output enum
        # intentionally differ: ``OPEN_EXR`` versus
        # ``OPEN_EXR_MULTILAYER``. This node emits one typed diagnostic pass.
        target.format.file_format = (
            "OPEN_EXR_MULTILAYER" if bpy.app.version >= (5, 2, 0) else "OPEN_EXR"
        )
        target.format.color_depth = "32"
        target.format.exr_codec = "ZIP"
        if bpy.app.version >= (5, 2, 0):
            target.directory = str(output)
            target.file_name = name
            target.file_output_items.new("FLOAT" if socket == "Depth" else "VECTOR", name)
            links.new(layers.outputs[socket], target.inputs[name])
        else:
            target.base_path = str(output)
            target.file_slots[0].path = name
            links.new(layers.outputs[socket], target.inputs[0])


def imported_objects_by_element() -> dict[str, bpy.types.Object]:
    result: dict[str, bpy.types.Object] = {}
    for item in bpy.context.scene.objects:
        element_id = item.get("canonicalElementId") or item.name
        if isinstance(element_id, str) and element_id:
            if element_id in result:
                raise RuntimeError("C14_PROTECTED_OBJECT_DUPLICATE")
            result[element_id] = item
    return result


def object_bounds(item: bpy.types.Object) -> tuple[Vector, Vector]:
    if item.type != "MESH":
        return (item.matrix_world.translation.copy(), item.matrix_world.translation.copy())
    corners = [item.matrix_world @ Vector(corner) for corner in item.bound_box]
    if len(corners) != 8 or any(
        not all(math.isfinite(value) for value in point) for point in corners
    ):
        raise RuntimeError("C14_IMPORTED_BOUNDS_INVALID")
    return (
        Vector(tuple(min(point[index] for point in corners) for index in range(3))),
        Vector(tuple(max(point[index] for point in corners) for index in range(3))),
    )


def verify_imported_protected_objects(
    manifest: dict[str, object], protected: dict[str, object]
) -> None:
    expected_ids = protected["objectIds"]
    expected_bounds = protected["bounds"]
    assert isinstance(expected_ids, list)
    assert isinstance(expected_bounds, dict)
    imported = imported_objects_by_element()
    if any(element_id not in imported for element_id in expected_ids):
        raise RuntimeError("C14_PROTECTED_OBJECT_MISSING")
    # glTF source values are float32. Two millimetres matches the frozen C13/C14
    # import tolerance while still rejecting a geometry translation or scale drift.
    tolerance_metres = 0.002
    for element_id in expected_ids:
        item = imported[element_id]
        expected = expected_bounds[element_id]
        if not isinstance(expected, tuple) or len(expected) != 2:
            raise RuntimeError("C14_PROTECTED_OBJECTS_INVALID")
        actual_minimum, actual_maximum = object_bounds(item)
        expected_minimum, expected_maximum = expected
        differences = [
            abs(actual_minimum[index] - expected_minimum[index]) for index in range(3)
        ] + [
            abs(actual_maximum[index] - expected_maximum[index]) for index in range(3)
        ]
        if any(not math.isfinite(value) or value > tolerance_metres for value in differences):
            raise RuntimeError("C14_IMPORTED_BOUNDS_MISMATCH")


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
    if bpy.app.version >= (5, 2, 0):
        scene.compositing_node_group = None
    else:
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
    for role in ("multilayer", "depth", "normal"):
        candidates = sorted(output.glob(f"{role}*.exr"))
        if len(candidates) != 1:
            raise RuntimeError("C14_DIAGNOSTIC_OUTPUT_MISSING")
        shutil.move(str(candidates[0]), str(output / f"{role}.exr"))


def main() -> None:
    arguments = parse_arguments()
    workspace = Path.cwd().resolve(strict=True)
    manifest_path = require_workspace_path(arguments.render_scene, workspace, directory=False)
    glb_path = require_workspace_path(arguments.source_glb, workspace, directory=False)
    protected_path = require_workspace_path(arguments.protected_objects, workspace, directory=False)
    output = require_workspace_path(arguments.output_directory, workspace, directory=True)
    manifest = load_manifest(manifest_path)
    protected = load_protected_objects(protected_path, manifest)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path), import_pack_images=False)
    verify_imported_protected_objects(manifest, protected)
    configure_camera(manifest)
    configure_scene(manifest, output)
    configure_materials(manifest)
    configure_lights(manifest)
    configure_diagnostic_outputs(output)
    bpy.ops.render.render(write_still=True)
    rename_diagnostic_outputs(output)
    for transient in output.glob("render-result*.exr"):
        transient.unlink()
    scene = bpy.context.scene
    if bpy.app.version >= (5, 2, 0):
        scene.compositing_node_group = None
    else:
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
