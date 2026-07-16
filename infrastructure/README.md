# Infrastructure

Checkpoint C0 deliberately provides two infrastructure surfaces with different jobs:

- `local/` is an executable, loopback-only dependency stack for development and contract smoke
  checks.
- `iac/` is a provider-free architecture contract. It records trust boundaries and data classes,
  but contains no deployable resources, backend, cloud provider, credentials, or billable defaults.

The local stack is not a production topology. All credentials in it are conspicuously local fixture
values, all host ports bind to `127.0.0.1`, and every service is replaceable through an application
adapter:

| Capability                 | C0 implementation           | Contract boundary                           |
| -------------------------- | --------------------------- | ------------------------------------------- |
| Transactional/spatial data | PostgreSQL 18 + PostGIS 3.6 | PostgreSQL wire protocol and SQL migrations |
| Object storage             | SeaweedFS S3 gateway        | Path-style S3 API                           |
| Durable workflow spike     | Temporal development server | Temporal gRPC API                           |

Later deployment work must make an explicit provider, region, retention, recovery, security, and
spend decision. Nothing under `iac/` authorises or performs that work.

Start and verify the local stack from the repository root:

```sh
docker compose -f infrastructure/local/compose.yaml up -d --wait
infrastructure/local/healthcheck.sh
```

See `docs/runbooks/development/clean-bootstrap.md` for the complete development flow and safe
shutdown/reset commands.
