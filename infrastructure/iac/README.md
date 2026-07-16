# Provider-free infrastructure contract

This root module encodes the intended public-edge, application, worker, data, and control-plane
boundaries as validated values. It intentionally has:

- no `provider` blocks;
- no `resource` or `data` blocks;
- no remote state backend;
- no credentials, account IDs, regions, or subscription/project identifiers; and
- an invariant that `deployment_enabled` is `false` and `provider_mode` is `disabled`.

It is therefore safe to initialise and validate without cloud credentials and cannot create spend.
The output is a machine-readable contract for a future, separately approved deployment module.

Validate with OpenTofu or Terraform:

```sh
terraform -chdir=infrastructure/iac fmt -check -recursive
terraform -chdir=infrastructure/iac init -backend=false
terraform -chdir=infrastructure/iac validate
```

When using `init` in automation, set that tool's data directory to a temporary location so no
working-directory state is retained. A future deployable implementation must live outside this
contract module and requires an accepted architecture decision plus explicit checkpoint ownership.
