# Yandex Cloud Terraform Runbook

Use this path when [CHECKLIST.md](../CHECKLIST.md) records users in Russia or a Russian
data-residency requirement. Common safety and release rules live in
[DEPLOYMENT.md](DEPLOYMENT.md); Terraform source lives under
[`infra/yandex`](../infra/yandex).

## What Terraform creates

- a private network with subnets in `ru-central1-a`, `-b`, and `-d`;
- one private PostgreSQL 18 host, application database, login-capable migration owner, blue/green
  DML-only runtime users, seven-day backups, disk autoscaling, and deletion protection;
- a Container Registry and a seven-day log group;
- an HTTP Serverless Container behind API Gateway;
- one migration task container plus four HTTP job containers invoked by timer triggers;
- public Object Storage website buckets for `webapp` and `website`;
- a separate private media bucket and bucket-scoped runtime credentials stored in Lockbox;
- separate migration, runtime, gateway, trigger, publisher, and storage-management service
  accounts with narrow roles;
- an optional Postbox sender and optional Cloud CDN resources;
- a private versioned Object Storage bucket and scoped key for Terraform state.

`enable_cdn = false` and `route_static_through_cdn = false` by default. Static files then come
directly from Object Storage HTTPS website hosting. The first flag provisions two CDN origin
groups/resources with gzip while DNS stays direct; the second flag is a separate routing phase.
Direct bucket HTTPS remains a rollback path, and the media bucket stays private and outside CDN.

## Account preparation

Install `yc`, select the intended cloud/folder, and authenticate Docker through the release script.
The current CLI target must exactly match `cloud_id` and `folder_id` in both tfvars files; this
prevents a valid credential from changing the wrong account.

The first state bootstrap temporarily grants its new service account folder-level `storage.admin`
because the target bucket does not exist yet and versioning requires that role. The same command
installs a bucket policy scoped to that dedicated service account, removes the folder-wide role,
verifies bucket refresh and state access, and only then migrates local state. Because policy scope is
the service account rather than one key ID, a replacement key created on that same account can run
the documented lost-credential recovery; keys from other identities remain denied.

Create and validate three Certificate Manager certificates for the API, webapp, and website
domains. Each static bucket name must exactly equal its domain because direct Object Storage HTTPS
remains configured even after optional CDN activation. This keeps the existing origin healthy
during DNS propagation and gives rollback a working target.

## Configuration

```bash
cp infra/yandex/bootstrap/terraform.tfvars.example infra/yandex/bootstrap/terraform.tfvars
cp infra/yandex/production/terraform.tfvars.example infra/yandex/production/terraform.tfvars
export TF_VAR_database_owner_password='<third strong random value, at least 24 characters>'
export TF_VAR_database_blue_password='<strong random value, at least 24 characters>'
export TF_VAR_database_green_password='<different strong random value, at least 24 characters>'
export TF_VAR_jwt_secret="$(openssl rand -hex 32)"
```

Fill real cloud, folder, exact pushed `git_branch`, domain, certificate, and globally unique bucket
values. Release digests do not belong in this file: the wrapper writes them to the separate ignored
migration/runtime roots. Keep the owner password, both database slot passwords, and JWT secret in
the project secret manager and export all four for every plan/apply. Start every password version
at `1`, set `database_active_slot = "blue"`, and never change the password or version of the slot
reported as live by `infra:output`.

Set `dns_zone_domain` to the exact zone root and `dns_zone_id` to a Yandex Cloud DNS zone ID for
Terraform-managed CNAME records. API, webapp, and website must all be subdomains of that root, not
the zone apex: this topology uses CNAME records, while direct apex hosting needs a different
ANAME-capable design and Cloud CDN itself requires CNAME. With external DNS leave `dns_zone_id`
`null`; after the first release, read:

```bash
bun run infra:output -- yandex
```

The command prints the safe output allowlist; use its `required_dns_records` entry.

Optional Postbox delivery needs a verified sender and:

```hcl
email_delivery = "postbox"
email_from     = "Product <hello@example.com>"
```

Terraform creates the sender service-account key directly into Lockbox; it is not returned to the
terminal or written to a runtime env file.

## Commands

```bash
bun run infra:bootstrap -- yandex --new --dry-run
bun run infra:bootstrap -- yandex --new
bun run infra:apply -- yandex --dry-run
bun run infra:apply -- yandex
bun run infra:plan -- yandex
bun run infra:output -- yandex
bun run release -- yandex --dry-run
bun run release -- yandex
```

