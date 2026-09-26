# Mobile template

The working Expo app lives on the `mobile` branch, not on `master`. That branch adds the Expo app, development builds, Maestro E2E, Expo Push, and social sign-in. App Store and Google Play subscriptions are in the code but disabled by configuration.

## Start from the mobile branch

```bash
git fetch origin
git merge-base --is-ancestor origin/master origin/mobile
git switch mobile
bun install --frozen-lockfile
```

Stop setup if the ancestry check fails; the template owner must merge `master` into `mobile` first. Never resolve template conflicts inside a product project.

## Branch ownership

- Make shared web, backend, infrastructure, deployment, and contract changes on `master`.
- Make mobile app changes, and backend or contract changes that only mobile needs, on `mobile`.
- Mobile payments are native and separate from the browser checkout. Read [WEB_SURFACES.md](../docs/WEB_SURFACES.md) first, and check the current store rules for the product, storefront, and region.

## Template owner: sync and publish

Merge `master` into `mobile`, align docs and the capability registry, then check and publish both branches.

```bash
git fetch origin
bun install --frozen-lockfile
bun run mobile:template:check                 # before publishing a clean candidate
bun run mobile:template:check -- --published  # after the push
```

The default mode accepts a clean commit ahead of `origin/mobile`; `--published` requires `HEAD` to equal it. Both modes require a clean tree on `mobile` that contains the current `origin/master`, and exactly the payments, push, and social capabilities in state `available`. The check then runs `bun run check` on the synchronized project and the Maestro rule audit.

After setup, capability states become `included` or `removed`, and this template check no longer applies. Use the project's own recorded checks for releases.
