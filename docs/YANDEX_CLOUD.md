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
- one migration task container plus three HTTP job containers invoked by timer triggers;
- public Object Storage website buckets for `webapp` and `website`;
- a separate private versioned media bucket and bucket-scoped runtime credentials stored in
  Lockbox; its lifecycle rule expires noncurrent versions after 30 days and aborts incomplete
  multipart uploads after 7;
- separate migration, runtime, gateway, trigger, publisher, and storage-management service
  accounts with narrow roles;
- an optional Postbox sender and optional Cloud CDN resources;
- a private versioned Object Storage bucket and scoped key for Terraform state; its lifecycle rule
  expires noncurrent versions after 30 days and aborts incomplete multipart uploads after 7.

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
the documented lost-credential recovery; keys from other identities remain denied. That policy also
denies the state account `s3:DeleteBucket` and `s3:PutBucketVersioning`; the foundation section
below explains what such a Deny does and does not guarantee on Yandex.

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
bucket/version deletion and give the media runtime only object read/write/delete. The two static
buckets allow anonymous object reads only; no anonymous request can list them. Website hosting,
the optional CDN origin, and the release-marker check fetch objects by path, and the publisher's
`ListBucket` is granted to its access key: the publisher holds no IAM role, and the key-conditioned
policy authorizes its listing exactly as it authorizes its uploads. Yandex asks for both: its
console guide opens object reads and object listing, and its hosting concept page lists a bucket
with anonymous listing off among the configurations hosting does not support. This template opens
reads only anyway, because listing is not what hosting uses, so it sits outside that stated
envelope: a future Yandex change may legitimately break it, the rollback below restores the
supported configuration, and the release proves the current state on every run: `bun run release
-- yandex` syncs with the publisher key (a list on
every run), reads the release marker through the public domains, requests a webapp path that does
not exist and requires the index shell back with whatever 2xx/4xx status carries it (every deep
link into the single-page app, including emailed password-reset links, depends on that
error-document fallback), and finally fetches `/` on both domains. On an existing install the
flags take effect the moment `infra:apply` finishes, so once a release has run (the runtime root
exists) the apply itself ends by requiring the release marker and `/` of both static domains to
still be readable and by running that same probe, and fails with a pointer to this rollback if any
of them does not come back; before the first release there is nothing to read, and that release
runs the same checks. If that post-apply check fails, the static sync fails with
`AccessDenied` on a list request (the sync runs after the runtime deploy, so the runtime serves
the new commit with the previous static build until a rerun), hosting answers 403, or the release
probe fails, restore `list = true` in both static
`anonymous_access_flags` blocks, re-add an anonymous `s3:ListBucket` allow on the bucket ARN in
both static policies, flip the `infra/yandex/production/tests/production.tftest.hcl` assertions
that pin anonymous listing off, and rerun `infra:apply`. Nested directory paths without a trailing
slash (`/docs` redirecting to `/docs/`) are exercised by no current surface or check; probe one by
hand when the website gains such a route. The media bucket has no anonymous rule. The public read
rule intentionally admits Yandex Cloud CDN's documented HTTP origin request, while user-facing
domains redirect to HTTPS.

Each policy also lets the bucket-scoped IaC service account refresh and update bucket configuration
(`s3:*` on the bucket ARN, never on objects) and denies it `s3:DeleteBucket` and
`s3:PutBucketVersioning`; object-version deletion is never granted. Read that Deny for exactly what
it is. Yandex checks a policy's Deny before anything else and lists `s3:PutBucketVersioning` as a
policy action, so a Terraform change that suspends versioning fails and the 30-day recovery window
stays intact. Bucket deletion and policy management are not policy actions on Yandex; IAM alone
authorizes them (`storage.configurer` is the documented minimum to apply or delete a policy from
the console, `storage.admin` for a service account through the S3 API as Terraform does, and
`storage.editor` deletes a bucket), and the IaC account holds `storage.admin` on its three
buckets. So the `s3:DeleteBucket` Deny is defense in depth at most: Terraform removes the policy
resource before it would delete a bucket, and `force_destroy = false`, the media bucket's
`prevent_destroy`, and the wrapper's destroy allowlist are the Terraform-side stops. Neither Deny
protects against whoever holds the IaC key or a folder-level `storage.admin`: either can rewrite
the policy first. Treat that key as an operator credential. The Deny cannot lock Terraform out:
versioning is set once at creation, before the policy exists, the provider sends
`PutBucketVersioning` only when the `versioning` block changes, and policy updates are authorized
by the IAM binding, so the next `infra:apply` rewrites the policies with the same key it always
used; `s3:*` stays so that they remain allowed should the policy be consulted as well. Do not
replace it with an enumerated list: that would protect nothing (the same key rewrites the policy
through IAM) and would break bucket refresh the day the provider reads one more attribute. If a
future change must alter versioning, drop the Deny in one apply and change versioning in the next.
A media bucket created before this template versioned it is that case with a shorter path: enable
versioning once with your own identity,
`yc storage bucket update --name <media bucket> --versioning versioning-enabled`
(`yc` goes through the Cloud API, where IAM authorizes the call; an S3 `put-bucket-versioning`
from any other key would match no Allow statement and be rejected, and if Yandex rejects the `yc`
update too, the two-apply path above is the fallback), then rerun `infra:apply`; the refreshed
bucket already matches the configuration, so the provider sends no `PutBucketVersioning` and the
apply installs the lifecycle rule.
The IaC key cannot access the separate Terraform-state bucket in steady state.

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
reported as the new release. It then requests a webapp path that does not exist and requires the
index shell, proving the single-page fallback still works on the public domain.

