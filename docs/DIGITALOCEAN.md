# DigitalOcean Terraform Runbook

Use this path when [CHECKLIST.md](../CHECKLIST.md) records an audience outside Russia and no Russian
data-residency requirement. Common safety and release rules live in [DEPLOYMENT.md](DEPLOYMENT.md);
the Terraform source lives under [`infra/digitalocean`](../infra/digitalocean).

## What Terraform creates

- one Project and one regional VPC;
- one account-wide Container Registry (protected from destroy);
- one PostgreSQL 18 cluster, application database, separate runtime user, and a
  Terraform-managed trusted-source firewall;
- one private Spaces bucket for user media plus a bucket-scoped runtime key;
- one App Platform API app containing the API service, long-running scheduler worker, and
  `PRE_DEPLOY` migration job;
- separate App Platform Static Site apps for `webapp` and `website`;
- a private versioned Space and scoped key for Terraform state.

The scheduler runs `outbox:drain` and `notifications:process` every minute, abandoned-upload
cleanup hourly at minute 15, and combined auth/notification maintenance every 15 minutes. The
migration job uses the same immutable backend digest and must succeed before App Platform promotes
the API.

## Account preparation

Install and authenticate `doctl` 1.164 or newer, authorize App Platform to read the configured
GitHub repository, and create one account-level Spaces access key for Terraform to manage buckets.
The bootstrap then creates a narrower key used only by the Terraform state backend.

Set the account guard and credentials without printing them:

```bash
export DO_EXPECTED_TEAM_UUID='<immutable Team UUID from doctl account get --output json>'
export DIGITALOCEAN_TOKEN='<API token>'
export SPACES_ACCESS_KEY_ID='<account Spaces key id>'
export SPACES_SECRET_ACCESS_KEY='<account Spaces secret>'
```

The API token needs `spaces_key:read` in addition to the scopes required by Terraform. The wrapper
passes `DIGITALOCEAN_TOKEN` to both Terraform and `doctl`, forces `doctl` to its default context,
verifies the immutable `DO_EXPECTED_TEAM_UUID`, and checks that this token can read the exact
`SPACES_ACCESS_KEY_ID`. A duplicate/renamed team, saved CLI context, or Spaces key from another
team therefore cannot redirect Terraform silently.

The account Spaces key remains necessary for bucket administration; it is not reused by the app.
Terraform creates a separate key restricted to the media Space and injects that key into the API
and scheduler as secret App Platform environment variables.

## Configuration

```bash
cp infra/digitalocean/bootstrap/terraform.tfvars.example \
  infra/digitalocean/bootstrap/terraform.tfvars
cp infra/digitalocean/production/terraform.tfvars.example \
  infra/digitalocean/production/terraform.tfvars
export TF_VAR_jwt_secret="$(openssl rand -hex 32)"
```

Use compatible region slugs (`fra` for App Platform and `fra1` for VPC/database/Spaces in the
example), a globally unique state Space, a globally unique media Space, the GitHub repository in
`owner/repository` form, and the exact pushed release branch. `registry_name` is account-wide: if
the account already has a registry, set its real name and import it before the first apply.
The generated S3 backend keeps `fra1` in the Spaces endpoint but uses the S3-compatible signing
region `us-east-1`; do not replace it with the Spaces region.

Three production domains are required. Set `dns_zone` to a DigitalOcean-managed zone to let App
Platform manage records, or leave it `null` and configure the App Platform domain records at the
external DNS provider.

Optional Resend delivery uses sensitive Terraform input, never committed HCL:

```bash
export TF_VAR_extra_runtime_secret_env='{"EMAIL_RESEND_API_KEY":"<secret>"}'
```

Then set `email_delivery = "resend"` and `email_from` in the production tfvars.

## Commands

```bash
bun run infra:bootstrap -- digitalocean --new --dry-run
bun run infra:bootstrap -- digitalocean --new
bun run infra:apply -- digitalocean --dry-run
bun run infra:apply -- digitalocean
bun run infra:plan -- digitalocean
bun run infra:output -- digitalocean
bun run release -- digitalocean --dry-run
bun run release -- digitalocean
```

`infra:apply` creates or changes only the stateful foundation; routine releases refuse to continue
while that root has drift. The release then logs Docker into DOCR, builds `backend/Dockerfile` from
a `git archive` of the captured pushed commit, pushes it, resolves the `sha256` digest, and applies
the API-only runtime root. Terraform waits for App Platform's `PRE_DEPLOY` migration and API
deployment before the separate static root is allowed to change.

The App Platform spec binds the managed cluster twice without copying either password: API and
scheduler use the restricted application user, while only the `PRE_DEPLOY` job uses the cluster's
administrative connection for Prisma DDL. After every migration, `db:deploy` grants the runtime user
database/schema access, DML on current tables, sequence use, and matching owner default privileges
for future tables and sequences. Before granting, it removes unsafe schema/object/routine/default
privileges inherited through PostgreSQL `PUBLIC` plus direct database/schema/table/sequence and
default-ACL drift; it fails closed if the runtime role has inherited/elevated roles or owns objects.
DigitalOcean creates database users with minimal privileges, so this deterministic reconciliation
is part of the migration gate rather than an undocumented console task.

For an imported cluster, `db:deploy` also inventories public-schema ownership before Prisma. If a
legacy role owns objects, use the reviewed `db:adopt-owner` inventory/apply sequence in
[DEPLOYMENT.md](DEPLOYMENT.md); changing the Terraform database/user resources alone cannot transfer
PostgreSQL object ownership.

The App Platform image source intentionally sets `registry_type = "DOCR"`, repository, and digest,
but leaves `registry` unset: DigitalOcean's DOCR contract rejects a registry name in that field.

App Platform source configuration has a branch but no commit-SHA field. The wrapper therefore
creates a never-overwritten `infra-release/<40-character-sha>` branch for each release, points both
static apps at it with `deploy_on_push = false`, and checks each active deployment's
`source_commit_hash`. A newer push to `master` cannot change the in-flight release.

If `ADMIN_SEED_*` is supplied, the first deployment runs the migration with it. After success the
script removes the bootstrap variables and applies once more; the second migration is deliberately
idempotent and verifies the created administrator.

## Operations

- The starting PostgreSQL size and single node prioritize launch cost. Backups are managed by the
  service, but restore testing and an HA upgrade remain operator work.
- PostgreSQL initially trusts only the dedicated VPC CIDR while no app ID exists. After the
  migration-gated API deployment succeeds, the wrapper feeds its App ID back into the independent
  foundation root and replaces the bootstrap rule with that exact trusted source. Adding an
  external admin client requires a deliberate Terraform firewall rule, not a console-wide allow.
- App Platform Static Sites use DigitalOcean's edge delivery; no separate Spaces CDN or Terraform
  CDN resource is created.
- Private media is never served through a public CDN. The backend issues short-lived signed URLs.
- Do not enable `deploy_on_push`: the guarded release command is the one promotion authority.
- Keep wrapper-owned `infra-release/*` branches immutable. Old branches are release evidence and
  may be removed only after the corresponding deployment is no longer a rollback target.
- App Platform's GitHub connection is an account authorization and cannot be made portable in this
  repository; verify it before the first release.

## Official references

- [DigitalOcean Terraform provider](https://docs.digitalocean.com/reference/terraform/)
- [App Platform](https://docs.digitalocean.com/products/app-platform/)
- [Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/)
- [Container Registry](https://docs.digitalocean.com/products/container-registry/)
- [Spaces](https://docs.digitalocean.com/products/spaces/)
