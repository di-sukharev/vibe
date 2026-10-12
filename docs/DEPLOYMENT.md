# Deployment

Use [scripts/infra.mjs](../scripts/infra.mjs) for production changes. Terraform files define resources and defaults. Provider setup is in [DigitalOcean](DIGITALOCEAN.md) and [Yandex Cloud](YANDEX_CLOUD.md).

Never run raw `terraform apply`, use `-target`, edit state, or unlock a live process. The recovery steps below describe the permitted exceptions.

## Configuration and commands

Only `bootstrap/` and `production/` take `terraform.tfvars`. The script supplies temporary inputs to the other roots. Keep secrets in `TF_VAR_*`, not tfvars: a tfvars value overrides the environment.

`bootstrap/` creates remote state access. `production/`, called foundation by the CLI, creates persistent resources. Runtime, migration, and static roots publish releases. `operations/` holds the mutation lease.

```bash
bun run infra:bootstrap -- <provider> --new --dry-run
bun run infra:bootstrap -- <provider> --new
bun run infra:plan -- <provider>
bun run infra:apply -- <provider>
bun run release -- <provider> --dry-run
bun run release -- <provider>
bun run infra:output -- <provider>
```

Use `digitalocean` or `yandex` for `<provider>`. Pass `--new` only for the first bootstrap. Apply foundation changes before releasing. A release requires a foundation plan with no changes.

Each apply uses a saved, reviewed plan. Deletion or replacement needs an exact `--allow-destroy=<address>`. Protected resources remain blocked. Rotate protected credentials by adding a replacement, releasing, verifying, and removing the old credential in a later change.

## Release requirements

Use the pushed branch selected in Terraform. The worktree must be clean and HEAD must equal its upstream commit. DigitalOcean also checks the GitHub repository. Keep the checkout unchanged throughout the release.

The script builds from an archive of that commit. DigitalOcean static builds use an immutable `infra-release/<commit>` branch. Do not edit those branches or enable deploy-on-push.

A release builds the image, applies migrations, switches the API and jobs, publishes static sites, and checks public URLs. Migration failure stops the switch. Static publication can fail after the backend switches; rerun the same release after correcting the cause.

Migrations go forward. Keep the previous runtime compatible with the migrated schema. Roll back through a reviewed revert and a new release.

## Initial setup

Use the tool versions required by the configuration and provider guide. Prepare Docker, Git, Bun, Terraform, provider access, HTTPS domains, and a strong JWT secret.

Bootstrap starts with local state, creates a private state bucket, and migrates state into it. It writes ignored files with mode `0600`: `.env.terraform-state` and each root's `backend.backend.hcl`. Keep the state credentials in a secret manager.

If bootstrap stops before migration, rerun without `--new`. Local state remains authoritative until remote migration and output verification succeed.

For the first release, supply the first administrator:

```bash
export ADMIN_SEED_EMAIL='owner@example.com'
export ADMIN_SEED_PASSWORD='<random one-time password>'
bun run release -- <provider>
unset ADMIN_SEED_EMAIL ADMIN_SEED_PASSWORD
```

Change that password after first sign-in. The seed can remain in deployment history, secret versions, and state. Do not resend it: a new seed can reset the administrator and revoke sessions.

Only the API receives `JWT_SECRET`. Jobs and migrations must not receive the signing key.

## Extra runtime variables

Use `extra_runtime_env` for non-secret settings. Use `extra_runtime_secret_env` on DigitalOcean or `extra_secret_bindings` on Yandex for secrets.

By default, extra variables reach the API and every job. Narrow them with `extra_env_components`:

```hcl
extra_env_components = {
  STORE_BUNDLE_ID  = ["api"]
  STORE_API_SECRET = ["api"]
}
```

Targets are `api`, `jobs`, or keys from `backend/src/job-schedules.json`. Keep related variables and secrets on the same targets. Keep variables required by every process on all processes.

DigitalOcean runs all jobs in one worker. Yandex gives each job a container, but all containers share one runtime identity. Binding scope does not restrict that identity's secret-read permission.

For an existing deployment, apply the foundation output change, then release. Old revisions keep previous secret values. Rotate secrets when removing historical exposure matters.

## Existing infrastructure

Import existing resources before applying configuration over them:

```bash
bun run infra:import -- <provider> <root> <address> <resource-id>
bun run infra:plan -- <provider>
```