The static publisher key is a sensitive Terraform output consumed in memory by the release
process. Its exact-key bucket policies cover only the two public static buckets and cannot delete a
bucket or a noncurrent object version. The API runtime uses a different exact-key policy scoped to
ordinary objects in the private media bucket, so a delete through it leaves a version it cannot
remove for the 30 days [STORAGE.md](STORAGE.md) describes, and its credentials are delivered
through Lockbox. Restoring one of those versions needs an operator identity first. Yandex checks
IAM before the bucket policy, rejects an S3 request that no policy statement allows, and disables
console access to a bucket that has a policy; the media policy names only the IaC account (bucket
actions) and the runtime key (ordinary objects), so nothing it names can read a noncurrent version
or remove a delete marker, and the IaC key is not an output. Use a service account of your own
with a static access key (user accounts hold none, and `yc` has no version-listing command): bind
it bucket-scoped `storage.editor`, the role Yandex documents for restoring object versions, in the
console or through the Cloud API, so the request passes IAM; then add a temporary policy statement
for it (`CanonicalUser` = its id) allowing `s3:ListBucketVersions` on the bucket ARN and
`s3:GetObjectVersion`, `s3:PutObject`, and `s3:DeleteObjectVersion` on `<bucket>/*`: start from
the current policy, the `policy` field of `yc storage bucket get <media bucket> --full --format json`
(`| jq .policy` isolates it), append the statement to its `Statement` list, and write that policy
document back with `yc storage bucket update --policy-from-file`,
which replaces the policy rather than merging into it; a file holding only the new statement
would cut the runtime key off from media until the next apply (policy edits are IAM-authorized;
`storage.configurer` on the bucket is enough for the account running `yc`). Restore through an S3
client signed with that key, for example
`aws s3api list-object-versions --endpoint-url https://storage.yandexcloud.net --bucket <media bucket>`,
then a copy of the version back over its key or a delete of the marker. Afterwards remove the
binding and rerun `infra:apply`, which rewrites the policy without that statement; the release
refuses foundation drift until it does.
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

| Job                       | Timer expression | Lock / invocation timeout | Purpose                                  |
| ------------------------- | ---------------- | ------------------------- | ---------------------------------------- |
| `outbox:drain`            | `* * ? * * *`    | 240s / 180s               | Durable email/task delivery every minute |
| `uploads:pending:cleanup` | `15 * ? * * *`   | 900s / 840s               | Abandoned uploads hourly                 |
| `auth:sessions:cleanup`   | `0 3 ? * * *`    | 240s / 180s               | Expired sessions/reset tokens daily      |

The API and job containers join the VPC; Managed PostgreSQL has no public IP. Yandex assigns
connected Serverless Containers addresses from its documented `198.19.0.0/16` service range, so
the database security group allows TCP/6432 from exactly that range. The user-defined `10.20.*`
subnets host the database/network prerequisites but are not the containers' source addresses. API
Gateway has the only invoker identity for the HTTP container; the trigger identity can invoke only
job containers.

The timer containers run `cron.ts --http <job>`. A successful locked run returns HTTP 204; a job or
cleanup failure returns 503, which is visible to the trigger and activates its three configured
retries. Only the trigger's `POST /` runs the job (Yandex invokes a container from a trigger with an
HTTP POST, and the trigger sets no path): other methods get 405, other paths 404, and nothing runs,
so a probe or a stray `GET /favicon.ico` from an identity with invoker rights cannot execute the
cleanup. Command/task mode is used only for the explicitly invoked migration because Yandex always
returns HTTP 200 for that mode and exposes the process result through `X-Task-Exit-Code`; the release
script checks that header before promotion.

