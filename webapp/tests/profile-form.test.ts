import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { updateProfileRequestSchema, type UserDto } from '@web-app-demo/contracts'
import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { AuthContext, type AuthContextValue } from '../src/features/auth/context'
import { validateProfileForm } from '../src/features/users/profile-form'
import { ProfilePanel } from '../src/features/users/ProfilePanel'

const tooShortName = 'A'
const tooLongName = 'x'.repeat(81)

test('a one-character name is rejected with the message the contract produces', () => {
  const validation = validateProfileForm(tooShortName)

  expect(validation.request).toBeNull()
  expect(validation.errors?.fieldErrors.displayName).toEqual([
    { message: contractMessage(tooShortName) },
  ])
  expect(validation.errors?.formError).toBeNull()
})

test('an 81-character name is rejected with the message the contract produces', () => {
  const validation = validateProfileForm(tooLongName)

  expect(validation.request).toBeNull()
  expect(validation.errors?.fieldErrors.displayName).toEqual([
    { message: contractMessage(tooLongName) },
  ])
  expect(validation.errors?.formError).toBeNull()
})

test('names inside the contract bounds are trimmed and accepted', () => {
  expect(validateProfileForm('  Jane Doe  ')).toEqual({
    request: { displayName: 'Jane Doe' },
    errors: null,
  })
  expect(validateProfileForm('ab')).toEqual({ request: { displayName: 'ab' }, errors: null })
  expect(validateProfileForm('y'.repeat(80))).toEqual({
    request: { displayName: 'y'.repeat(80) },
    errors: null,
  })
})

test('an empty or whitespace-only name clears the display name instead of failing', () => {
  expect(validateProfileForm('')).toEqual({ request: { displayName: null }, errors: null })
  expect(validateProfileForm('   ')).toEqual({ request: { displayName: null }, errors: null })
})

test('the panel shows the contract error on the field and blocks saving', () => {
  for (const displayName of [tooShortName, tooLongName]) {
    const html = renderProfilePanel(displayName)

    expect(fieldErrorText(html)).toBe(contractMessage(displayName))
    expect(html).toContain('aria-invalid="true"')
    expect(saveButtonDisabled(html)).toBe(true)
  }
})

test('the panel shows no error and allows saving for a valid or cleared name', () => {
  for (const displayName of ['Jane Doe', null]) {
    const html = renderProfilePanel(displayName)

    expect(fieldErrorText(html)).toBeNull()
    expect(html).not.toContain('aria-invalid="true"')
    expect(saveButtonDisabled(html)).toBe(false)
  }
})

function contractMessage(displayName: string) {
  const result = updateProfileRequestSchema.safeParse({ displayName })
  if (result.success) throw new Error(`fixture ${JSON.stringify(displayName)} must fail validation`)
  const issue = result.error.issues.find((candidate) => candidate.path[0] === 'displayName')
  if (!issue) throw new Error('fixture has no issue on displayName')
  return issue.message
}

// The panel renders host elements, so it is checked as static markup: the repository has no DOM
// library, and the error state is derived from the initial value without any interaction. The
// auth context only lends its transport to the save mutation, which a static render never runs.
function renderProfilePanel(displayName: string | null) {
  const user: UserDto = {
    id: 'user_1',
    email: 'user@example.com',
    displayName,
    role: 'user',
    createdAt: '2026-05-11T00:00:00.000Z',
  }
  const auth = { transport: {} } as unknown as AuthContextValue

  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(AuthContext.Provider, { value: auth }, createElement(ProfilePanel, { user })),
    ),
  )
}

function fieldErrorText(html: string) {
  const match = html.match(/<div role="alert" data-slot="field-error"[^>]*>([^<]*)<\/div>/)
  return match ? decodeEntities(match[1] ?? '') : null
}

function saveButtonDisabled(html: string) {
  const match = html.match(/<button[^>]*type="submit"[^>]*>/)
  if (!match) throw new Error('the panel rendered no submit button')
  return /\sdisabled=""/.test(match[0])
}

function decodeEntities(text: string) {
  return text
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'")
    .replaceAll('&amp;', '&')
}
