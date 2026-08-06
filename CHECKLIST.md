# Install Checklist

This file is the intake record for this repository. The installing agent fills it in during first-run setup and keeps it current afterwards.

**For the agent:** ask the questions below in the user's language, in product terms, and write the answers into this file as you go. Do not start feature work until everything through *First-version capabilities* is answered. Never ask the user anything under *Decided by the agent* - make those calls yourself and explain them in product terms.

**For the product owner:** this is the record of what was decided about your project. If something here is wrong, say so - the agent treats this file as the source of truth for what your product needs.

Answer cells hold `_unanswered_` until the question is asked, and `n/a` when the question cannot apply to this project. Answers are written in the product owner's language, but the section headings and the capability-ledger state words stay in English: other documents and `scripts/repo-env.test.mjs` refer to them by those exact names. Keep every section heading, even when its rows are all `n/a`.

**When working on the template itself** (not installing it for a project), there is nothing to record: leave every answer cell at `_unanswered_` and every checkbox unchecked - those would otherwise ship to each future install. The capability ledger is the exception: it always describes the current branch, so keep it current when template work adds or removes a capability.

**Install status:** `not started`
<!-- Set to: not started | in progress | completed YYYY-MM-DD -->

---

## 1. Project identity

| Question | Answer |
| --- | --- |
| New project from this template, or work on the template itself? | _unanswered_ |
| Project name / slug | _unanswered_ |
| Your own GitHub repository URL, if you have one | _unanswered_ |

If no GitHub destination is chosen, the repository is left without `origin` and publishing stays unconfigured. The template remote is detached during setup unless this checkout is explicitly for improving the template.

## 2. Product

| Question | Answer |
| --- | --- |
| What product do you want to build first? | _unanswered_ |
| What is the first user journey that must work end to end? | _unanswered_ |

## 3. Active surfaces

Mark what is active now, and set the install status to `in progress` as soon as this section is answered. From then on, everything unmarked is deferred and must be left alone: no features, no setup, no test flows. While the status is still `not started` nothing has been decided yet, so unmarked boxes mean "not asked", not "forbidden".

- [ ] `backend` - API, database, auth
- [ ] `webapp` - browser screens behind sign-in (no SEO)
- [ ] `website` - public pages that must rank in search or preview when shared
- [ ] `mobile` - Expo app (lives on the `mobile` branch; switch branches before setup)

| Question | Answer |
| --- | --- |
| Why the unmarked surfaces are deferred, if it needs explaining | _unanswered_ |
| If `mobile` is active: are Expo/EAS builds, Expo Push, and Maestro E2E needed now, or left unconfigured until later? | _unanswered_ |

The split between `webapp` and `website` is the agent's call, not the user's; `README.md` explains how to route a feature between them.

## 4. First-version capabilities

Ask about product needs, not implementations. Mark what the first version actually needs, then fill the row below even when nothing was ticked, so a later session can tell "asked, and the answer was no" from "not asked yet".

- [ ] Accounts / sign-in
- [ ] Saved data that survives a restart
- [ ] File, image, or media uploads → also answer *Files, images, and media*
- [ ] Paid subscriptions or one-off payments → also answer *Payments*
- [ ] Admin tools or roles
- [ ] External integrations (which: _unanswered_)
- [ ] Real-time chat, presence, collaboration, or live updates

| Question | Answer |
| --- | --- |
| What the first version explicitly should NOT do (write "nothing ruled out" if that is the answer) | _unanswered_ |

## 5. Files, images, and media

Answer these only when uploads are active above; otherwise mark the rows `n/a`. Keep the section either way - `docs/STORAGE.md` sends the agent here when uploads are added later.

| Question | Answer |
| --- | --- |
| What do users upload? | _unanswered_ |
| Public, private, shared with selected people, or mixed? | _unanswered_ |
| Who can upload, view, replace, and delete? | _unanswered_ |
| Maximum file size and allowed file types | _unanswered_ |
| Do images need thumbnails, resizing, format conversion, compression, cropping, or moderation? | _unanswered_ |
| How long do files live after the owning record is deleted? | _unanswered_ |
| Should filenames be visible to users, or opaque? | _unanswered_ |

## 6. Payments

Answer these only when payments are active above; otherwise mark the rows `n/a`. Keep the section either way, and replace the `n/a` answers if payments are added later.

| Question | Answer |
| --- | --- |
| What exactly do users pay for? | _unanswered_ |
| Recurring subscription, one-off purchase, or both? | _unanswered_ |
| What stops working when someone does not pay? | _unanswered_ |

