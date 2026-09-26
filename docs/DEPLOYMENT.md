# Deployment

Production setup, release, and recovery. The hosting choice is in [CHECKLIST](../CHECKLIST.md). Roots, command flow, the lease, and the release-source guard: [infra/README](../infra/README.md). Provider details: [DIGITALOCEAN](DIGITALOCEAN.md), [YANDEX_CLOUD](YANDEX_CLOUD.md).

**Never run raw `terraform apply`, `-target`, or state edits, and never unlock a live lock; use `scripts/infra.mjs` (manual Terraform only in documented recovery steps).**

Define resource sizes and composition in Terraform. Ask the user only for what Terraform cannot do: accounts, billing, CLI setup, domains, certificates, DNS, and permissions.

## Production composition

Both clouds use Managed PostgreSQL 18, a container registry, and private versioned buckets for media and Terraform state. Both run every job in [`job-schedules.json`](../backend/src/job-schedules.json).

- DigitalOcean: App Platform runs the API service, the scheduler worker, and Static Sites with a built-in CDN. Terraform creates the alerts.
- Yandex Cloud: Serverless Containers run the API behind API Gateway and one timed container per job. Public buckets serve the static sites, optionally through Cloud CDN. Alerts are manual.

The start profile (one database node, one DigitalOcean API instance) is cheap, not highly available. Scale up before the load grows.

`RATE_LIMIT_STORE` sets where auth and admin rate limits count. DigitalOcean runs one API process with the default `memory`. Yandex containers scale out (`concurrency` limits requests per instance, not the instance count), so Terraform sets `database`. Self-hosting with several API processes also needs `database`.

## Release order

Apply foundation changes first with `infra:apply`: a release needs a foundation plan with no changes. The release builds and pushes one immutable image, migrates the database, switches the API and jobs, publishes the static sites, and checks the API (`/health/ready`), webapp, and website; the provider guide has the exact steps. A failed migration stops the release, and the old runtime and static sites keep serving. Release roots are safe to rerun.

## Setup and bootstrap

You need Terraform `>= 1.15, < 2`, Bun, Docker, Git, the production branch pushed to its upstream, HTTPS domains for the API, webapp, and website, and a JWT secret of 64+ hex characters (`openssl rand -hex 32`). Prepare the tools, credentials, `terraform.tfvars` files, and secret exports from the provider guide. Then run:

```bash
bun run infra:bootstrap -- <provider> --new --dry-run
bun run infra:bootstrap -- <provider> --new
bun run infra:apply -- <provider> --dry-run
bun run infra:apply -- <provider>
```

The first bootstrap runs with local state, creates the state bucket and its scoped key, and then migrates the state into the bucket. Noncurrent state versions expire after 30 days and incomplete uploads after 7. An older install gets this rule on its next `infra:bootstrap -- <provider>`; without it, a Yandex state bucket can fill its 1 GiB `max_size` and refuse the lock.

Bootstrap writes ignored `0600` files: the backend keys in `infra/<provider>/.env.terraform-state` (keep a copy in a secret manager) and `backend.backend.hcl` in each root. If bootstrap stops before the migration, rerun it without `--new`. The local `terraform.tfstate` stays the source of truth until the script has migrated it and checked the remote outputs.

### Yandex temporary folder role

The first Yandex bootstrap applies the state bucket policy with a temporary folder-level `storage.admin` role and removes the role in the same command. Later the state account has no IAM role, so a change to this policy can fail at apply although the plan shows it. Roll such a change out in one command:

1. Add `bootstrap_folder_storage_access = true` to `infra/yandex/bootstrap/terraform.tfvars`.
2. Run `bun run infra:bootstrap -- yandex`. It grants the role, applies, and removes the role.
3. Delete the line.

If the refusal repeats right after the grant, wait for IAM propagation and retry with the line kept. Every bootstrap plan, `--dry-run` included, accepts the removal of this binding without `--allow-destroy`, so the role never outlives the next run. State recovery refuses to run while the line is present.

### Lost state access

If the env file and the local bootstrap state are both lost, bootstrap without `--new` refuses to run. Never pass `--new` for an existing install; reattach the backend with a temporary key to the state bucket. On Yandex the key must belong to the `<project_slug>-tf-state` service account: the bucket policy rejects other identities, even with a folder role. Save the key's resource ID.

