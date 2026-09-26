# DigitalOcean

Provider details for [`infra/digitalocean`](../infra/digitalocean). General rules and commands: [DEPLOYMENT](DEPLOYMENT.md).

## Resources

- A project, a VPC, and one account-wide Container Registry with deletion protection.
- Managed PostgreSQL 18: one node, the app database, a runtime user, and a firewall.
- The API app: the `api` service, the `scheduler` worker, and the `migrate` PRE_DEPLOY job, from one image digest.
- Static Sites apps for `webapp` and `website`.
- Private versioned media and state Spaces with scoped keys.

## Sizing

- Start with one `apps-s-1vcpu-1gb` API instance and a `db-s-1vcpu-1gb` database. Check prices first.
- Static Sites take no `instance_size_slug` or `instance_count`. SSR and server islands need a runtime; see [website/README](../website/README.md).
- The built-in CDN is enough unless you need external bot filters, rate limits, or geo rules.

## Account preparation

Install `doctl` 1.164+ and sign in. Let App Platform read the GitHub repository; check this account permission before the first release. Create an account Spaces key for bucket management, and never pass it to the app. Export the credentials without printing them:

```bash
export DO_EXPECTED_TEAM_UUID='<immutable Team UUID from doctl account get --output json>'
export DIGITALOCEAN_TOKEN='<API token>'
export SPACES_ACCESS_KEY_ID='<account Spaces key id>'
export SPACES_SECRET_ACCESS_KEY='<account Spaces secret>'
```

The token also needs `spaces_key:read`; every command checks its team and that it can read the Spaces key.

## Setup

```bash
cp infra/digitalocean/bootstrap/terraform.tfvars.example infra/digitalocean/bootstrap/terraform.tfvars
cp infra/digitalocean/production/terraform.tfvars.example infra/digitalocean/production/terraform.tfvars
export TF_VAR_jwt_secret="$(openssl rand -hex 32)"
```

- Regions must match: the example uses `fra` for App Platform and `fra1` for the VPC, database, and Spaces.
- Space names must be globally unique. `github_repo` is `owner/repository`; `git_branch` is the exact pushed branch.
- `registry_name` is account-wide. Import an existing registry before the first apply.
- The generated backend config signs with region `us-east-1`; keep it.
- With DigitalOcean DNS, set `dns_zone`. Otherwise keep `null` and create the App Platform records at your DNS provider.
- For Resend, set `email_delivery = "resend"` and `email_from`, and export `TF_VAR_extra_runtime_secret_env='{"EMAIL_RESEND_API_KEY":"<secret>"}'`.
- Keep the JWT secret and any Resend key in a secret manager. Export the same values for every plan and apply.

## Commands

Use the [DEPLOYMENT](DEPLOYMENT.md) commands with `digitalocean`. A release updates the API app, and App Platform deploys the API and scheduler only after the `migrate` PRE_DEPLOY job (`db:deploy`) succeeds. A second deploy removes a seed. Both Static Sites build from `infra-release/<40-char-sha>` with `deploy_on_push = false`, and the release checks their `source_commit_hash`.

Only PRE_DEPLOY gets the admin database connection; the API and scheduler use the runtime user. `db:deploy` resets that user's grants to CONNECT, schema USAGE, table DML, and sequence use. It refuses a runtime user with elevated attributes, inherited roles, or owned objects.

The image source has no `registry` field; DOCR rejects one.

## Alerts

Terraform sets these rules in `infra/digitalocean/runtime/main.tf` and `static/main.tf`:

- `DEPLOYMENT_FAILED`, all apps: a migration, build, or component failed; the previous release stays active.
- `DOMAIN_FAILED`, all apps: a DNS or certificate problem.
- `RESTART_COUNT` > 1 in 5 minutes, scheduler: a crash loop; the outbox, push delivery, and cleanup stop.
- `MEM_UTILIZATION` > 85% for 10 minutes, scheduler: close to an out-of-memory stop.
- `CPU_UTILIZATION` > 90% for 30 minutes, scheduler: probably a stuck job. A backlog never shows here.

Alerts go to the team's default email; reroute them in the app's Settings → Alert Policies. Keep destinations out of Terraform: provider 2.99.1 does not read them back, so a list plans a change on every run. After a console change, check that the destinations survive the next release.

No alert reads the outbox numbers. A failed pass without a crash appears only as `Scheduler job outbox:drain failed.` in the scheduler log of `<project_slug>-prod-api`. Values: [BACKGROUND_JOBS](BACKGROUND_JOBS.md).

```bash
doctl apps list --format ID,Spec.Name
doctl apps logs <app id> scheduler --type run --tail 500 | grep -A 11 'outbox:drain completed'
```

## Operations

- The service backs up the database; restore tests and HA are the operator's job.
- The database firewall trusts the VPC CIDR until the first release re-applies the foundation to narrow it to the API app. If the runtime state loses the App ID while the app exists, plan and apply stop. Restore or import the state; never widen access back to the VPC.
- An external database admin needs an explicit Terraform firewall rule, not a console change.
- Never enable `deploy_on_push` or change an `infra-release/*` branch. Delete an old release branch only when rollback no longer needs it.

### Spaces version expiry

DigitalOcean does not guarantee `NoncurrentVersionExpiration`. After each state bootstrap and media apply, read both rules with the account key as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`:

```bash
aws s3api get-bucket-lifecycle-configuration \
  --endpoint-url https://<spaces_region>.digitaloceanspaces.com --bucket <Space>
```

Expect `NoncurrentVersionExpiration` of 30 days. A missing element is a silent refusal that every plan repeats; an explicit refusal stops the apply. On the first refusal:

1. Remove `noncurrent_version_expiration` from both rules and their checks in `infra/digitalocean/{bootstrap,production}/tests/`.
2. Record the limit in `CHECKLIST.md`: old media versions pile up past the [STORAGE](STORAGE.md) window until a manual cleanup.
3. `prevent_destroy` blocks replacing a tainted Space. Run `terraform untaint digitalocean_spaces_bucket.terraform_state` in the local bootstrap state, or `terraform untaint digitalocean_spaces_bucket.media` in the foundation, initialized with the `TF_STATE_*` keys from `infra/digitalocean/.env.terraform-state`.
4. Rerun `infra:bootstrap -- digitalocean` without `--new`, then `infra:apply -- digitalocean`.

Never delete a Space or state to get around the error.
