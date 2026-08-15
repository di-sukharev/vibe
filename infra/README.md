# Infrastructure as Code

Terraform state is split at operational boundaries, not merely across files:

```text
infra/
├── digitalocean/
│   ├── bootstrap/   # remote-state Space and scoped key
│   ├── operations/  # provider-wide production mutation lease
│   ├── production/  # stateful foundation: VPC, PostgreSQL, registry, media
│   ├── runtime/     # API, scheduler, and PRE_DEPLOY migration
│   └── static/      # webapp and website, applied only after runtime succeeds
└── yandex/
    ├── bootstrap/   # remote-state Object Storage bucket and scoped key
    ├── operations/  # provider-wide production mutation lease
    ├── production/  # stateful foundation: network, DB, secrets, buckets, IAM
    ├── migration/   # isolated one-shot migration container
    └── runtime/     # API, gateway, jobs, DNS, and optional CDN
```

The split is a release guarantee. A routine code release first requires a clean foundation plan,
then changes only release-owned state. DigitalOcean applies the API app and waits for its
`PRE_DEPLOY` migration before touching either static app. Yandex invokes the isolated migration
task successfully before changing the API or HTTP timer containers. A failed migration therefore
cannot partially publish the frontend or mutate the old runtime configuration.

Every root has a separate locked S3-compatible state key. The bootstrap state remains separate
because a bucket cannot store its own state before it exists. Provider versions and dependency
checksums are pinned per root. Non-dry foundation applies, releases, and production imports also
hold the provider's `operations` state lock for their complete multi-root sequence, so two wrappers
cannot interleave migration, runtime, static, or foundation changes. The wrapper rechecks the lease
between every mutating phase and stops the sequence if ownership is lost.

## Commands

```bash
bun run infra:bootstrap -- <digitalocean|yandex> --new [--dry-run] # first creation only
bun run infra:bootstrap -- <digitalocean|yandex>                   # resume/reconnect
bun run infra:apply -- <digitalocean|yandex> [--dry-run]
bun run infra:plan -- <digitalocean|yandex>
bun run infra:output -- <digitalocean|yandex>
bun run infra:import -- <provider> <root> <terraform-address> <provider-resource-id> [adoption flags]
bun run release -- <digitalocean|yandex> [--dry-run]
```

Use `infra:apply` for deliberate foundation changes and then require a clean `infra:plan` before a
release. Do not call `terraform apply` directly. `scripts/infra.mjs` creates a saved plan, inspects
machine-readable actions, refuses protected destruction, applies that exact plan, enforces phase
ordering, and verifies public endpoints.

`terraform.tfvars.example` exists only in the provider's bootstrap and production roots. Runtime
roots receive mode-`0600`, ignored input files generated from foundation outputs and the immutable
release. Generated backend HCL, auto variables, plans, local state, and credentials are ignored.

The explicit `--new` flag prevents an empty local bootstrap from being mistaken for infrastructure
whose generated credential file was lost. For that recovery case, use the reattach procedure in
[docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md); it verifies the existing bucket and state before it
reconciles the Terraform-managed backend key.

## Source identity

The wrapper accepts only a clean pushed commit on the configured upstream. Docker builds consume a
`git archive` of that captured commit, rather than the mutable working directory. Yandex static
artifacts are also built from that archive in `static.Dockerfile`.

DigitalOcean App Platform supports a branch source but no commit field. The wrapper creates a
never-overwritten `infra-release/<40-character-sha>` remote branch, configures both static apps to
that branch, and checks each active deployment's `source_commit_hash` before reporting success.

Provider static-access-key resources are intentionally never import targets: the pinned Yandex and
DigitalOcean providers cannot import them or recover their secret. Adopt the surrounding resources,
let Terraform create replacement keys, switch and verify consumers, then revoke legacy keys using
the sequence in [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md).

## Ownership rules

- Terraform owns cloud resources, IAM, runtime configuration, domains, timers, and storage policy.
- `backend/src/jobs.ts` owns job names; `backend/src/job-schedules.json` declares scheduler and
  Yandex timer expressions plus lock and execution budgets once.
- `scripts/infra.mjs` owns generated inputs and the release sequence.
- Provider consoles are for observation, account authorization, and emergency diagnosis. Import a
  deliberate console-created resource or revert drift; do not leave it unmanaged.
- Secret values may enter through `TF_VAR_*`, but Terraform state necessarily contains them.
  Protect every state key and the generated local state-credential file accordingly.

See [docs/DEPLOYMENT.md](../docs/DEPLOYMENT.md) and the provider runbooks for prerequisites,
adoption commands, rollback, and provider-specific constraints.
