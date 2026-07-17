$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$PackageRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepositoryRoot = Resolve-Path (Join-Path $PackageRoot "..\..\..")
$InputRoot = "C:\C8\reconstruction-input"
$OutputRoot = "C:\C8\reconstruction-output"
$EvidenceRoot = "C:\C8\reconstruction-evidence"
$Image = "interior-design/c8-neural:1.0.0"
$ContainerName = "c8-neural-acceptance"

foreach ($Directory in @($InputRoot, $OutputRoot, $EvidenceRoot)) {
  if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    throw "C8_DIRECTORY_MISSING"
  }
}
if ((Get-ChildItem -LiteralPath $OutputRoot -Force | Measure-Object).Count -ne 0) {
  throw "C8_OUTPUT_NOT_EMPTY"
}

$PackageManifestPath = Join-Path $PackageRoot "package-manifest.json"
$PackageManifest = Get-Content -LiteralPath $PackageManifestPath -Raw | ConvertFrom-Json
foreach ($File in $PackageManifest.files.PSObject.Properties) {
  $ActualHash = (Get-FileHash -Algorithm SHA256 (Join-Path $PackageRoot $File.Name)).Hash
  if ($ActualHash.ToLowerInvariant() -ne $File.Value) {
    throw "C8_PACKAGE_HASH_MISMATCH"
  }
}
Get-FileHash -Algorithm SHA256 $PackageManifestPath |
  Select-Object Algorithm, Hash |
  ConvertTo-Json -Compress |
  Set-Content -LiteralPath (Join-Path $EvidenceRoot "package-manifest-hash.json") -Encoding utf8
Get-FileHash -Algorithm SHA256 (Join-Path $PackageRoot "requirements.lock") |
  Select-Object Algorithm, Hash |
  ConvertTo-Json -Compress |
  Set-Content -LiteralPath (Join-Path $EvidenceRoot "requirements-lock-hash.json") -Encoding utf8

docker build --platform "linux/amd64" `
  --file (Join-Path $PackageRoot "Dockerfile") --tag $Image $RepositoryRoot
if ($LASTEXITCODE -ne 0) { throw "C8_IMAGE_BUILD_FAILED" }

$Probe = docker run --rm --platform "linux/amd64" --gpus "device=0" --network none --read-only `
  --tmpfs /tmp:rw,noexec,nosuid,size=1g `
  --entrypoint python $Image `
  -m inference_worker.reconstruction.nerfstudio.runtime_probe
if ($LASTEXITCODE -ne 0) { throw "C8_RUNTIME_PROBE_FAILED" }
$Probe | Set-Content -LiteralPath (Join-Path $EvidenceRoot "runtime-probe.json") -Encoding utf8

$DockerArguments = @(
  "run", "--rm", "--name", $ContainerName,
  "--platform", "linux/amd64",
  "--gpus", "device=0", "--network", "none", "--read-only",
  "--cpus", "16", "--memory", "48g", "--memory-swap", "48g", "--pids-limit", "1024",
  "--shm-size", "8g",
  "--tmpfs", "/tmp:rw,noexec,nosuid,size=8g",
  "--mount", "type=bind,source=$InputRoot,target=/c8/input,readonly",
  "--mount", "type=bind,source=$OutputRoot,target=/c8/output",
  "--tmpfs", "/c8/work:rw,noexec,nosuid,size=64g",
  $Image
)
$Started = Get-Date
$Process = Start-Process -FilePath "docker" -ArgumentList $DockerArguments -PassThru -NoNewWindow
$GpuSamples = [System.Collections.Generic.List[string]]::new()
$ContainerSamples = [System.Collections.Generic.List[string]]::new()
while (-not $Process.HasExited) {
  $GpuSample = nvidia-smi `
    --query-gpu=timestamp,memory.used,memory.total,utilization.gpu `
    --format=csv,noheader,nounits
  if ($LASTEXITCODE -eq 0) { $GpuSamples.Add(($GpuSample -join "`n")) }
  $ContainerSample = docker stats --no-stream --format "{{json .}}" $ContainerName
  if ($LASTEXITCODE -eq 0 -and $ContainerSample) {
    $ContainerSamples.Add(($ContainerSample -join "`n"))
  }
  Start-Sleep -Seconds 1
  $Process.Refresh()
}
$DurationMilliseconds = [int64]((Get-Date) - $Started).TotalMilliseconds
$GpuSamples |
  Set-Content -LiteralPath (Join-Path $EvidenceRoot "gpu-resource-samples.csv") -Encoding utf8
$ContainerSamples |
  Set-Content -LiteralPath (Join-Path $EvidenceRoot "container-resource-samples.jsonl") -Encoding utf8
@{
  durationMilliseconds = $DurationMilliseconds
  evidenceLabel = "LIVE_WINDOWS_NVIDIA"
  exitCode = $Process.ExitCode
  trainingUseConsent = "denied"
} | ConvertTo-Json -Compress |
  Set-Content -LiteralPath (Join-Path $EvidenceRoot "run-observation.json") -Encoding utf8
if ($Process.ExitCode -ne 0) { throw "C8_ADAPTER_RUN_FAILED" }

$OutputArtifacts = Get-ChildItem -LiteralPath $OutputRoot -File |
  Sort-Object Name |
  ForEach-Object {
    $Hash = Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName
    @{
      byteSize = $_.Length
      name = $_.Name
      sha256 = $Hash.Hash.ToLowerInvariant()
    }
  }
$OutputArtifacts | ConvertTo-Json -Compress |
  Set-Content -LiteralPath (Join-Path $EvidenceRoot "output-artifacts.json") -Encoding utf8