Whatever this project ends up with, the ledger below is what states it. Browser payments (Stripe and similar) are built as a new module against the answers above and recorded there once they exist. On the mobile template line, where App Store and Google Play subscriptions ship as working code, declining payments means deleting that code during setup and recording it as `removed`. Payments are never half-present, and are never reintroduced on a guess.

## 7. Deployment

| Question | Answer |
| --- | --- |
| Is deployment needed now, or local-only for the moment? | _unanswered_ |
| Production domains / URLs, per surface (API, webapp, website, media/CDN) | _unanswered_ |
| Which surfaces are released first | _unanswered_ |

DigitalOcean is the default and the agent does not ask the user to compare cloud providers. Yandex Cloud is used only on explicit request. Local development never requires cloud credentials.

Deployment is often deferred at install time, which leaves these rows `_unanswered_`. When the user later asks to deploy, ask the unanswered questions then and write the answers back here before following `docs/DEPLOYMENT.md`.

## 8. Decided by the agent - do not ask the user

The user is a product owner, not an engineer. These are engineering decisions the agent owns, makes, and explains only in product terms:

- Which browser surface a feature belongs to (`website` for SEO/public, `webapp` for behind-login).
- Monolithic backend; no microservices during setup.
- Docker Compose for local PostgreSQL on every OS; never a native install unless the user insists.
- Astro for `website`; Next.js only if Vercel-style ISR is a stated product requirement.
- DigitalOcean App Platform defaults, machine sizes, and static-site vs service choices.
- Managed Redis-compatible Pub/Sub only when real-time needs to scale across instances.
- Test boundaries: E2E for important user journeys, integration for API/auth/persistence, unit for pure rules.
- Libraries, file layout, naming, refactors, and validation scope.

## 9. Capability ledger

What this project actually contains. The agent updates it whenever a capability is added or removed. Every row carries exactly one state:

- `included` - present and expected to work.
- `available` - partly there but not usable yet; the note says exactly what is still missing, which may be configuration, routes, or UI.
- `absent` - not part of this project. Build it only after the product owner asks.
- `removed` - deliberately deleted during setup. **Do not re-add it.** A leftover reference, migration, or doc mention is not a product requirement; ask the product owner first.

A capability with no row is `absent` by default. Add the row instead of assuming. The State column always holds one of the four states above - never `_unanswered_` or `n/a`.

| Capability | State | Note |
| --- | --- | --- |
| Auth (email + password) | included | Template baseline. |
| Admin roles | included | Roles and seeding in `backend`; admin UI in `webapp`. |
| Password reset email delivery | available | The flow is built, but no adapter is passed to `createApp` in `backend/src/index.ts`, so the disabled one is used and no email is ever sent. |
| File/media storage | available | Service layer only. Needs DigitalOcean Spaces env, plus routes, contracts, and UI before users can upload anything. |
| Payments / subscriptions | absent | No payment code here. Store subscriptions come from the mobile template line. |
| Push notifications | absent | No push code here. Expo Push comes from the mobile template line. |
| Social sign-in (Apple / Google) | absent | No social auth here. It comes from the mobile template line. |
| Real-time / WebSockets | absent | Requires an explicit product need. |
| Scheduled background jobs | available | `backend/src/cron.ts` runs `auth:sessions:cleanup` when invoked, but nothing schedules it: export `DO_BACKEND_CRON_*` before `bun run deploy:do:specs`, or add a trigger per `docs/YANDEX_CLOUD.md`. Until then stale sessions and expired reset tokens are never deleted. |

## 10. Environment checks

Verified by the agent during setup, not asked.

- [ ] `docker compose version` and `docker info` succeed (needed for backend/API, uploads, or DB-backed validation)
- [ ] `git remote -v` inspected; template remote detached unless contributing to the template
- [ ] App-local `.env` files created from `.env.example`, with a locally generated `JWT_SECRET` (never committed)
- [ ] Smallest meaningful validation run for the active surfaces

## 11. After setup

- [ ] Durable answers above filled in, install status set to `completed YYYY-MM-DD`
- [ ] Validation scope recorded for this project (which suites run before a change is called done): _unanswered_
- [ ] Project renamed from the template identifiers (`web_app_demo`, `web-app-demo`, `vibecoding-template`), `bun.lock` regenerated
- [ ] Deferred-surface notes added to the READMEs of surfaces that are not active
- [ ] `Bootstrap-Only Instructions` blocks deleted from `AGENTS.md` and `CLAUDE.md`
- [ ] Local URLs, commands run, and anything the user must authorize manually reported back to the user

`README.md`, `AGENTS.md`, `CLAUDE.md`, and some `docs/` runbooks route agents into this file, and `scripts/repo-env.test.mjs` fails if a cited section heading or a ledger state name disappears. Add rows and sections a project needs, and cross-reference sections by name rather than by number so renumbering stays harmless.
