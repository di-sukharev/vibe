# Yandex Cloud

Provider details for [`infra/yandex`](../infra/yandex). General rules and commands: [DEPLOYMENT](DEPLOYMENT.md).

## Resources

- A private network with subnets in `ru-central1-a`, `-b`, and `-d`.
- One private PostgreSQL 18 host (`s3-c2-m8`) with 7-day backups, disk autoscaling, and deletion protection.
- A Container Registry and a 7-day log group.
- The API: an HTTP Serverless Container behind API Gateway. Jobs: a migration task container, and one HTTP container and timer per [`job-schedules.json`](../backend/src/job-schedules.json) entry.
- Versioned buckets: public `webapp` and `website` sites, private media with keys in Lockbox, and private state.
- A narrow service account per role.
- Optional Postbox and Cloud CDN.

## Account preparation

Install `yc` and the AWS CLI, and select the cloud and folder. Every command checks that `yc` targets the `cloud_id` and `folder_id` from both tfvars. Create and validate Certificate Manager certificates for the API, webapp, and website. Each static bucket name must equal its domain.

## Setup

```bash
cp infra/yandex/bootstrap/terraform.tfvars.example infra/yandex/bootstrap/terraform.tfvars
cp infra/yandex/production/terraform.tfvars.example infra/yandex/production/terraform.tfvars
export TF_VAR_database_owner_password='<third strong random value, at least 24 characters>'
export TF_VAR_database_blue_password='<strong random value, at least 24 characters>'
export TF_VAR_database_green_password='<different strong random value, at least 24 characters>'
export TF_VAR_jwt_secret="$(openssl rand -hex 32)"
```

