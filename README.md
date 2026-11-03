# Vibe Coding Template

```mermaid
flowchart LR
  Website[Website: React Router SSG] --> Webapp[Webapp: React Router CSR]
  Webapp --> API[Backend: Bun and Hono]
  Mobile[Mobile: Expo] --> API
  API --> Database[(PostgreSQL)]
  Jobs[Scheduler or one-shot jobs] --> Database
  API --> Storage[Private S3 storage]
  Jobs --> Storage
  Jobs --> Email[Email provider]
  Contracts[Shared Zod contracts] -.-> Webapp
  Contracts -.-> API
  Contracts -.-> Mobile
```

A web and mobile product template for work with coding agents. Expo serves iOS, Android, and web.

<!-- BOOTSTRAP_ONLY_START -->
## Prompt to copy to your agent

```text
Set up https://github.com/di-sukharev/vibe as the base for a new project.
Before cloning, ask whether mobile is needed. Use mobile for yes and master for no.
Read AGENTS.md and follow "Agent setup instructions" in README.md.
Communicate in my language.
```

## Agent setup instructions

Use this section only when creating a new project. Keep it and `CHECKLIST.md` when maintaining the template.

1. Ask whether mobile is needed before cloning. Select `master` or `mobile`. For mobile, clone the full history and fetch both branches. Run `git merge-base --is-ancestor origin/master origin/mobile`. If it fails, stop. The template owner must merge `master` into `mobile` first.
2. Use [CHECKLIST.md](CHECKLIST.md) to collect product and setup choices in the user's language. Ask only applicable questions. Choose technical details yourself.
3. Remove the template remote with `git remote remove origin`. Add a new remote only from the user's repository address or request to publish. Never publish a product to the template repository. Remove the `mobile:template:check` script, `scripts/check-mobile-template.mjs`, and the instructions that use them. They check the template's own branches and need the template remote. Remove notes about the template's `master` and `mobile` branches, for example in `backend/Dockerfile` and `backend/README.md`.
4. Install with the Bun version in `package.json`. Remove the applications that the product does not need. Also remove their workspace entries, root scripts, `theme.json` keys, README and AGENTS.md table rows, documentation, ignore entries, and other references. Configure the remaining applications from their `.env.example` files. Generate `JWT_SECRET` locally. Keep secrets out of Git and tool output.
5. Set branding in `theme.json` and run `bun run theme`. Rename the template identifiers in packages, databases, cookies, Docker configuration, and page metadata. Search for `web_app_demo`, `web-app-demo`, `webappdemo`, `vibecoding-template`, and `Vibe Coding Template`. Do not change `LICENSE` or `NOTICE`. Regenerate `bun.lock` after package changes.
6. Replace the template's own content with the product's content. Replace `webapp/public/favicon.svg`, `website/public/favicon.svg`, and `website/public/favicon.ico` with the product's icons. In `website`, replace the landing page copy, brand mark, footer credits, page titles and descriptions, and links to the template repository. Update the website tests and screenshot tour that the new content affects.
7. For mobile, select the user's Expo account and initialize EAS only when builds are needed. For a web-only project, delete the `mobile` directory. Remove mobile, Expo, EAS, and Maestro mentions from the documentation, agent instructions, `.gitignore`, and `.dockerignore`. Remove the Expo development origins on ports 8081 and 19006 from `backend/src/env.ts` and `backend/.env.example`. Keep responsive layout code that uses the word mobile.
8. If deployment is requested, choose hosting from audience, data location, and operating needs. Use the independent static builds and backend image described in [Deployment](docs/DEPLOYMENT.md). Configure the chosen host in the new project.
9. Install Google Chrome with `bun run e2e:install`. Run the relevant checks and verify local startup. Keep required operating details in the project README and configuration. Delete `CHECKLIST.md` and this entire block, including its markers. Report local URLs, check results, and any remaining user actions.
<!-- BOOTSTRAP_ONLY_END -->

## Applications

| Path | Purpose | Guide |
| --- | --- | --- |
| `backend` | API, PostgreSQL, authentication, jobs, email, and files | [Backend](backend/README.md) |
| `webapp` | React Router CSR for signed-in users | [Webapp](webapp/README.md) |
| `website` | React Router SSG for public pages and SEO | [Website](website/README.md) |
| `packages/contracts` | Shared API schemas and types | [Contracts](packages/contracts/README.md) |
| `mobile` | Expo application | [Mobile](mobile/README.md) |

## Quick start

Use the Bun version in [package.json](package.json). Run commands from the repository root.

```bash
bun install --frozen-lockfile
bun run dev:webapp
bun run dev:website
bun run dev:mobile
```

Bun uses hoisted dependencies to keep native modules in one installation. When switching from master, remove root and workspace `node_modules`, then install again. Keep `bun.lock`.

Run each application in its own terminal. Authentication and data need the [backend and local PostgreSQL](backend/README.md#local-development). The website can run alone.

The backend permits only origins in `CORS_ORIGINS`. `localhost` and `127.0.0.1` are different origins. If refresh fails with a CORS error, check the webapp origin and restart the backend.

## Checks and operations

Package scripts define the available commands. [AGENTS.md](AGENTS.md) defines architecture and working rules. [CLAUDE.md](CLAUDE.md) imports those rules for Claude.

Run focused checks during development. `bun run check` runs the full local checks and needs Docker and package registry access. Before the first run, install Google Chrome with `bun run e2e:install`.

[Testing](docs/TESTING.md) explains database tests and E2E. [UI](docs/UI.md) explains theme generation and screenshots. [Deployment](docs/DEPLOYMENT.md) covers production setup and recovery.

## License

Apache License 2.0. Keep [LICENSE](LICENSE) and [NOTICE](NOTICE) when distributing this template or a derived project. Preserve the attribution to Dima Sukharev, his GitHub account, and the source repository.
