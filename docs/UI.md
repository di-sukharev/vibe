# UI guide

How to build elegant, consistent UI fast in `webapp` and `website`. [AGENTS.md](../AGENTS.md#ui) has the rules; this guide has the patterns.

## Principles

- Brand first. The visual-style answer in [CHECKLIST.md](../CHECKLIST.md) sets `theme.json`, which `bun run theme` turns into the theme tokens (color, radius, font) in `webapp/src/index.css` and `website/src/styles/global.css`. Change tokens, not components, to restyle the product.
- Restraint. One primary action per view. Content first. No decorative gradients, shadows, emojis, or icons without a job.
- Hierarchy comes from the type scale and spacing, not from extra color, borders, or nested cards.
- Rhythm. Use the spacing scale: `gap-2` inside controls, `gap-4`–`gap-6` between blocks, `gap-8` between sections.
- Alignment. One content column per page; shared left edges; consistent widths.
- Same problem, same pattern. Reuse the references below before you compose something new.
- Real data only. Metrics, charts, and tables show API data that the contracts validate. No sample numbers or placeholder charts; show the empty state instead.
- Motion is subtle and short (under 200 ms). Never hide information behind motion. Respect reduced motion.
- Copy is short and specific. Sentence case. Buttons are verbs ("Save profile"). An error says what happened and what to do next.

## Theme tokens

`theme.json` at the repository root holds the structured visual-style answer, per app: `brand` (a `#rrggbb` hex color, or `null` for the template's neutral theme), `radius` (rem), and `font` (`family`, the CSS value to use before the generic fallback, and `package`, the `@fontsource` package that provides it — already installed, or approved by the user naming it in CHECKLIST.md; `scripts/theme.mjs` never installs it itself). Write the CHECKLIST answer into `theme.json`, then run `bun run theme`. `bun run theme -- --check` verifies the committed CSS matches `theme.json` without writing anything.

`scripts/theme.mjs` writes only between `THEME_TOKENS_START/END`, `THEME_FONT_START/END`, and `THEME_FONT_IMPORT_START/END` marker comments inside `webapp/src/index.css`, `website/src/styles/global.css`, and the font import in `website/src/layouts/BaseLayout.astro`. Everything else in those files (the `@theme inline` mapping, `@layer` rules, website's glow primitives) is untouched. Do not hand-edit inside the markers; edit `theme.json` and regenerate.

The brand color drives `primary`/`primary-foreground`, `ring`, `sidebar-primary`/`sidebar-primary-foreground`, `sidebar-ring`, `chart-1..5`, and (website) `brand`/`brand-foreground`. Every other token — backgrounds, surfaces, borders, and `destructive` — stays neutral regardless of brand. The generator keeps the brand's OKLCH hue and chroma and searches only its lightness, separately for each app's light and dark theme, until the WCAG 2 contrast is at least 4.5:1 for `primary` on `primary-foreground` and at least 3:1 for `ring` and `primary` against `background`; a color that already clears both is left alone.

## Webapp building blocks

| Need | Use | Reference |
| --- | --- | --- |
| Page frame | `PageContainer`, `PageHeader` (title, description, actions) | `src/components/PageLayout.tsx` |
| Shell, sidebar, account menu | `WorkspaceShell`; pages render only content | `src/components/WorkspaceShell.tsx` |
| Section | `Card` + `CardHeader` + `CardContent` | `src/features/users/ProfilePanel.tsx` |
| Form | `Field`, `FieldLabel`, `FieldDescription`, `FieldError`; shared Zod validation; pending state | `src/features/users/ProfilePanel.tsx` |
| List or table | `DataTableFrame`; table on desktop, list on phones; `Skeleton` and `Empty` states | `src/features/admin/UserDirectory.tsx` |
| Metrics | `SectionCards` | `src/features/admin/AdminMetrics.tsx` |
| Confirmation | `AlertDialog` | `src/features/admin/RoleChangeDialog.tsx` |
| Text | `Typography` variants; ESLint rejects raw text styling | `src/components/typography.tsx` |
| Icons | Hugeicons | `components.json` |

Add a shadcn component with `bun run --cwd webapp ui:add -- <component>`. Never edit `src/components/ui` for product styling; wrap it outside. Browse primitives and patterns with `bun run storybook:webapp`.

Product components declare their props explicitly: data, states, and callbacks. Only low-level UI and layout primitives accept limited style props. When a component forwards DOM props, narrow them with a local `Pick` or `Omit`, as `DashboardLink` does.

## States

- Loading: `Skeleton` in the shape of the content. Use a spinner only for short actions.
- Empty: `Empty` with one sentence and the next action.
- Error: an inline `Alert` with the reason and a retry. Keep the user's input.
- Mutation: disable the control and show progress while pending; confirm the result inline.
- Destructive action: confirm with `AlertDialog`; name the object and the consequence.

## Responsive, themes, accessibility

- Design for 375 px first, then 1280 px. No horizontal scroll. Tables become lists on phones.
- Use theme tokens from `src/index.css` so both themes work without extra code.
- Every action works from the keyboard with a visible focus ring. Inputs have labels. Errors are linked with `aria-describedby` and `aria-invalid`.
- Text contrast meets WCAG AA in both themes.

## Visual check

`bun run screens` starts the E2E stack (Docker test database, backend, Vite) and the Astro dev server. It signs in as the seeded user and admin and captures the webapp guest and workspace routes at 375 and 1280 px in light and dark themes, and every static website page at both widths in its dark theme. Filter with `-g`:

```bash
bun run screens -- -g "/admin/users"
bun run screens -- -g website
```

Images land in `webapp/e2e/.artifacts/screens/<page>--<mobile|desktop>-<light|dark>.png`. A tall page also gets `-partN` tiles, two screens high, for legible detail. Look at the full image for composition, then at the tiles you need. Review the pages you changed, fix what you see, and repeat at most twice.

- New workspace routes join the tour through `workspaceRoutesByRole` in `src/features/navigation/model.ts`; new website pages join from `website/src/pages`. Add webapp guest routes in `e2e/screens/screens.spec.ts`.
- The tour seeds fixture users ([TESTING](TESTING.md)); other lists, such as a new feature's, start empty. To review a filled state, create the records in the spec before the capture.
- The tour asserts nothing about the UI. It fails only when a page cannot open.
- The tour emulates reduced motion, so the website hero shows its CSS fallback, not the 3D scene.
- Runs share the checkout's E2E Docker project. Do not run it at the same time as `bun run e2e:webapp`, or set a distinct `COMPOSE_PROJECT_NAME`.

## Website

- The site is dark only and uses the tokens in `website/src/styles/global.css`.
- Compose pages from Astro sections in `src/components/landing` and shadcn React components rendered to static HTML.
- Keep SEO text in the initial HTML. The 3D hero is decorative; it loads lazily and only on wide screens without reduced motion.
- Browse primitives with `bun run storybook:website`.