- Fill in the cloud, folder, pushed `git_branch`, domains, certificates, and globally unique bucket names.
- Keep the three passwords and the JWT secret in a secret manager. Export all four for every plan and apply.
- Start with password versions `1` and `database_active_slot = "blue"`.
- Set `dns_zone_domain` to the exact zone apex. The three domains must be its subdomains, not the apex, because the records are CNAMEs.
- Terraform DNS: also set the Yandex Cloud DNS `dns_zone_id`. External DNS: keep `dns_zone_id = null`, and after the first release create the `required_dns_records` from `bun run infra:output -- yandex`.
- Postbox: set `email_delivery = "postbox"` and a verified sender in `email_from`. Terraform writes the sender key straight to Lockbox.
- Other extra variables go in `extra_runtime_env`, and their secrets in Lockbox through `extra_secret_bindings`. Keep each extra secret in its own Lockbox secret: the runtime can read every key and version of a granted secret. Scope them with `extra_env_components` ([DEPLOYMENT](DEPLOYMENT.md#extra-runtime-variables)).

## Commands

Use the [DEPLOYMENT](DEPLOYMENT.md) commands with `yandex`. After the image push, a release:

1. Applies the migration root and invokes the task, which must return HTTP 200 with `X-Task-Exit-Code: 0`. Then it removes the seed secret; after an interrupted release, the next run removes it before migrating.
2. Applies the runtime root: the API, gateway, jobs, timers, DNS, and CDN.
3. Builds the static sites from the same archive and syncs them. Hashed `assets/` and `_astro/` files are never deleted, so clients with old HTML keep working. Remove them only through a reviewed retention policy.
4. Checks the release markers, the webapp fallback, and the URLs.

Static sync runs after the runtime switch. If it fails, the new backend serves the old static sites until a successful rerun.

## Storage access and IAM

- Policies grant by exact access key. The static publisher only syncs the static buckets and cannot delete buckets or versions. The runtime media key only reads, writes, and deletes ordinary media objects.
- The runtime reads only its bound Lockbox secrets, including `extra_secret_bindings`; never grant it folder-wide access. The API and all job containers share this runtime identity. The migration reads only the owner URL and the optional seed.
- The first `infra:apply` gives the storage (IaC) account folder-level `storage.admin` only until the three app buckets exist. Rerun an interrupted apply to remove it.
- The IaC account has `s3:*` on bucket ARNs, not objects. A Deny blocks `s3:DeleteBucket` and `s3:PutBucketVersioning`, and nothing allows version deletion. Yandex enforces the versioning Deny, so Terraform cannot suspend versioning. Routine applies never hit it: versioning is set at creation, and the provider sends `PutBucketVersioning` only when that block changes. Keep `s3:*` on the bucket ARN: a narrower list protects nothing and can break refresh.
- The delete Deny is only extra defense. Yandex checks bucket deletion and policy changes through IAM: `storage.admin` for S3 calls, `storage.configurer` in the console; `storage.editor` can delete a bucket. The IaC key has bucket-level `storage.admin` and can lift the Deny, as can folder-level `storage.admin`, so treat the key as operator access. The real limits are `force_destroy = false`, media `prevent_destroy`, and the destroy guard.
- To change versioning, lift the Deny in one apply and change versioning in the next. For an old media bucket without versioning, run `yc storage bucket update --name <media bucket> --versioning versioning-enabled` as yourself; it passes through IAM, not the policy. If it fails, use the two applies. Then rerun `infra:apply` to add the lifecycle rule.
- The state bucket policy follows the same pattern for the `<project_slug>-tf-state` account, limited to bucket configuration and the current state and lock objects. The IaC key cannot reach the state bucket.

## Anonymous-access rollback

The static buckets allow anonymous object reads but not listing; the publisher lists through its key policy. Yandex documents website hosting with anonymous listing, so a provider change can break this setup. Every SPA deep link, including password reset, needs the missing-path fallback.

Every `bun run release -- yandex` syncs through the publisher's list permission, then checks the release markers through the public domains, `/` of both domains, and a missing webapp path. That path must return the index shell with a status below 500. After the first release, every `infra:apply` repeats the public checks.

If pages disappear after an apply, sync gets `AccessDenied` on list, hosting answers 403, or a check fails, restore the supported configuration:

1. Set `list = true` in both static `anonymous_access_flags`.
2. Add anonymous `s3:ListBucket` on both bucket ARNs back to their policies.
3. Update the matching checks in `infra/yandex/production/tests/production.tftest.hcl`.
4. Rerun `infra:apply`.

The checks do not cover directory paths without a trailing slash (`/docs` → `/docs/`); test such a path when you add one.

## Media version recovery

Only a separate operator identity can restore a media version: the IaC and runtime policies cannot read old versions or remove delete markers, and the console cannot open a bucket that has a policy.

1. Create your own service account with a static key. User accounts have none, and `yc` cannot list versions.
2. Give it bucket-level `storage.editor` in the console or Cloud API.
3. Save the policy: `yc storage bucket get <media bucket> --full --format json | jq .policy`.
4. Add a temporary statement for `CanonicalUser` = the account ID: `s3:ListBucketVersions` on the bucket ARN, and `s3:GetObjectVersion`, `s3:PutObject`, and `s3:DeleteObjectVersion` on `<bucket>/*`.
5. Write the whole document back with `yc storage bucket update --policy-from-file`. It replaces the policy, so a partial file cuts off the runtime. The caller needs only `storage.configurer` on the bucket.
6. With the new key, run `aws s3api list-object-versions --endpoint-url https://storage.yandexcloud.net --bucket <media bucket>`. Copy the version over the key, or delete the delete marker.
7. Remove the role binding and rerun `infra:apply` to drop the statement. Until then, `release` refuses the drifted foundation.

## Jobs and network

- The API and jobs join the VPC; PostgreSQL has no public IP. Serverless Containers connect from `198.19.0.0/16`, so the database security group allows TCP 6432 only from there. The `10.20.*` subnets hold the database, not the containers.
- Only API Gateway invokes the API container. The timer identity invokes only the job containers.
- Timers retry a failed call 3 times, 30 seconds apart. The HTTP job contract is in [BACKGROUND_JOBS](BACKGROUND_JOBS.md).
- The API trusts the last `X-Forwarded-For` hop from Yandex ingress. Never expose the container through an untrusted proxy chain.

## Alerts

The pinned provider cannot create Monitoring alerts or channels. After the first release, create these by hand once per folder; recreate them if the folder or containers are recreated. Get the job container IDs (`<project_slug>-prod-<key>`, with the `key` from `job-schedules.json`) from `yc serverless container list --folder-id <folder_id>`. References: [alerts](https://yandex.cloud/en/docs/monitoring/concepts/alerting/alert), [Serverless Containers metrics](https://yandex.cloud/en/docs/monitoring/metrics-ref/serverless-containers-ref).

1. **Channel.** Monitoring → Notification channels → Create channel: method `Email`, name `prod-alerts`. Recipients must be Yandex Cloud accounts with `monitoring.viewer` on the folder and an email in the Monitoring section of their console profile.
2. **`outbox drain stopped`.** Monitoring → Alerts → Create alert. Query: `series_sum(drop_empty_series("serverless.containers.started_per_second"{folderId="<folder_id>", service="serverless-containers", container="<outbox container id>"}))`. Aggregation `Maximum`, window `10m`, Alarm below `0.001`, `Alarm` for both `No selector metrics` and `No points in evaluation window`, channel `prod-alerts`. Keep both functions: each release leaves an empty old `revision` series that a bare selector can hold in Alarm.
3. **`job failed`.** Query: `"serverless.containers.errors_per_second"{folderId="<folder_id>", service="serverless-containers", container="<outbox id>|<uploads id>|<auth id>"}`. Aggregation `Maximum`, window `5m`, Alarm above `0`, both no-data policies `OK`, channel `prod-alerts`. List every job container, not `<project_slug>-prod-api`.

Neither alert is proven on a live folder yet:

- `outbox drain stopped` must be OK after the first and second releases. Then pause `<project_slug>-prod-outbox-timer` (ID from `yc serverless trigger list`) with `yc serverless trigger pause <timer id>`. Wait longer than the window, check the Alarm and the email, and run `yc serverless trigger resume <timer id>`. If the alert stays OK, use `"serverless.triggers.read_events_per_second"{folderId="<folder_id>", service="serverless-functions", trigger="<timer id>"}` with both no-data policies `Alarm`, and repeat the test.
- `job failed` must count an HTTP 503. If a 503 in the logs does not move it, use `"serverless.triggers.error_per_second"{folderId="<folder_id>", service="serverless-functions", trigger="<timer id>"}`, which counts retried calls.

No alert reads the outbox numbers ([BACKGROUND_JOBS](BACKGROUND_JOBS.md)). Read them in the log group by container, not by text, because the metrics follow the message on separate lines:

```bash
yc logging read --folder-id <folder_id> --group-name <project_slug>-prod-containers \
  --resource-ids <outbox container id> --since 10m
```

The containers set `log_options { min_level = "INFO" }`, and stdout and stderr lines have level `UNSPECIFIED`. It is undocumented whether the filter drops them. If running containers show no lines, remove `min_level` from `infra/yandex/runtime/containers.tf`, `runtime/ingress.tf`, and `migration/main.tf`, release, and record the result in `CHECKLIST.md`.

## Operator database access

Use your personal IAM identity for `psql`: `yc managed-postgresql connect` runs a local proxy to the private cluster. Never add a public IP, open `0.0.0.0/0`, download a Lockbox password, create a bastion for routine reads, or use the migration or runtime accounts.

The cluster is `<project_slug>-prod-postgres`. The database is the slug with underscores for hyphens: `example-app` → `example_app`. Install `psql`, sign in to `yc` as yourself, and check the target:

```bash
yc config get cloud-id
yc config get folder-id
yc iam whoami
yc managed-postgresql cluster list
yc managed-postgresql connect --help   # if missing: yc components update
```

### First grant

A cloud admin grants the connector role to the subject type and ID from your `yc iam whoami`:

```bash
yc managed-postgresql cluster add-access-binding \
  --name <project_slug>-prod-postgres \
  --role managed-postgresql.clusters.connector \
  --user-account-id <iam_subject_id>   # federated user: --subject federatedUser:<iam_subject_id>
```

Then create a PostgreSQL IAM user named after the subject ID. Start read-only: `mdb_read_all_data` allows SELECT on app data, not system catalogs, DML, or DDL.

```bash
yc managed-postgresql user create <iam_subject_id> \
  --cluster-name <project_slug>-prod-postgres \
  --auth-method auth-method-iam \
  --permissions <project_slug_with_underscores> \
  --grants mdb_read_all_data
```

The user copies the cluster's deletion protection. In the console, set its Deletion protection to Disabled under Users, so you can remove the access when the person leaves.

One database IAM user maps to one person. Never share the migration owner, `blue`/`green`, or `mdb_admin`/`mdb_superuser` for reads. Schema changes go through `bun run release -- yandex`; a direct production write needs separately reviewed temporary access.

### Connect and verify

```bash
yc managed-postgresql connect <project_slug>-prod-postgres \
  --db <project_slug_with_underscores>
```

Before reading, check the identity, database, and role:

```sql
SELECT current_user, current_database();
SELECT pg_has_role(current_user, 'mdb_read_all_data', 'member') AS can_read_application_data;
```

If the local port is busy, add `--port <free_local_port>`. To revoke access, delete the user and the binding with the same `--user-account-id` or `--subject`:

```bash
yc managed-postgresql user delete <iam_subject_id> \
  --cluster-name <project_slug>-prod-postgres
yc managed-postgresql cluster remove-access-binding \
  --name <project_slug>-prod-postgres \
  --role managed-postgresql.clusters.connector \
  --user-account-id <iam_subject_id>
```

## Database password rotation

The migration logs in as the schema owner, and the API and jobs as the active `blue` or `green` user with read and write grants only. To rotate:

1. Run `bun run infra:output -- yandex` and note `database_credential_slot`.
2. Keep the active slot's password and version. For the inactive slot, export a new password, raise only its version, and select it in `database_active_slot`.
3. Run `bun run infra:apply -- yandex --dry-run`, then `bun run infra:apply -- yandex`. The new login is ready, and the old runtime still works.
4. Run `bun run release -- yandex` to migrate and switch.
5. Change the old slot only after `infra:output` shows the new slot as active.

Every plan and apply refuses a change to the active slot's password or version, also after a failed release. Once a runtime exists, they also refuse a new JWT secret: the app accepts one key, so rotation needs key-overlap support first. If the runtime state loses the slot while API or job containers exist, the script stops; recover the state as in [DEPLOYMENT](DEPLOYMENT.md).

## Operations

- `enable_cdn` creates two CDN resources and origin groups with gzip, without DNS changes. `route_static_through_cdn` moves the traffic. Direct Object Storage HTTPS stays the rollback path. Never put private media behind CDN.
- Enable CDN over two releases. Set only `enable_cdn = true`, run `infra:apply` and `release`, and check `cdn_dns_records`. Then set `route_static_through_cdn = true` and run both again. With external DNS, switch the CNAMEs between the phases and still set the flag.
- Disable CDN in reverse. With Terraform DNS, set `route_static_through_cdn = false`, run apply and release, wait at least the 300-second TTL plus propagation, and check direct Object Storage. With external DNS, switch to `direct_static_dns_records`, wait, check, and then set the flag to `false`.
- Only after the traffic leaves CDN, set `enable_cdn = false` and run apply and release with an exact `--allow-destroy` for each CDN resource and origin group in the plan. Never remove CDN in the release that moves DNS away.
