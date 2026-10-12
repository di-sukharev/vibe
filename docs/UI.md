# UI

[AGENTS.md](../AGENTS.md#ui) defines component boundaries. Use the existing components and design tokens before adding a new pattern.

## Theme tokens

Edit [theme.json](../theme.json), then generate the CSS:

```bash
bun run theme
bun run theme -- --check
```

The generator updates marked sections of application CSS and the website font import. Do not edit those sections manually. Use the configuration and [generator](../scripts/theme.mjs) for supported values and contrast rules.

Fonts must already be installed or approved by the user. The generator does not install dependencies.

## Components and layout

Product components own their visual styles. Their props describe data, state, and actions. Parents control placement through layout wrappers. Do not forward `className`, `style`, or unrestricted DOM props into product components.

Use theme tokens for colors, fonts, and radius. Use the Tailwind spacing scale. Generate primitives with the application's pinned `ui:add` command and keep compositions outside `src/components/ui`.

Webapp examples are `PageLayout`, `WorkspaceShell`, and the users and admin features. Use `Typography` for product text. Storybook shows primitives and shared compositions.

## States and accessibility

Show loading, empty, error, and success states. Preserve input after errors and offer a retry. Pending writes need progress and duplicate-submit protection.

Keep layouts usable at 375 px and 1280 px. Actions need keyboard access and visible focus. Inputs need labels and associated errors. Respect reduced motion. Do not invent sample metrics when data is unavailable.

## Visual check

For new screens, layout changes, or branding changes, capture the affected routes:

```bash
bun run screens -- -g '/admin/users'
bun run screens -- -g website
```

The script starts the test stack and captures webapp and website pages. It uses the themes configured for each application. Images are in `webapp/e2e/.artifacts/screens`. Tall pages also produce numbered tiles.

Inspect the captures and fix visible problems. The user performs the final visual check. Interactive browser control requires an explicit request.

Workspace routes come from `workspaceRoutesByRole`. Add guest routes to `webapp/e2e/screens/screens.spec.ts`. Website pages come from `website/src/pages`. Create fixture records in the screenshot spec when a filled state matters.

Screenshots share the checkout's E2E Docker project. Run them separately from E2E, or use a distinct `COMPOSE_PROJECT_NAME`.
