# DigitalOcean Terraform Runbook

Use this path when [CHECKLIST.md](../CHECKLIST.md) records an audience outside Russia and no Russian
data-residency requirement. Common safety and release rules live in [DEPLOYMENT.md](DEPLOYMENT.md);
the Terraform source lives under [`infra/digitalocean`](../infra/digitalocean).

## What Terraform creates

- one Project and one regional VPC;
- one account-wide Container Registry (protected from destroy);
- one PostgreSQL 18 cluster, application database, separate runtime user, and a
  Terraform-managed trusted-source firewall;
- one private versioned Spaces bucket for user media plus a bucket-scoped runtime key; its
  lifecycle rule expires noncurrent versions after 30 days and aborts incomplete multipart uploads
  after 7;
- one App Platform API app containing the API service, long-running scheduler worker, and
  `PRE_DEPLOY` migration job;
- separate App Platform Static Site apps for `webapp` and `website`;
- alert rules on the API app: failed deployment and failed domain at app level, and restart,
  memory, and CPU rules on the scheduler worker, delivered to the team's default email;
- a private versioned Space and scoped key for Terraform state; its lifecycle rule expires
  noncurrent versions after 30 days and aborts incomplete multipart uploads after 7.

The scheduler runs `outbox:drain` every minute, abandoned-upload cleanup hourly at minute 15, and
session/reset-token cleanup daily at 03:00 UTC. The migration job uses the same immutable backend
digest and must succeed before App Platform promotes the API.

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

Alerts need no configuration: App Platform sends them to the team's default email. Routing them
to specific team members is a console step (the API app, Settings tab, Alert Policies, Edit, then
expand the rule and set its notification method), deliberately not a Terraform input. Provider
2.99.1 never reads alert destinations back into state, so a list in Terraform would plan an
update on every run, and removing it would not restore the default because the provider only ever
replaces destinations with a declared list and never clears them. On the provider side an apply
leaves console-set destinations alone: the app spec carries none, and the provider syncs them only
when Terraform declares some. Whether App Platform itself keeps them when the spec is re-applied
is not verified; check once after the first release that follows a console change.

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

## Alerts

Terraform creates these on the API app (`infra/digitalocean/runtime/main.tf`); nothing is clicked
in the console. Each one is an e-mail to the team's default address; "Configuration" above says how
to route them to specific people.

| Alert                                          | Fires when                                          | What it means                                                                                                         |
| ---------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `DEPLOYMENT_FAILED` (app)                      | a deployment fails                                  | the migration gate or a component failed; the previous deployment stays live                                          |
| `DOMAIN_FAILED` (app)                          | `api_domain` fails to configure                     | a DNS or certificate problem on the API domain                                                                        |
| `RESTART_COUNT` > 1 in 5 min (scheduler)       | the worker restarted more than once in five minutes | a crash loop: the outbox drain and cleanups are not running. One restart after a deploy stays quiet                   |
| `MEM_UTILIZATION` > 85% for 10 min (scheduler) | memory stays above 85% of `worker_instance_size`    | the worker is about to be killed for running out of memory                                                            |
| `CPU_UTILIZATION` > 90% for 30 min (scheduler) | CPU stays above 90% for half an hour                | a healthy scheduler idles between ticks; this is a stuck job. A pass is bounded whatever the backlog, so backlog never shows here |

What these do not cover: the numbers in the `Job outbox:drain completed.` entry - `backlog`,
`terminalFailed`, `claimed`/`skipped`, `unhandled`. App Platform cannot alert on a value inside a
log entry without forwarding logs to an external service, which this repository does not run. Read
them from the worker's runtime log; the app is `<project_slug>-prod-api`. The metrics object is
printed over a dozen lines after the message, so ask for the lines that follow each match:

```bash
doctl apps list --format ID,Spec.Name
doctl apps logs <app id> scheduler --type run --tail 500 | grep -A 11 'outbox:drain completed'
```

