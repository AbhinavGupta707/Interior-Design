"""Real-format COLMAP text/binary parser fixtures and adversarial outputs."""

import struct
from pathlib import Path

import pytest
from inference_worker.reconstruction.colmap.components import image_components
from inference_worker.reconstruction.colmap.parser import read_sparse_model
from inference_worker.reconstruction.common.errors import ReconstructionError


def write_text_model(
    root: Path,
    *,
    third_disconnected: bool = False,
    first_name: str = "frame-000000.jpg",
    point_x: str = "1.0",
) -> None:
    root.mkdir(parents=True)
    (root / "cameras.txt").write_text(
        "# synthetic camera\n10 PINHOLE 100 80 50 50 50 40\n",
        encoding="utf-8",
    )
    images = (
        f"7 1 0 0 0 0 0 0 10 {first_name}\n10 10 100 20 20 900\n"
        "42 1 0 0 0 1 0 0 10 frame-000001.jpg\n12 12 100 22 22 900\n"
    )
    if third_disconnected:
        images += "99 1 0 0 0 2 0 0 10 frame-000002.jpg\n\n"
    (root / "images.txt").write_text(images, encoding="utf-8")
    (root / "points3D.txt").write_text(
        f"100 {point_x} 2.0 3.0 10 20 30 0.1 7 0 42 0\n900 4.0 5.0 6.0 40 50 60 0.2 7 1 42 1\n",
        encoding="utf-8",
    )


def _pack_binary_model(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    (root / "cameras.bin").write_bytes(
        struct.pack("<QiiQQdddd", 1, 10, 1, 100, 80, 50.0, 50.0, 50.0, 40.0)
    )
    image_records = bytearray(struct.pack("<Q", 2))
    for image_id, name, translation_x in (
        (7, b"frame-000000.jpg", 0.0),
        (42, b"frame-000001.jpg", 1.0),
    ):
        image_records.extend(
            struct.pack(
                "<idddddddi",
                image_id,
                1.0,
                0.0,
                0.0,
                0.0,
                translation_x,
                0.0,
                0.0,
                10,
            )
        )
        image_records.extend(name + b"\0")
        image_records.extend(struct.pack("<Q", 2))
        image_records.extend(struct.pack("<ddqddq", 10.0, 10.0, 100, 20.0, 20.0, 900))
    (root / "images.bin").write_bytes(image_records)
    points = bytearray(struct.pack("<Q", 2))
    for point_id, xyz, rgb, error, point_index in (
        (100, (1.0, 2.0, 3.0), (10, 20, 30), 0.1, 0),
        (900, (4.0, 5.0, 6.0), (40, 50, 60), 0.2, 1),
    ):
        points.extend(struct.pack("<QdddBBBd", point_id, *xyz, *rgb, error))
        points.extend(struct.pack("<Qiiii", 2, 7, point_index, 42, point_index))
    (root / "points3D.bin").write_bytes(points)


@pytest.mark.parametrize("model_format", ["text", "binary"])
def test_non_contiguous_ids_are_preserved_as_map_keys(tmp_path: Path, model_format: str) -> None:
    model_root = tmp_path / "model"
    if model_format == "text":
        write_text_model(model_root)
    else:
        _pack_binary_model(model_root)

    model = read_sparse_model(tmp_path, "model")

    assert set(model.cameras) == {10}
    assert set(model.images) == {7, 42}
    assert set(model.points3d) == {100, 900}
    assert len(model.points3d) == 2
    assert image_components(model) == ((7, 42),)
    assert model.source_format == model_format


def test_observation_graph_surfaces_disconnected_registered_images(tmp_path: Path) -> None:
    write_text_model(tmp_path / "model", third_disconnected=True)
    model = read_sparse_model(tmp_path, "model")
    assert image_components(model) == ((7, 42), (99,))


@pytest.mark.parametrize(
    "mutation,safe_code",
    [
        ("truncated-binary", "COLMAP_OUTPUT_TRUNCATED"),
        ("partial-binary", "COLMAP_OUTPUT_TRUNCATED"),
        ("path-traversal", "UNSAFE_PATH"),
        ("nan", "NON_FINITE_GEOMETRY"),
        ("overflow", "GEOMETRY_OVERFLOW"),
        ("truncated-text", "COLMAP_OUTPUT_TRUNCATED"),
    ],
)
def test_malformed_truncated_non_finite_and_traversal_outputs_fail_closed(
    tmp_path: Path, mutation: str, safe_code: str
) -> None:
    model_root = tmp_path / "model"
    if mutation in {"truncated-binary", "partial-binary"}:
        _pack_binary_model(model_root)
        if mutation == "truncated-binary":
            data = (model_root / "images.bin").read_bytes()
            (model_root / "images.bin").write_bytes(data[:-7])
        else:
            (model_root / "points3D.bin").unlink()
    else:
        write_text_model(
            model_root,
            first_name="../secret.jpg" if mutation == "path-traversal" else "frame-000000.jpg",
            point_x=(
                "nan"
                if mutation == "nan"
                else "1100000000000000"
                if mutation == "overflow"
                else "1"
            ),
        )
        if mutation == "truncated-text":
            (model_root / "images.txt").write_text(
                "7 1 0 0 0 0 0 0 10 frame-000000.jpg\n", encoding="utf-8"
            )
    with pytest.raises(ReconstructionError) as raised:
        read_sparse_model(tmp_path, "model")
    assert raised.value.safe_code == safe_code


def test_binary_is_preferred_and_malformed_binary_does_not_fall_back_to_text(
    tmp_path: Path,
) -> None:
    write_text_model(tmp_path / "model")
    _pack_binary_model(tmp_path / "model")
    data = (tmp_path / "model/images.bin").read_bytes()
    (tmp_path / "model/images.bin").write_bytes(data[:-1])
    with pytest.raises(ReconstructionError, match="COLMAP_OUTPUT_TRUNCATED"):
        read_sparse_model(tmp_path, "model")


def test_symlinked_model_file_is_rejected(tmp_path: Path) -> None:
    write_text_model(tmp_path / "model")
    camera = tmp_path / "model/cameras.txt"
    target = tmp_path / "camera-target.txt"
    camera.rename(target)
    camera.symlink_to(target)
    with pytest.raises(ReconstructionError, match="UNSAFE_PATH"):
        read_sparse_model(tmp_path, "model")
