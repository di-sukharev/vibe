---
name: release
description: Runs a production deployment through scripts/infra.mjs — preconditions, local gates, a reviewed Terraform plan and apply, the release, and post-release verification. Use only on an explicit user request to deploy or release.
---

## Steps

0. Check preconditions; stop and report if any is missing:
   - an explicit request to deploy or release;
   - the hosting chosen in [CHECKLIST](../../../CHECKLIST.md);
   - a clean tree (`git status`) and the branch pushed;
   - a clear release commit.
1. Run the local gates: `bun run check` and `bun run test:terraform`, plus any e2e or smoke test the [DEPLOYMENT](../../../docs/DEPLOYMENT.md) or provider guide calls for.
2. Run `bun run infra:plan -- <provider>` and review the plan with the user. A destroy or a replace needs an exact `--allow-destroy=<address>` for that reviewed resource; stop and ask first. Apply only with `bun run infra:apply -- <provider>`. Never run raw `terraform apply`, `-target`, or state edits. If a release-root plan stops with `run infra:apply to refresh the foundation outputs`, follow [DEPLOYMENT](../../../docs/DEPLOYMENT.md#after-a-template-update).
3. On the first release only, pass the admin seed through the environment as [DEPLOYMENT](../../../docs/DEPLOYMENT.md#plan-and-release) describes. Never print `ADMIN_SEED_EMAIL` or `ADMIN_SEED_PASSWORD`.
4. Run `bun run release -- <provider> --dry-run`, then `bun run release -- <provider>`.
5. After the release, check `/health/ready`, the logs, run a sign-in smoke test, and confirm the deployed version.
6. Recovery: follow [DEPLOYMENT](../../../docs/DEPLOYMENT.md#rollback-and-recovery) — roll back with a new commit and a normal release, never a mutable tag; migrations only go forward.
7. Report to the user in plain words. Never print secrets or `tfvars` values.
