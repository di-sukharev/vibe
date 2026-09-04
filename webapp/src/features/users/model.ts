/**
 * UX shortcut ahead of a submit: catches the one-character case inline so the field can show
 * `aria-invalid` and a hint before the user even tries to save. The authoritative rule
 * (`.min(2)`) lives in `updateProfileRequestSchema` in `packages/contracts` and is enforced
 * there regardless of what this returns.
 */
export function isDisplayNameTooShort(displayName: string): boolean {
  return displayName.trim().length === 1
}
