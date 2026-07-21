import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

test('dashboard links keep exact route matching and close the mobile sidebar', () => {
  const source = readFileSync(
    new URL('../src/components/dashboard/DashboardLink.tsx', import.meta.url),
    'utf8',
  )

  expect(source).toContain('activeOptions={{ exact: true }}')
  expect(source).toContain('if (!event.defaultPrevented) setOpenMobile(false)')
  expect(source).toContain("'className' | 'href' | 'style'")
})
