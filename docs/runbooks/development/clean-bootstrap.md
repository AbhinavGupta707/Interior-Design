# Clean bootstrap

This runbook takes a clean Git checkout to a verified C0 development environment: local open
dependencies, the web and API shells, Python checks, and the iOS Simulator shell. It requires no
cloud account, provider API key, paid service, GPU, or LiDAR device.

The local fixture credentials below are not secrets and must never be reused outside this
loopback-only development stack. Do not put real credentials in an environment file or commit
customer media, captures, datasets, model weights, renders, or provider payloads.

## 1. Prerequisites

The repository pins Node.js and Python in `.nvmrc` and `.python-version`; `package.json` pins pnpm.
Install the following before bootstrap:

| Tool                                         | Required contract                                |
| -------------------------------------------- | ------------------------------------------------ |
| Git                                          | A version with worktree support                  |
| Node.js                                      | Exact version in `.nvmrc`                        |
| pnpm                                         | Exact `packageManager` version in `package.json` |
| uv                                           | Resolves the Python version in `.python-version` |
| Docker Engine/Desktop or a compatible engine | Running daemon with Docker Compose v2+           |
| macOS full Xcode                             | Required only for the iOS lane                   |
| XcodeGen                                     | Required only to regenerate the iOS project      |
| iOS Simulator runtime                        | Required only for simulator build/test/run       |

From the checkout root, audit the core prerequisites:

```sh
python3 tests/bootstrap/check_prerequisites.py
```

On a Mac that will build the native app, include the iOS checks:

```sh
python3 tests/bootstrap/check_prerequisites.py --include-ios
```

The audit fails on version drift, an unavailable Docker daemon, a checkout-root mismatch, or a
missing requested Simulator runtime. It does not install or mutate anything.

## 2. Install locked dependencies

Run from the checkout root:

```sh
pnpm install --frozen-lockfile
uv sync --frozen
```

If uv cannot write its user cache, keep its cache inside the ignored repository cache directory:

```sh
UV_CACHE_DIR=.cache/uv uv sync --frozen
```

Do not regenerate `pnpm-lock.yaml` or `uv.lock` during bootstrap. A frozen-install failure is a
dependency-contract failure to resolve through the orchestrator, not a reason to update a lockfile
silently.

## 3. Start local services

Validate the Compose model, pull the pinned images, start the stack, and wait for health checks:

```sh
docker compose -f infrastructure/local/compose.yaml config --quiet
docker compose -f infrastructure/local/compose.yaml pull
docker compose -f infrastructure/local/compose.yaml up -d --wait
infrastructure/local/healthcheck.sh
```

The first pull requires network access. Subsequent starts use the local image cache. `--wait` fails
if any declared container health check does not become healthy.

### Local service contract

| Capability             | Endpoint                | Local fixture contract                                                         |
| ---------------------- | ----------------------- | ------------------------------------------------------------------------------ |
| PostgreSQL/PostGIS     | `127.0.0.1:54321`       | database `interior_design`; user `localdev`; password `local-development-only` |
| S3-compatible storage  | `http://127.0.0.1:8333` | access key `localdev`; secret `local-development-only`; path-style requests    |
| SeaweedFS health/admin | `http://127.0.0.1:9333` | loopback only                                                                  |
| Temporal gRPC          | `127.0.0.1:7233`        | development namespace/server                                                   |
| Temporal UI            | `http://127.0.0.1:8233` | local development inspection only                                              |

The object-store bootstrap creates separate `source`, `derived`, `issued`, and `quarantine`
buckets. They encode lifecycle boundaries; they do not by themselves implement production
retention, immutability, Object Lock, encryption, authorisation, or backup policy.

The health wrapper verifies more than open ports: it checks PostgreSQL 18+, queries the PostGIS
extension, signs an S3 `ListBuckets` request and verifies all four buckets, and invokes Temporal's
cluster-health API.

The Compose project uses a dedicated bridge whose default host binding and every declared port are
loopback-only. This is not an egress sandbox: the services remain development fixtures, not secure
shared-host or production deployments.

## 4. Run the API and web shells

Start each long-running surface in a separate terminal from the checkout root.

Terminal one:

```sh
pnpm --filter @interior-design/platform-api dev
```

Terminal two:

```sh
pnpm --filter @interior-design/web dev
```

The API listens at `http://127.0.0.1:4100`; the web shell listens at
`http://127.0.0.1:3000`. Confirm the cross-surface bootstrap contract while both are running:

```sh
python3 tests/bootstrap/smoke_surfaces.py
```

The smoke requires exact `{"status":"ok"}` JSON from `GET /health` and the expected C0 product
identity in the rendered HTML. It does not mistake an arbitrary HTTP response for a healthy app.

The existing root convenience command `pnpm dev` may be used instead; the filtered commands are
shown because their logs and restart behavior are easier to diagnose independently.

## 5. Run Python checks

Python has no long-running C0 service yet. Validate its locked environment and baseline package:

```sh
uv run ruff check .
uv run mypy .
uv run pytest
```

These commands exercise the root Python contract. The dependency-stack smoke scripts intentionally
use only the Python standard library so they remain usable before `uv sync` when diagnosing a
bootstrap failure.

## 6. Build and run the iOS Simulator shell

The Simulator proves navigation, configuration, unsupported-capture, loading, interruption, and
error states only. It cannot prove camera, ARKit, RoomPlan, LiDAR, tracking, thermal, or field
capture behavior.

Regenerate the project and discover its committed scheme instead of assuming a developer-specific
path:

