# Yandex Cloud

[infra/yandex](../infra/yandex) defines resources, roles, network rules, and defaults. Use [Deployment](DEPLOYMENT.md) for bootstrap, release, and state recovery.

## Account preparation

Install `yc` and the AWS CLI. Select the cloud and folder. Commands compare them with both tfvars files. Prepare validated Certificate Manager certificates for the API and static domains. Each static bucket name must match its domain.

## Setup

```bash
cp infra/yandex/bootstrap/terraform.tfvars.example infra/yandex/bootstrap/terraform.tfvars
cp infra/yandex/production/terraform.tfvars.example infra/yandex/production/terraform.tfvars
export TF_VAR_database_owner_password='<strong owner password>'
export TF_VAR_database_blue_password='<different strong password>'
export TF_VAR_database_green_password='<different strong password>'
export TF_VAR_jwt_secret='<strong generated secret>'
```

Use at least 24 characters for each database password. Keep all secrets in a secret manager and export the same values for later plans. Start password versions at `1` and select the blue slot.

Use the examples for cloud IDs, domains, certificates, bucket names, and the pushed Git branch. Set `dns_zone_domain` to the zone apex. Application domains must be subdomains because their records are CNAMEs.

For managed DNS, set `dns_zone_id`. For external DNS, leave it null and create `required_dns_records` from `infra:output` after the first release.

For email, verify a Postbox sender and set `email_delivery = "postbox"` and `email_from`. Terraform writes the sender key to Lockbox. Put each extra secret in its own Lockbox secret. A granted identity can read every key and version in that secret.

## Releases and permissions

A release runs the migration task, removes its seed, updates runtime containers, and publishes static sites. Migration must report HTTP 200 and `X-Task-Exit-Code: 0`. Static publication follows the runtime switch. Rerun an interrupted release after correcting the cause.

Hashed static assets remain available for clients with old HTML. Remove them only through a reviewed retention policy.

