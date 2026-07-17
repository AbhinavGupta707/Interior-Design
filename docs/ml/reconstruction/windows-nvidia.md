# Reproducible C8 Windows/NVIDIA evidence package

## Evidence status

`NOT RUN` on the named Windows/NVIDIA workstation.

The package is ready for an independent run, but its Dockerfile, hash lock, adapter fixture tests, or a macOS browser run cannot turn this status into a pass. A completed record must come from the named workstation and retain the exact host, driver, GPU, container digest, runtime probe, package hashes, rights-cleared holdout, observations, and output hashes.

## Frozen environment

| Layer                                       | Pin                                                      |
| ------------------------------------------- | -------------------------------------------------------- |
| Host OS                                     | Windows 11 24H2, build 26100                             |
| NVIDIA Windows driver                       | 572.83                                                   |
| Minimum CUDA 11.8 compatible Windows driver | 522.06                                                   |
| Container runtime                           | Docker Desktop with WSL 2 Linux containers               |
| Container OS                                | Ubuntu 22.04, `linux/amd64`                              |
| CUDA image                                  | CUDA 11.8.0 + cuDNN 8 devel, digest in `versions.json`   |
| Python                                      | 3.10.13                                                  |
| PyTorch / torchvision                       | 2.1.2+cu118 / 0.16.2+cu118                               |
| NumPy                                       | 1.26.4                                                   |
| COLMAP                                      | 3.9.1, commit `e99036415ec0cf0f75c1d0b8d60fdd91af0d6c68` |
| Nerfstudio                                  | 1.1.5, commit `6b60855003011b2ca23c2fe3f8e2ca6314c69924` |
| gsplat                                      | 1.4.0, commit `4d3a3b69db4de0326f983ccf7b7b255271a17b01` |

The environment follows the [official Nerfstudio 1.1.5 release](https://github.com/nerfstudio-project/nerfstudio/releases/tag/v1.1.5), [official Nerfstudio container recipe](https://github.com/nerfstudio-project/nerfstudio/blob/v1.1.5/Dockerfile), [official gsplat 1.4.0 release](https://github.com/nerfstudio-project/gsplat/releases/tag/v1.4.0), [COLMAP 3.9.1 source tag](https://github.com/colmap/colmap/tree/3.9.1), and [NVIDIA CUDA 11.8 release notes](https://docs.nvidia.com/cuda/archive/11.8.0/cuda-toolkit-release-notes/). The exact image digests and source identities are machine-readable in `ml/reconstruction/windows-nvidia/versions.json`.

## Package integrity

`requirements.lock` is a transitive `pip --require-hashes` lock. `package-manifest.json` records SHA-256 for every build/run input and labels the package `NOT_RUN`. Verify before build from the package directory:

```powershell
$Manifest = Get-Content .\package-manifest.json | ConvertFrom-Json
$Manifest.files.PSObject.Properties | ForEach-Object {
  $Actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.Name).Hash.ToLowerInvariant()
  if ($Actual -ne $_.Value) { throw "C8_PACKAGE_HASH_MISMATCH" }
}
```

Hash agreement proves only that the reviewed inputs were used. It does not prove a build, GPU, execution, or output.

## Required rights-cleared input

Prepare these local directories on the workstation; do not place their contents in Git:

```text
C:\C8\reconstruction-input\appearance-input.json
C:\C8\reconstruction-input\sanitized\<frame-uuid>.png|jpg|jpeg
C:\C8\reconstruction-output\              # must be empty
C:\C8\reconstruction-evidence\
```

The manifest must use `c8-neural-appearance-input-v1`, contain immutable public-domain/licensed holdout references, require service processing, and keep training use denied. The staged frames must be privacy-reviewed, metadata-stripped, exact-hash files. No customer dataset, key, signed URL, source path, or credential belongs in the package or evidence record.

## Exact command

From an elevated PowerShell whose current directory is the repository root:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\ml\reconstruction\windows-nvidia\run-acceptance.ps1
```

The script performs exactly one pinned Docker build, an exact CUDA/package runtime probe, and one offline adapter run. Runtime networking is denied; the root filesystem is read-only; only fixed input/output mounts and bounded tmpfs are writable; one GPU, 16 CPUs, 48 GiB RAM/swap, 1,024 processes, and 8 GiB shared memory are allowed. The input mount is read-only. The adapter accepts no command-line arguments.

## Expected output and evidence

Successful output contains:

- `appearance-result.json` with `c8-appearance-result-v1` and only non-dimensional authority;
- either `appearance.nerfstudio.tar` or `appearance.gsplat.ply`;
- no local path, object key, signed URL, secret, raw frame, or canonical mutation.

Before build, the script verifies every package-manifest entry and records `package-manifest-hash.json` plus `requirements-lock-hash.json`. Evidence collection then produces `runtime-probe.json`, `gpu-resource-samples.csv`, `container-resource-samples.jsonl`, `run-observation.json`, and path-free `output-artifacts.json` with output names, sizes, and hashes. The reviewer must additionally fill a copy of `evidence-template.json` with:

- package-manifest SHA-256 and built image digest;
- exact workstation/GPU/driver and runtime facts;
- holdout dataset identifier, licence, split, and rights review;
- output names, byte counts, SHA-256 values, and authority;
- registered/input frames, components, scale state, residuals where valid;
- latency and peak host/GPU memory derived from the samples;
- failure, abstention, partial, disconnected, and severe-error denominators; and
- independent reviewer identity/date outside the repository if that record is sensitive.

Never relabel a synthetic fixture, Docker build, runtime probe, empty metric, or partial log as completed neural/CUDA evidence.
