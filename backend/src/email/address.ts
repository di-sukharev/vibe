/**
 * Sender-address validation, in a file with no imports at all.
 *
 * Deliberately a leaf. `env.ts` calls this, and `email/config.ts` reads `AppEnv` back from
 * `env.ts` - a type-only import today, so nothing cycles at runtime. Keeping the predicate out of
 * `config.ts` means that stays true even if `config.ts` ever needs a *value* from `env.ts`, which
 * is the edit that would turn the edge into a real initialisation cycle. Nothing in the toolchain
 * would catch that: `architecture-check.mjs` has no cycle detection, and the symptom would be a
 * TDZ crash at boot in every entrypoint.
 */

/**
 * Whether a value is a sender both providers will accept: `addr@domain`, or
 * `Display Name <addr@domain>`.
 *
 * A predicate rather than a parser, because the address is shipped verbatim as a JSON field and
 * nothing needs the pieces. Used by `env.ts` to refuse a malformed `EMAIL_FROM` at startup rather
 * than at the first send.
 *
 * Deliberately not a full RFC 5322 implementation: this validates one operator-supplied setting,
 * and a permissive pattern that accepted `Bob <a@b> <c@d>` would let a header-injection attempt
 * through. Neither part may contain a newline, a control character, a comma, or angle brackets.
 * Today both drivers ship the value as JSON, so nothing here is header-constructed and none of it
 * is exploitable; the rule exists because the next driver might be SMTP, or the next feature might
 * make `from` per-message, and this function is where that guarantee is expected to live.
 */
export function isUsableEmailAddress(value: string): boolean {
  const trimmed = value.trim()
  // Up front, because `\s` in the patterns below does not cover NUL and the other C0 characters,
  // and `trim` only removes them from the ends.
  if (hasControlCharacter(trimmed)) return false

  // The display name may not contain angle brackets either, or `Bob <a@x.com> <b@y.com>` would
  // parse as a name of "Bob <a@x.com>" addressed to the second mailbox.
  const displayNameMatch = /^([^<>]*?)\s*<([^<>]*)>$/.exec(trimmed)

  if (!displayNameMatch) return isBareAddress(trimmed)

  const [, rawDisplayName, address] = displayNameMatch
  if (!isBareAddress(address)) return false

  const displayName = rawDisplayName.replace(/^"(.*)"$/, '$1').trim()

  return displayName.length > 0 && !/["\\,]/.test(displayName)
}

function hasControlCharacter(value: string) {
  // eslint-disable-next-line no-control-regex -- refusing control characters is the point.
  return /[\u0000-\u001f\u007f]/.test(value)
}

function isBareAddress(value: string) {
  return /^[^\s<>,@]+@[^\s<>,@.]+(\.[^\s<>,@.]+)+$/.test(value)
}