Use exact provider IDs. Matching names do not prove ownership. Import bootstrap resources into local state when necessary, then bootstrap without `--new`.

Release-root imports need immutable inputs. Use `--runtime-image-digest=sha256:<64-hex>` for runtime and Yandex migration. DigitalOcean static imports also need `--release-revision=<40-char-sha>` and `--source-branch=infra-release/<40-char-sha>`.

Access keys cannot be imported. Import the surrounding resources, create new scoped keys, apply, release, and verify. Revoke old keys afterward. For state keys, require another successful init and plan before revocation.

### Database ownership

An imported database can retain a legacy owner. `db:deploy` stops until the migration owner owns the schema and objects. Inventory them through a privileged legacy connection:

```bash
export DATABASE_URL='<legacy privileged connection>'
export DATABASE_LEGACY_OWNER='<inventory owner>'
export DATABASE_MIGRATION_USER='<Terraform migration owner>'
bun run --cwd backend db:adopt-owner
```

Review the inventory and obtain approval before transfer:

```bash
export CONFIRM_DATABASE_OWNER_ADOPTION="${DATABASE_LEGACY_OWNER}->${DATABASE_MIGRATION_USER}"
bun run --cwd backend db:adopt-owner -- --apply
unset DATABASE_URL DATABASE_LEGACY_OWNER DATABASE_MIGRATION_USER CONFIRM_DATABASE_OWNER_ADOPTION
```

The command excludes extension objects and refuses mixed legacy owners. Deployment then restricts runtime and PUBLIC privileges.

## Recovery

A lost runtime state must be recovered or imported. Never treat an existing deployment as a first release. After an interrupted apply, correct the configuration and plan again.

If foundation outputs changed, run `infra:apply`, review `infra:plan` again, then release. This refreshes the outputs used by release roots.

External DNS can make the first URL check fail. Add the required records, wait for propagation, and rerun. Do not recreate infrastructure for a DNS failure.

### Lost state credentials

If both local bootstrap state and credentials are lost, use a temporary key for the existing state bucket. On Yandex, it must belong to the `<project_slug>-tf-state` service account.

```bash
export TF_STATE_RECOVERY_ACCESS_KEY_ID='<temporary key id>'
export TF_STATE_RECOVERY_SECRET_ACCESS_KEY='<temporary secret>'
bun run infra:bootstrap -- <provider> \
  --recover-state-bucket=<existing bucket> \
  --recover-state-region=<existing region>
unset TF_STATE_RECOVERY_ACCESS_KEY_ID TF_STATE_RECOVERY_SECRET_ACCESS_KEY
```

Retry with the same key after interruption. Recovery has no dry-run. Revoke the temporary key immediately after success.

### Yandex state policy updates

A state policy update needs temporary folder-level storage access. Add `bootstrap_folder_storage_access = true` to the bootstrap tfvars and run `infra:bootstrap -- yandex`. The command grants, uses, and removes the role. Delete the setting afterward.

If IAM propagation delays the apply, retry with the setting retained. Do not start state recovery while it is present.

### Stale locks

Real foundation applies, releases, and non-bootstrap imports hold a provider-wide lease. Never unlock it while the owning process runs.

After confirming that the run has stopped, enter the locked root. Set `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from its saved `TF_STATE_*` credentials without printing them. Initialize and unlock:

```bash
terraform init -reconfigure -backend-config=backend.backend.hcl
terraform force-unlock <LOCK_ID>
```

For the mutation lease, use `infra/<provider>/operations`. Other root locks need the same procedure in their own directories. Verify `Who`, `Created`, and `Operation` against the stopped run before unlocking.

## Private servers

Run the backend Docker image with PostgreSQL and private S3 storage. Apply `db:deploy` before switching the runtime. Run `start:scheduler` under a supervisor.

Serve static builds with Caddy or nginx. Webapp fallback routes must return `index.html`. `bun run static:precompress` creates compressed assets for hosts configured to serve them.

The operator owns TLS, backups, restore tests, updates, monitoring, and rollback. Cloud release commands do not manage this setup.

## Local verification

After infrastructure changes, run `bun run test:infra` and `bun run test:terraform`. Mocked tests verify configuration shape. Before release, a real `infra:plan` verifies credentials and current cloud state.