`infra:apply` creates only the stateful foundation and leaves release-owned roots untouched. During
the first bucket creation it gives the storage-management account temporary folder-level
`storage.admin`, which the provider requires for versioning and full bucket configuration. It then
installs that role only on the webapp, website, and media buckets and removes the broad role in the
same command. Access-key-specific bucket policies give publishers only sync operations without
bucket/version deletion and give the media runtime only object read/write/delete. Separate
anonymous rules expose only list/read on the two static buckets; the media policy has no such rule.
The static rule intentionally admits Yandex Cloud CDN's documented HTTP origin request, while
user-facing domains redirect to HTTPS. Each policy also lets the bucket-scoped IaC service account refresh and update bucket
configuration while explicitly denying bucket deletion and omitting object-version deletion. The
IaC key cannot access the separate Terraform-state bucket in steady state.

The release refuses foundation drift, builds and pushes one Linux AMD64 image from a `git archive`
of the captured commit, and applies it to the independent migration root. The script invokes the
authenticated task endpoint and requires HTTP 200 with `X-Task-Exit-Code: 0`; only then does it
apply the independent API/jobs runtime root. Foundation or runtime configuration cannot change as
a side effect of preparing the migration revision.

After promotion, the release builds both static workspaces from the same immutable Git archive in
`infra/yandex/static.Dockerfile`. It uploads
hashed `assets/` and `_astro/` objects first with immutable cache headers, then HTML/page shells
with revalidation headers. The second sync excludes hashed directories and uses `--delete`, so a
removed route stops being publicly current while old hashed assets remain available to clients
that loaded the previous HTML during rollout. Bucket versioning preserves deleted/replaced mutable
objects for recovery and expires those noncurrent versions after 30 days. Hashed objects remain
current by design; prune them only with a separately reviewed retention policy if their storage
cost becomes material. Each surface also publishes a revalidated release marker containing the
captured commit. Final verification reads that marker through the public domain with a cache-busting
query and requires an exact match, so a healthy stale CDN object or misdirected DNS target cannot be
reported as the new release.

The static publisher key is a sensitive Terraform output consumed in memory by the release
process. Its exact-key bucket policies cover only the two public static buckets and cannot delete a
bucket or a noncurrent object version. The API runtime uses a different exact-key policy scoped to
ordinary objects in the private media bucket, and its credentials are delivered through Lockbox.
Runtime access to Lockbox is also granted per referenced secret, including every
`extra_secret_bindings` entry; the runtime identity is not a folder-wide payload viewer and cannot
read the database-owner migration secret.

Migrations connect as the dedicated database owner, which owns the schema objects Prisma creates.
The API and jobs connect as the selected blue/green user and receive only Yandex's managed read and
write roles plus database `CONNECT`; after each migration, `db:deploy` also removes unsafe schema,
temporary-table, object, routine, and default privileges inherited through PostgreSQL `PUBLIC`.
The runtime users therefore do not get schema DDL or routine execution. The owner URL is held in a
separate migration-only Lockbox secret readable only by a dedicated one-shot migration identity.
That task receives only the owner URL and optional administrator seed, never the runtime JWT, media,
email, or blue/green database credentials. Each runtime slot has a persistent exact secret version
so an inactive-slot rotation cannot schedule destruction of the live runtime's version.

Importing a legacy database does not transfer its tables, sequences, routines, or enum/domain
types. Before the first migration, run the inventory and confirmed `db:adopt-owner -- --apply`
sequence in [DEPLOYMENT.md](DEPLOYMENT.md). The deployment preflight runs before Prisma and names
any object still owned by the legacy role instead of failing halfway through a migration.

## Jobs and networking

The provider timers use UTC:

| Job                       | Timer expression | Lock / invocation timeout | Purpose                                           |
| ------------------------- | ---------------- | ------------------------- | ------------------------------------------------- |
| `outbox:drain`            | `* * ? * * *`    | 240s / 180s               | Durable email/task delivery every minute          |
| `notifications:process`   | `* * ? * * *`    | 240s / 180s               | Push delivery and Expo receipt polling every minute |
| `uploads:pending:cleanup` | `15 * ? * * *`   | 900s / 840s               | Abandoned uploads hourly                          |
| `maintenance:process`     | `*/15 * ? * * *` | 240s / 180s               | Auth cleanup and notification redaction           |