`docs/BACKGROUND_JOBS.md`, "What to watch", says what each number means and when to act. A pass
that fails without crashing the worker appears there as `Scheduler job outbox:drain failed.`, not
as an alert.

## Operations

- The starting PostgreSQL size and single node prioritize launch cost. Backups are managed by the
  service, but restore testing and an HA upgrade remain operator work.
- PostgreSQL initially trusts only the dedicated VPC CIDR while no app ID exists. After the
  migration-gated API deployment succeeds, the wrapper feeds its App ID back into the independent
  foundation root and replaces the bootstrap rule with that exact trusted source. If the runtime
  state stops reporting that App ID while the API app still exists, `infra:plan` and
  `infra:apply` fail closed instead of widening the rule back to the VPC range; recover or import
  the runtime state first. Adding an external admin client requires a deliberate Terraform
  firewall rule, not a console-wide allow.
- App Platform Static Sites use DigitalOcean's edge delivery; no separate Spaces CDN or Terraform
  CDN resource is created.
- DigitalOcean documents Spaces lifecycle rules only for object expiration and incomplete multipart
  uploads. The noncurrent-version rule on the state Space and on the media Space is the standard
  S3 lifecycle element the provider sends, but nothing in this repository can prove Spaces honors
  it. After the apply that installs each (`infra:bootstrap -- digitalocean --new` for the state
  Space, `infra:apply -- digitalocean` for the media Space, or the rerun of either on an existing
  install), read it back once with any S3 client and the account Spaces key exported as
  `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, for example
  `aws s3api get-bucket-lifecycle-configuration --endpoint-url https://<spaces_region>.digitaloceanspaces.com --bucket <Space>`,
  and expect `NoncurrentVersionExpiration` of 30 days. If the read-back omits that element, Spaces
  accepted the rule without keeping it and every later rerun will plan the same in-place update:
  treat it exactly like a refusal. If Spaces refuses the rule instead, the apply fails at the
  lifecycle step. In both cases drop `noncurrent_version_expiration` from both rules and both
  assertions (`infra/digitalocean/bootstrap/tests/bootstrap.tftest.hcl` and
  `infra/digitalocean/production/tests/production.tftest.hcl`) the first time Spaces refuses it:
  the state Space fails first, and the media Space would fail the same way at `infra:apply`. Record
  the gap in `CHECKLIST.md` and rerun (`infra:bootstrap` without `--new`, then `infra:apply`). For
  the media Space that gap also means the 30-day recovery window in [STORAGE.md](STORAGE.md) never
  closes, so deleted versions accumulate until someone prunes them by hand. On a first run a
  refusal also leaves the created Space tainted, which `prevent_destroy` refuses to replace; clear
  it with `terraform untaint digitalocean_spaces_bucket.terraform_state` against the local
  bootstrap state, or `terraform untaint digitalocean_spaces_bucket.media` in the initialized
  foundation root with `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` exported from the `TF_STATE_*`
  values in `infra/digitalocean/.env.terraform-state` (the wrapper's own backend credentials),
  before the rerun, and never delete a Space or the state to get past it.
- Private media is never served through a public CDN. The backend issues short-lived signed URLs.
- Do not enable `deploy_on_push`: the guarded release command is the one promotion authority.
- Keep wrapper-owned `infra-release/*` branches immutable. Old branches are release evidence and
  may be removed only after the corresponding deployment is no longer a rollback target.
- App Platform's GitHub connection is an account authorization and cannot be made portable in this
  repository; verify it before the first release.

## Official references

- [DigitalOcean Terraform provider](https://docs.digitalocean.com/reference/terraform/)
- [App Platform](https://docs.digitalocean.com/products/app-platform/)
- [App Platform alerts](https://docs.digitalocean.com/products/app-platform/how-to/create-alerts/)
- [Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/)
- [Container Registry](https://docs.digitalocean.com/products/container-registry/)
- [Spaces](https://docs.digitalocean.com/products/spaces/)
