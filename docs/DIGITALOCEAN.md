# DigitalOcean

[infra/digitalocean](../infra/digitalocean) defines resources, sizes, permissions, and alerts. Use [Deployment](DEPLOYMENT.md) for bootstrap, release, and recovery.

## Account preparation

Install `doctl` and authenticate. Allow App Platform to read the product's GitHub repository. Create an account Spaces key for infrastructure management. Do not give that key to the runtime.

```bash
export DO_EXPECTED_TEAM_UUID='<Team UUID from doctl account get --output json>'
export DIGITALOCEAN_TOKEN='<API token>'
export SPACES_ACCESS_KEY_ID='<account Spaces key id>'
export SPACES_SECRET_ACCESS_KEY='<account Spaces secret>'
```

The API token needs `spaces_key:read`. Commands verify the team and Spaces access before changing resources.

## Setup

```bash
cp infra/digitalocean/bootstrap/terraform.tfvars.example infra/digitalocean/bootstrap/terraform.tfvars
cp infra/digitalocean/production/terraform.tfvars.example infra/digitalocean/production/terraform.tfvars
export TF_VAR_jwt_secret='<strong generated secret>'
```

Use the examples for required inputs and defaults. Match App Platform and resource regions. Use globally unique Space names and the exact pushed Git branch. Import an existing account registry before applying.

Keep the backend signing region `us-east-1`. For external DNS, leave `dns_zone = null` and create the required App Platform records yourself.

For email, verify a Resend domain. Set `email_delivery` and `email_from`, then export `TF_VAR_extra_runtime_secret_env` with `EMAIL_RESEND_API_KEY`. Preserve the same secrets for later plans and applies.

Scope extra variables through [extra_runtime_env and secret targets](DEPLOYMENT.md#extra-runtime-variables).

## Release behavior

App Platform runs `db:deploy` as PRE_DEPLOY. The API and scheduler switch only after it succeeds. Only migration receives the owner database connection. Runtime processes use restricted grants.

Static apps build from immutable release branches with deploy-on-push disabled. The release verifies their source commits. Keep those settings under the release script's control.

## Alerts and logs

Terraform configures deployment, domain, and scheduler health alerts. Read thresholds in the runtime and static configuration. Alert destinations remain in App Platform settings because the provider cannot read them back reliably. Verify destinations after a release.

Provider health alerts do not inspect outbox metrics. Read scheduler logs:

```bash
doctl apps list --format ID,Spec.Name
doctl apps logs <app-id> scheduler --type run --tail 500
```

[Background jobs](BACKGROUND_JOBS.md#operations) explains the metrics.

## Network and recovery

The first release narrows the database firewall from the VPC to the API app. If state loses that app ID, recover or import it. Do not widen the firewall to bypass the guard.

Operator database access needs an explicit Terraform firewall rule. The operator must verify backups and restore procedures.

### Spaces version expiry

After state bootstrap and media apply, verify the lifecycle configuration with the account key:

```bash
aws s3api get-bucket-lifecycle-configuration \
  --endpoint-url https://<region>.digitaloceanspaces.com --bucket <Space>
```

Expect noncurrent-version expiry after 30 days. DigitalOcean can refuse or omit this setting. If it does:

1. Remove `noncurrent_version_expiration` and its matching Terraform tests from the affected roots. Document manual retention in this guide.
2. If the failed apply tainted the Space, initialize the owning root and run `terraform untaint <address>`. The addresses are `digitalocean_spaces_bucket.terraform_state` and `digitalocean_spaces_bucket.media`.
3. Rerun bootstrap without `--new`, then apply the foundation.

Never replace a Space or delete state to bypass this failure. Old media versions need operator cleanup when automatic expiry is unavailable.