The API and job containers join the VPC; Managed PostgreSQL has no public IP. Yandex assigns
connected Serverless Containers addresses from its documented `198.19.0.0/16` service range, so
the database security group allows TCP/6432 from exactly that range. The user-defined `10.20.*`
subnets host the database/network prerequisites but are not the containers' source addresses. API
Gateway has the only invoker identity for the HTTP container; the trigger identity can invoke only
job containers.

The timer containers run `cron.ts --http <job>`. A successful locked run returns HTTP 204; a job or
cleanup failure returns 503, which is visible to the trigger and activates its three configured
retries. Command/task mode is used only for the explicitly invoked migration because Yandex always
returns HTTP 200 for that mode and exposes the process result through `X-Task-Exit-Code`; the release
script checks that header before promotion.

## Database credential rotation

The two runtime users make password rotation an expand/contract transition across independent
Terraform states:

1. Run `bun run infra:output -- yandex` and note `database_credential_slot`.
2. Keep that live slot's exported password and version unchanged. Generate a new password for the
   inactive slot, export it, increment only its version in `terraform.tfvars`, and set
   `database_active_slot` to that inactive slot.
3. Run `bun run infra:apply -- yandex --dry-run`, then `bun run infra:apply -- yandex`. This prepares
   the second login and a new exact Lockbox version; the old runtime still uses the untouched slot.
4. Run `bun run release -- yandex`. Migration and runtime promotion use the prepared slot.
5. Rotate the now-inactive old slot only after `infra:output` confirms the new live slot.

The wrapper stores only password fingerprints in sensitive foundation output and compares the live
runtime slot before every foundation plan/apply. It refuses a version or password change to that
slot, including after a failed release. It also fingerprints the JWT secret and refuses to replace
it after a runtime exists: the application currently accepts one signing key, so safe JWT rotation
requires a future keyring/overlap change rather than invalidating every session or destroying both
slot versions. If the runtime state no longer reports a slot, the wrapper checks the provider for
the project's deployed API/job containers and fails closed while any remain; recover or import the
runtime state instead of treating it as a first release. Do not bypass the wrapper with raw
`terraform apply` for credential rotation.

## Operations

- The single `s3-c2-m8` database host is the economical launch profile. Add hosts/HA only after the
  availability requirement justifies the cost.
- Serverless retries are safe because recurring jobs use PostgreSQL advisory locks and the outbox
  claims rows idempotently. Both the long-running scheduler and HTTP-mode `cron.ts` use the same
  locked executor; the timeout budgets above come from the same versioned schedule file.
- CDN activation is two releases. First set only `enable_cdn = true`, run `infra:apply`, then
  `release`; DNS stays direct while `cdn_dns_records` exposes the new targets. Verify them, set
  `route_static_through_cdn = true`, and run `infra:apply` plus `release` again. For external DNS,
  switch the CNAMEs to `cdn_dns_records` between those phases and still record the routing flag.
- CDN removal reverses that order. With managed DNS, set only `route_static_through_cdn = false`,
  apply and release, wait at least the 300-second record TTL plus observed propagation, and verify
  direct Object Storage. With external DNS, switch to `direct_static_dns_records`, wait and verify,
  then record the false routing flag. Only afterward set `enable_cdn = false`, apply, and release
  with exact `--allow-destroy` entries for the two CDN resources and two origin groups reported by
  the saved-plan guard. Never destroy CDN in the same release that redirects DNS away from it.
- Do not put the private media bucket behind CDN.
- The API uses the last `X-Forwarded-For` value from trusted Yandex ingress; never expose the
  container directly through an untrusted proxy chain.

## Official references

- [Yandex Cloud Terraform provider](https://yandex.cloud/en/docs/tutorials/infrastructure-management/terraform-quickstart)
- [Serverless Containers operation modes](https://yandex.cloud/en/docs/serverless-containers/concepts/container)
- [Timer trigger retries](https://yandex.cloud/en/docs/serverless-containers/concepts/trigger/)
- [Managed Service for PostgreSQL](https://yandex.cloud/en/docs/managed-postgresql/)
- [Object Storage static hosting](https://yandex.cloud/en/docs/storage/operations/hosting/setup)
- [Cloud CDN](https://yandex.cloud/en/docs/cdn/)
- [Lockbox](https://yandex.cloud/en/docs/lockbox/)
