# C0-L4 integration requests

C0-L4 is not authorised to edit the root `package.json`. After this lane is merged, the
orchestrator may add the following exact convenience scripts if it wants the local lifecycle and
bootstrap suite discoverable through pnpm:

```json
{
  "scripts": {
    "services:up": "docker compose -f infrastructure/local/compose.yaml up -d --wait",
    "services:down": "docker compose -f infrastructure/local/compose.yaml down",
    "services:health": "infrastructure/local/healthcheck.sh",
    "verify:bootstrap": "python3 -m unittest discover -s tests/bootstrap -p 'test_*.py' -v",
    "smoke:surfaces": "python3 tests/bootstrap/smoke_surfaces.py"
  }
}
```

This is a root-manifest integration request, not an applied change. Keep `verify:bootstrap`
separate from the default root `verify` until the integration environment guarantees Docker
Compose for syntax rendering and OpenTofu/Terraform if non-skipped IaC validation is desired. The
live `services:health` check additionally requires a running Docker daemon and healthy stack.

The orchestrator should also reconcile the generated iOS project and application scheme from
C0-L3 with the discovery-based commands in `clean-bootstrap.md`. No root dependency, lockfile,
environment manifest, Codex configuration, or orchestration-ledger change is requested by this
lane.