## Operator database access

Use IAM authentication through the Yandex Cloud CLI for an interactive `psql` session. The
`yc managed-postgresql connect` command runs a local PostgreSQL proxy, so it works with this
template's private cluster: do not give the database host a public IP, add a `0.0.0.0/0` security
group rule, download a database password from Lockbox, or create a bastion VM just for routine
operator access.

The cluster name is `<project_slug>-prod-postgres`. The database name is `project_slug` with every
hyphen replaced by an underscore. For example, `project_slug = "example-app"` produces cluster
`example-app-prod-postgres` and database `example_app`.

Install `psql`, authenticate `yc` as the person who needs access, and confirm that the active cloud
and folder match both Yandex tfvars files:

```bash
yc version
yc managed-postgresql connect --help
yc config get cloud-id
yc config get folder-id
yc iam whoami
yc managed-postgresql cluster list
```

If the installed CLI does not have `yc managed-postgresql connect`, update it with
`yc components update`. Do not authenticate this session as one of the Terraform runtime or
migration service accounts: operator access is personal and auditable.

### One-time access setup

`yc iam whoami` prints the current subject type and ID. Give that output to a cloud administrator
who can manage cluster access and users. The administrator grants the connector role on this exact
cluster. For a Yandex account or an organization-local user:

```bash
yc managed-postgresql cluster add-access-binding \
  --name <project_slug>-prod-postgres \
  --role managed-postgresql.clusters.connector \
  --user-account-id <iam_subject_id>
```

For a federated user, replace the last argument with:

```bash
--subject federatedUser:<iam_subject_id>
```

Then the administrator creates a PostgreSQL IAM user whose name is the same IAM subject ID. Start
with read-only access; `mdb_read_all_data` permits `SELECT` over application data without granting
read-all access to system catalogs or allowing DML/DDL:

```bash
yc managed-postgresql user create <iam_subject_id> \
  --cluster-name <project_slug>-prod-postgres \
  --auth-method auth-method-iam \
  --permissions <project_slug_with_underscores> \
  --grants mdb_read_all_data
```

The CLI creates the user with deletion protection set to `Same as cluster`, while this template
protects the cluster. In the management console, open the cluster's **Users** tab, configure this
new personal user, and set **Deletion protection** to **Disabled**. This does not weaken cluster or
application-user protection; it only ensures that offboarding can remove this person's access.

Create one IAM database user per person. Do not share the migration owner, reuse the blue/green
application users, or grant `mdb_admin`/`mdb_superuser` for ordinary inspection. Schema changes
remain release-owned and run through `bun run release -- yandex`; direct production writes require
a separately reviewed, time-bounded access decision.

### Connect and verify

The operator can now connect without a database password or CA file:

```bash
yc managed-postgresql connect <project_slug>-prod-postgres \
  --db <project_slug_with_underscores>
```

Inside `psql`, verify the identity, target database, and read-only grant before inspecting data:

```sql
SELECT current_user, current_database();
SELECT pg_has_role(current_user, 'mdb_read_all_data', 'member') AS can_read_application_data;
```

Use `\q` to close the session and local proxy. If the CLI reports that its local proxy port is
already occupied, repeat the connect command with `--port <free_local_port>`.

Access created here is deliberately person-specific and is not one of the application's
Terraform-managed credentials. During offboarding, delete the IAM database user and remove the
matching connector binding; use the same `--user-account-id` or federated `--subject` form used
when access was granted:

```bash
yc managed-postgresql user delete <iam_subject_id> \
  --cluster-name <project_slug>-prod-postgres

yc managed-postgresql cluster remove-access-binding \
  --name <project_slug>-prod-postgres \
  --role managed-postgresql.clusters.connector \
  --user-account-id <iam_subject_id>
```

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
- [Connecting to Managed PostgreSQL with IAM](https://yandex.cloud/en/docs/managed-postgresql/operations/connect/clients#iam-auth)
- [`yc managed-postgresql connect` CLI reference](https://yandex.cloud/en/docs/managed-postgresql/cli-ref/connect)
- [Managing PostgreSQL users](https://yandex.cloud/en/docs/managed-postgresql/operations/cluster-users)
- [Managed PostgreSQL roles](https://yandex.cloud/en/docs/managed-postgresql/concepts/roles)
- [Object Storage static hosting](https://yandex.cloud/en/docs/storage/operations/hosting/setup)
- [Cloud CDN](https://yandex.cloud/en/docs/cdn/)
- [Lockbox](https://yandex.cloud/en/docs/lockbox/)