Runtime binds only its required Lockbox secrets. The API and jobs share one identity. Migration receives only the owner connection and optional seed. [Variable targets](DEPLOYMENT.md#extra-runtime-variables) control container bindings, not identity permissions.

The first apply temporarily grants folder-level storage access while creating buckets. Rerun an interrupted apply to remove it. Keep bucket policies and deletion guards in Terraform. Never use broader access to bypass an apply error.

For an old media bucket without versioning, enable it through your operator identity, then apply the lifecycle rule. If a policy Deny blocks the change, remove the Deny in one reviewed apply and change versioning in the next.

## Static hosting recovery

Static buckets permit anonymous object reads without listing. A provider change can break this configuration. Releases check root pages, release markers, and a missing webapp route. The route must return the application shell with status below 500.

If sync fails on listing or static pages return 403:

1. Set `list = true` in both static `anonymous_access_flags`.
2. Restore anonymous `s3:ListBucket` on both bucket ARNs.
3. Update the matching production Terraform tests.
4. Run `infra:apply` and verify the public URLs.

Also check directory redirects when adding paths that need a trailing slash.

## Media version recovery

Runtime and infrastructure keys cannot recover old media versions. Use a separate operator identity:

1. Create a service account and static key. Grant bucket-level `storage.editor`.
2. Save the whole policy with `yc storage bucket get <bucket> --full --format json`.
3. Add a temporary statement for the account's `CanonicalUser`. Grant `s3:ListBucketVersions` on the bucket and `s3:GetObjectVersion`, `s3:PutObject`, and `s3:DeleteObjectVersion` on its objects.
4. Apply the complete policy with `yc storage bucket update --policy-from-file`. A partial document replaces existing permissions and can disconnect the runtime.
5. Use the new key with `aws s3api list-object-versions --endpoint-url https://storage.yandexcloud.net --bucket <bucket>`.
6. Copy the required version or remove its delete marker.
7. Remove temporary role access, revoke the temporary key, and run `infra:apply` to restore the declared policy.

A release refuses a foundation that still differs from Terraform.

## Alerts and logs

The provider cannot create Monitoring alerts and channels. Configure them manually after the first release. Get job container IDs with `yc serverless container list --folder-id <folder_id>`.

Create an email channel named `prod-alerts`. Recipients need `monitoring.viewer` and an email in their Monitoring profile.

For `outbox drain stopped`, use:

```text
series_sum(drop_empty_series("serverless.containers.started_per_second"{folderId="<folder_id>", service="serverless-containers", container="<outbox container id>"}))
```

Use Maximum over 10 minutes. Alarm below `0.001` and alarm on missing metrics or points. Both functions are needed because old revision series remain after releases.

For `job failed`, use:

```text
"serverless.containers.errors_per_second"{folderId="<folder_id>", service="serverless-containers", container="<outbox id>|<uploads id>|<auth id>"}
```

Use Maximum over 5 minutes. Alarm above zero and treat missing data as OK. Include every scheduled job container, excluding the API.

These alert queries still need verification in a live folder. Check the drain alert after two releases. Pause its timer, wait past the alert window, confirm the email, and resume the timer. If missing executions do not trigger it, test `serverless.triggers.read_events_per_second` with missing data set to Alarm.

Check that a job HTTP 503 triggers the failure alert. Otherwise test `serverless.triggers.error_per_second`, which counts retried calls.

Read outbox metrics by container because the message and metrics occupy separate log lines:

```bash
yc logging read --folder-id <folder_id> --group-name <project_slug>-prod-containers \
  --resource-ids <outbox-container-id> --since 10m
```

If running containers produce no visible logs, check the `min_level` filters in runtime and migration configuration. Remove the filter and release if it drops stdout or stderr. Keep the result in this guide.

References: [Monitoring alerts](https://yandex.cloud/en/docs/monitoring/concepts/alerting/alert), [container metrics](https://yandex.cloud/en/docs/monitoring/metrics-ref/serverless-containers-ref).

## Operator database access

Use your personal IAM identity with `yc managed-postgresql connect`. It creates a local proxy to the private database. Do not open the database publicly or share runtime and migration credentials.

Check `yc iam whoami`, the selected cloud, and the folder. A cloud administrator grants `managed-postgresql.clusters.connector` to that subject:

```bash
yc managed-postgresql cluster add-access-binding \
  --name <project_slug>-prod-postgres \
  --role managed-postgresql.clusters.connector \
  --user-account-id <iam_subject_id>
```

For a federated user, use `--subject federatedUser:<iam_subject_id>`. Create one database IAM user per person:

```bash
yc managed-postgresql user create <iam_subject_id> \
  --cluster-name <project_slug>-prod-postgres \
  --auth-method auth-method-iam \
  --permissions <project_slug_with_underscores> \
  --grants mdb_read_all_data
```

Disable deletion protection for this IAM user in the console so access can later be removed. The read role permits application SELECT access, not DDL or writes.

```bash
yc managed-postgresql connect <project_slug>-prod-postgres \
  --db <project_slug_with_underscores>
```

Before reading, verify `current_user`, `current_database()`, and membership in `mdb_read_all_data`. Use `--port` if the local port is busy.

Revoke access by deleting the database IAM user and removing the connector binding for the same subject. Production writes need separately reviewed temporary access. Schema changes use the release process.

## Database credential rotation

1. Read the active slot from `infra:output`.
2. Keep its password and version. Change the inactive slot's password and version, then select that slot.
3. Review and apply the foundation.
4. Release to migrate and switch runtime access.
5. Change the previous slot only after output confirms the new active slot.

The script refuses active-slot credential changes. It also blocks JWT rotation after runtime exists because overlapping signing keys are not implemented. Recover lost credential-slot state before another change.

## CDN changes

Enable CDN in two releases. First set `enable_cdn = true`, apply, release, and verify the CDN records. Then set `route_static_through_cdn = true`, apply, and release. For external DNS, switch CNAMEs between phases.

Disable it in reverse. Move traffic to direct Object Storage first. Wait for the DNS TTL and propagation, then verify direct hosting. Only afterward disable CDN and approve its exact resource deletions. Never remove CDN in the same release that moves traffic away.

Keep private media outside the public CDN.