```bash
export TF_STATE_RECOVERY_ACCESS_KEY_ID='<temporary key id>'
export TF_STATE_RECOVERY_SECRET_ACCESS_KEY='<temporary key secret>'
bun run infra:bootstrap -- <provider> \
  --recover-state-bucket=<existing-state-bucket> \
  --recover-state-region=<existing-bucket-region>
unset TF_STATE_RECOVERY_ACCESS_KEY_ID TF_STATE_RECOVERY_SECRET_ACCESS_KEY
```

If the command stops, rerun it with the same key. Recovery has no `--dry-run` and needs normal bootstrap apply rights. After success, revoke the temporary key at once; on Yandex: `yc iam access-key delete <recovery-access-key-resource-id>`.

## Plan and release

For the first release only, pass the first admin through the environment:

```bash
export ADMIN_SEED_EMAIL='owner@example.com'
export ADMIN_SEED_PASSWORD='<random one-time password>'
bun run release -- <provider> --dry-run
bun run release -- <provider>
unset ADMIN_SEED_EMAIL ADMIN_SEED_PASSWORD
```

The release removes the seed after the migration, but the seed stays in deployment history, Lockbox, and state versions. Change the password right after the first sign-in. Never pass the seed again: a new value resets that admin's password and ends their sessions. Every `db:deploy` requires an admin with a password.

Every plan refuses a deletion or replacement without an exact `--allow-destroy=<address>` for that reviewed resource. It refuses protected resources even then (`protectedResourcePatterns` in `scripts/infra.mjs`, plus the live Yandex credential version). Import or move a resource instead of replacing it.

To rotate a protected key or slot, add the new one and apply only that. Release and verify, then remove the old one in a separate reviewed foundation change. A direct replacement would cut access before the API and jobs switch. Never weaken the protection list for one apply.

### After a template update

`infra:plan` plans the foundation, then plans each existing release root from the foundation outputs saved in state. After a template update that changes those outputs, the foundation plan shows only output changes, and the release-root plan stops with `run infra:apply to refresh the foundation outputs`. Nothing has changed yet. Review the foundation plan, then:

1. Run `bun run infra:apply -- <provider>`. It applies only the foundation root.
2. Run `bun run infra:plan -- <provider>` again and review the release roots.
3. Release as usual. `release` refuses while the foundation plan has changes.

The update to per-component secrets works this way. Its release removes `JWT_SECRET` from the scheduler worker and the job containers in place.

## Secrets and state

- State contains secrets. Treat the state bucket and its key as production access, not build artifacts.
- Pass secrets only through `TF_VAR_*`. Never put secret fields in `terraform.tfvars`, even empty ones: tfvars values override the environment.
- The runtime gets secrets through provider secret fields or Lockbox, never through the image.
- Only the API receives `JWT_SECRET`; the scheduler worker, the job containers, and the migration run without it.

### Extra runtime variables

`extra_runtime_env` holds extra non-secret settings. Extra secrets go in `extra_runtime_secret_env` on DigitalOcean and in `extra_secret_bindings` on Yandex Cloud. By default, each extra variable reaches the API and every job; the mobile groups below have narrower defaults. To narrow one, add it to `extra_env_components` in the production `terraform.tfvars`. Map the variable name to `api`, `jobs`, or job keys from `backend/src/job-schedules.json`:

```hcl
extra_env_components = {
  STORE_BUNDLE_ID  = ["api"]
  STORE_API_SECRET = ["api"]
}
```

- Give every variable of one env group the same targets as its secret. The backend refuses a partial group at startup.
- The mobile groups have default targets, the components that read them: the `APPLE_IAP_*` group reaches `api`; the `GOOGLE_PLAY_*` group reaches `api` and `maintenance`, which reconciles purchases; `EXPO_PUSH_ACCESS_TOKEN` reaches only `notifications`, which sends pushes. An entry in `extra_env_components` replaces a default. `runtime-inputs.tf` in each production root lists them.
- Keep a variable that every component validates on all components, for example `EMAIL_RESEND_API_KEY` with `EMAIL_DELIVERY`.
- DigitalOcean runs every job in one scheduler worker, so any job target reaches that worker. Yandex Cloud gives each job its own container.
- Every plan rejects an unknown name or target, an empty target list, and an extra variable that repeats a built-in one. It also rejects a job key named `api` or `jobs`, because those are target names.
- Yandex Cloud grants each extra Lockbox secret to the one runtime service account that every container uses. Scoping controls which containers bind the secret, not who may read it.

