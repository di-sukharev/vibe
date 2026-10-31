# UI

[AGENTS.md](../AGENTS.md#ui) defines component boundaries. Use the existing components and design tokens before adding a new pattern.

## Theme tokens

Edit [theme.json](../theme.json), then generate the CSS:

```bash
bun run theme
bun run theme -- --check
```

The generator updates marked sections of application CSS and the website font import. Do not edit those sections manually. Use the configuration and [generator](../scripts/theme.mjs) for supported values and contrast rules.

Add the chosen font package to the application before you run the generator. The generator does not install dependencies.

## Components and layout

Product components own their visual styles. Their props describe data, state, and actions. Parents control placement through layout wrappers. Do not forward `className`, `style`, or unrestricted DOM props into product components.

Use theme tokens for colors, fonts, and radius. Use the Tailwind spacing scale.

Use the application's `ui` script to add or update generated primitives. See the [webapp component command](../webapp/README.md#components). The script runs a pinned shadcn CLI version through `bunx`, so component updates are reproducible and the CLI dependency tree stays out of the project. Each application CSS file contains the ejected `shadcn/tailwind.css`. Update that section only together with the pinned CLI version. Keep product compositions outside `src/components/ui`.

Both applications use the `base-vega` registry and Base UI. Use the `render` prop for component composition. Do not add Radix UI or Vaul wrappers. Import `cn` from the `cn` package. Keep application-specific variants and sizing in product compositions, so registry updates do not remove them. Each application keeps its configured icon library and theme.

Review registry updates before overwriting primitives. Preserve the calendar day-button focus ref; DayPicker needs it for keyboard navigation. The Hugeicons spinner must use the icon component's prop type because native SVG props also accept string stroke widths.

Webapp examples are `PageLayout`, `WorkspaceShell`, and the users and admin features. Use `Typography` for product text. Storybook shows primitives and shared compositions.

## States and accessibility

Show loading, empty, error, and success states. Preserve input after errors and offer a retry. Pending writes need progress and duplicate-submit protection.

Keep layouts usable at 375 px and 1280 px. Actions need keyboard access and visible focus. Inputs need labels and associated errors. Respect reduced motion. Do not invent sample metrics when data is unavailable.

## Visual check

For new screens, layout changes, or branding changes, capture the affected routes:

```bash
bun run screens:webapp -- -g '/admin/users'
bun run screens:website
```

`screens:webapp` starts the test stack and captures webapp pages in light and dark themes. Images are in `webapp/e2e/.artifacts/screens`. `screens:website` builds the website and captures its pages through production preview. Images are in `website/e2e/.artifacts/screens`. Tall pages also produce numbered tiles.

Inspect the captures and fix visible problems. The user performs the final visual check. Interactive browser control requires an explicit request.

Workspace routes come from `workspaceRoutesByRole`. Add guest routes to `webapp/e2e/screens/screens.spec.ts`. Add website routes to `website/e2e/screens/screens.spec.ts` when you add them to `website/src/routes.ts`. Create fixture records in the screenshot spec when a filled state matters.

Webapp screenshots share the checkout's E2E Docker project. Run them separately from E2E, or use a distinct `COMPOSE_PROJECT_NAME`.
