---
name: ui-review
description: Runs the screenshot tour, reviews the images against the UI guide, fixes issues in the source, and re-checks. Use after a new screen or a layout change, or when the user asks to review, polish, or restyle the UI.
---

## Steps

1. Run `bun run screens -- -g "<route or website>"`. [UI](../../../docs/UI.md#visual-check) says where the images land; [TESTING](../../../docs/TESTING.md) says how the demo data is seeded.
2. Review every image against [UI](../../../docs/UI.md):
   - 375 px and 1280 px widths, light and dark themes;
   - every data state (loading, empty, error, success), and visible keyboard focus;
   - design tokens only, with consistent spacing and typography;
   - no overflow or clipping, and only real API data.
3. Fix issues in the source. Compose from `src/components/ui` and existing compositions; never restyle shadcn. No raw colors or arbitrary values — tokens and the Tailwind spacing scale only.
4. Re-run the screens. Stop after two rounds and report what remains.
5. Theme change: when the user wants a different look, edit `theme.json` as [UI](../../../docs/UI.md#theme-tokens) describes, run `bun run theme`, then re-run the screens. Say how `theme.json` relates to the visual-style answer in [CHECKLIST](../../../CHECKLIST.md).
6. Do not drive a browser interactively unless the user asks.
