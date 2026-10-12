# Mobile template

The Expo application lives on the `mobile` branch. It includes development builds, Maestro tests, push notifications, and social sign-in. Store subscriptions are disabled by configuration until setup.

## Select the branch

Before creating a mobile project:

```bash
git fetch origin
git merge-base --is-ancestor origin/master origin/mobile
git switch mobile
bun install --frozen-lockfile
```

Stop if the ancestry check fails. The template owner must merge `master` into `mobile` first. Follow the README on that branch for Expo and optional feature setup.

Mobile uses isolated Bun dependencies. Before switching between this branch and `master`, remove root and workspace `node_modules` directories. Keep `bun.lock` and install again. This prevents dependencies from the previous branch from surviving the switch.

## Template maintenance

Keep shared application, backend, contract, and infrastructure changes on `master`. Keep mobile-specific changes on `mobile`.

Merge `master` into `mobile` before publishing the mobile template. Run these checks on a clean mobile commit:

```bash
bun run mobile:template:check
bun run mobile:template:check -- --published
```

Both modes require `origin/master` to be an ancestor of HEAD. The second also requires HEAD to equal `origin/mobile`. The command runs the full local checks and the Maestro audit.

This publication command applies only to the template. A new product uses its own release process.

## Payments

Mobile payments use native UI and backend verification. Check the current rules for the product, storefront, and region before changing purchase behavior.

References: [Apple payments](https://developer.apple.com/app-store/review/guidelines/#business), [Google Play payments](https://support.google.com/googleplay/android-developer/answer/10281818).