To scope a variable on an existing install, add the entry and run `infra:apply`: only the foundation outputs change. Then run `release`, which updates the API and job runners in place. Old revisions and deployment history keep the value, so rotate a secret that must stop being exposed.

## Existing manually created infrastructure

Never apply the first foundation over resources that old CLI instructions created. Import each one by its real ID into its root and address, then plan:

```bash
bun run infra:import -- <provider> <root> <terraform-address> <provider-resource-id>
bun run infra:plan -- <provider>
```

Bootstrap resources can go into local state before backend keys exist; the next bootstrap, without `--new`, migrates them. Release roots need exact immutable inputs: `--runtime-image-digest=sha256:<64-hex>` for `runtime` and Yandex `migration`, and `--release-revision=<40-char-sha> --source-branch=infra-release/<40-char-sha>` for DigitalOcean `static`. Use the provider's current import ID format. Import linked timers and static apps before you accept a clean plan. A matching name does not prove ownership.

Keys (`digitalocean_spaces_key`, `yandex_iam_service_account_static_access_key`) cannot be imported, and their secret exists only at creation. Import the bucket, service account, Lockbox secret, and policy. Let Terraform create a new key. Apply, release, verify state, media, and static sites, and then revoke the old key. Revoke an old state key only after a second successful init and plan with the new one.

An imported database keeps its object owners, and `db:deploy` stops until the migration owner owns the public schema and its objects. List the other owners' objects through a privileged legacy connection, kept in the environment only:

```bash
export DATABASE_URL='<legacy owner or privileged connection URL>'
export DATABASE_LEGACY_OWNER='<owner reported by the inventory>'
export DATABASE_MIGRATION_USER='<new migration owner from Terraform>'
bun run --cwd backend db:adopt-owner
```

The list skips extension objects and refuses mixed legacy owners. Review it, then transfer ownership once:

```bash
export CONFIRM_DATABASE_OWNER_ADOPTION="${DATABASE_LEGACY_OWNER}->${DATABASE_MIGRATION_USER}"
bun run --cwd backend db:adopt-owner -- --apply
unset DATABASE_URL DATABASE_LEGACY_OWNER DATABASE_MIGRATION_USER CONFIRM_DATABASE_OWNER_ADOPTION
```

After each migration, `db:deploy` also revokes `PUBLIC` rights on the public schema, its objects, temporary tables, and default privileges.

## Rollback and recovery

- Roll back with a new commit, usually a revert, and a normal release. Never point a service at a mutable tag.
- To roll back across the per-component secrets update, revert it and release. Never deploy an older image instead: it requires `JWT_SECRET` in the scheduler worker and the job containers, which no longer receive it.
- Migrations only go forward. Use expand/contract changes so the previous version still works.
- With external DNS, the first release can fail at the URL checks. Create the records from the provider guide, wait for propagation, and rerun the release instead of recreating resources.
- After a failed apply, fix the owning configuration and plan again.
- If the runtime state is lost while the app still runs, plan and apply stop. Recover or import that state; never treat it as a first release.
- A crashed run can leave the lease locked; see [infra/README](../infra/README.md).

## Self-hosting

Self-hosting uses the same Docker image and scheduler, without the release script:

- Build `backend/Dockerfile` and run PostgreSQL 18+.
- Before switching, run `bun run --cwd backend db:deploy` with the schema owner's `DATABASE_URL`. The first run also needs `ADMIN_SEED_EMAIL` and `ADMIN_SEED_PASSWORD`.
- Serve `webapp/dist` and `website/dist` with Caddy or nginx. Route unknown webapp paths to `index.html`.
- Run `bun run --cwd backend start:scheduler` under a supervisor.
- Connect a private S3-compatible media bucket.

After both static builds, run `bun run static:precompress`. Caddy serves the files with `precompressed`. nginx needs `gzip_static` for `.gz` and `brotli_static` from `ngx_brotli` for `.br`. Cloud releases never read these files; keep precompression out of cloud commands.

Use Ansible only here, for packages, users, firewall, systemd, and the proxy. Keep database data, secrets, and releases out of playbooks. The owner handles TLS, backups, restore tests, updates, monitoring, and rollback.

## Local checks

After an infrastructure change, run `bun run test:infra` and `bun run test:terraform`. The latter needs the Terraform CLI and network access for providers, but no backend keys, and never reaches the cloud. Mocks prove only the configuration shape: before a release, run `infra:plan` with real keys to check account limits, regions, domains, and the current cloud state.