```sh
xcodegen generate --spec apps/ios-capture/project.yml
ios_project=$(find apps/ios-capture -maxdepth 1 -name '*.xcodeproj' -print -quit)
ios_scheme=$(xcodebuild -project "$ios_project" -list -json | python3 -c 'import json,sys; print(json.load(sys.stdin)["project"]["schemes"][0])')
ios_device_id=$(xcrun simctl list devices available -j | python3 -c 'import json,sys; data=json.load(sys.stdin)["devices"]; print(next(device["udid"] for runtime,devices in data.items() if ".iOS-" in runtime for device in devices if device.get("isAvailable")))')
xcodebuild -project "$ios_project" -scheme "$ios_scheme" -destination "platform=iOS Simulator,id=$ios_device_id" build test
```

If the generated project has more than one application scheme, inspect the discovery result with
`xcodebuild -project "$ios_project" -list` and select the application scheme explicitly.

To verify the visible shell, open the generated project in Xcode, select the same available iOS
Simulator, and Run. Confirm that the app launches, identifies local/development configuration,
shows the unsupported-capture path honestly, and does not claim that Simulator data is a RoomPlan
capture.

Physical-device evidence is intentionally deferred to C7 and C18. A Simulator pass must never be
reported as physical RoomPlan completion.

## 7. Full verification sequence

With dependencies installed and the local containers healthy:

```sh
python3 -m unittest discover -s tests/bootstrap -p 'test_*.py' -v
infrastructure/local/healthcheck.sh
pnpm verify
```

With the API and web development servers also running:

```sh
python3 tests/bootstrap/smoke_surfaces.py
```

The static bootstrap suite validates Compose syntax, pinned image tags, health checks, loopback
binding, named-volume use, the dedicated bridge, local-only fixture credentials, distinct storage
classes, provider-free IaC, Terraform/OpenTofu syntax when installed, shell syntax, frozen root
versions, and the absence of developer absolute paths or common secret material.

Validate the provider-free infrastructure contract separately when changing HCL:

```sh
terraform -chdir=infrastructure/iac fmt -check -recursive
TF_DATA_DIR=.cache/terraform-c0 terraform -chdir=infrastructure/iac init -backend=false
TF_DATA_DIR=.cache/terraform-c0 terraform -chdir=infrastructure/iac validate
```

The module has no provider, resources, data sources, remote backend, account, region, credentials,
or deployment switch. Successful validation creates no infrastructure and no cloud spend.

## 8. Stop or reset local services

Normal shutdown preserves named-volume data:

```sh
docker compose -f infrastructure/local/compose.yaml down
```

The following reset is destructive. It deletes only this Compose project's local PostgreSQL,
object-storage, and Temporal development volumes; it does not delete repository files:

```sh
docker compose -f infrastructure/local/compose.yaml down --volumes
```

Use the volume reset only when disposable local state is known to be safe to lose, such as after an
incompatible pinned-image change. Never use it as a general troubleshooting first step.

## 9. Troubleshooting

### Docker is installed but unavailable

Start Docker Desktop or the selected compatible engine, then check:

```sh
docker context show
docker info
docker compose version
```

Do not work around a user-level daemon problem by running the development stack with broad root
permissions.

### A fixed port is already in use

Identify the owner before stopping anything:

```sh
lsof -nP -iTCP:3000 -iTCP:4100 -iTCP:7233 -iTCP:8233 -iTCP:8333 -iTCP:9333 -iTCP:54321
```

The C0 ports are contract values. Stop or reconfigure the unrelated process rather than making an
uncoordinated port change in this lane.

### A container is unhealthy

Inspect status and bounded logs:

```sh
docker compose -f infrastructure/local/compose.yaml ps
docker compose -f infrastructure/local/compose.yaml logs --tail=200 postgres
docker compose -f infrastructure/local/compose.yaml logs --tail=200 object-storage
docker compose -f infrastructure/local/compose.yaml logs --tail=200 temporal
```

PostGIS initialization is the slowest first start. Wait for the declared start period before
diagnosing it as failed. If a service version changes later, read its migration notes before
considering the destructive volume reset.

### The S3 smoke reports missing buckets or authentication failure

Make sure any `LOCAL_OBJECT_STORE_ACCESS_KEY` or `LOCAL_OBJECT_STORE_SECRET_KEY` overrides are
exported in the shell running both Compose and the smoke script. On a normal bootstrap, unset those
variables and use the conspicuously local defaults. Never substitute provider credentials.

### Python or uv resolves the wrong runtime

Run the prerequisite audit and inspect uv's resolution:

```sh
uv python find 3.12
uv run python --version
```

Do not loosen `pyproject.toml` or `.python-version` to match an incidental system Python.

### CoreSimulator is unavailable

Open Xcode once, accept any licence/setup prompt, install an iOS Simulator runtime from Xcode
Settings, and retry `xcrun simctl list runtimes available`. If the service is stale, quit Xcode and
Simulator, run `xcrun simctl shutdown all`, and reopen Xcode. Do not delete simulator devices or
derived data until their scope and recoverability are understood.

### No API key, GPU, or LiDAR hardware is available

That is the expected C0 baseline. Use deterministic fixtures and the manual/unsupported capture
path. Do not label mock output as live provider output, AI media as dimensional truth, or Simulator
behavior as a physical-device capture result.

## 10. Codex worktree note

Implementation lanes are created as project-scoped Codex worktree tasks from the integrated
checkpoint commit. Do not substitute raw `git worktree add`, projectless tasks, or shared-path
edits. The orchestrator records worktree-creation evidence and checkpoint state in the orchestration
ledger; this development runbook does not mutate that ledger.
