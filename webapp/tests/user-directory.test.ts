import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AdminUserSummary, AdminUsersResponse, UserDto } from '@web-app-demo/contracts'
import { afterEach, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../src/components/ui/table'
import { adminUsersQueryOptions } from '../src/features/admin/queries'
import { UserDirectory } from '../src/features/admin/UserDirectory'
import { AuthContext, type AuthContextValue } from '../src/features/auth/context'

// Tailwind's `sm` breakpoint: the toolbar and footer of the same card switch on `sm:` classes,
// so the rows must switch on the same edge or the card would be half table, half list.
const tableViewportQuery = '(min-width: 40rem)'
// Noon UTC keeps `formatDate` on the same calendar day in every zone within eleven hours of UTC.
const createdAt = '2026-03-05T12:00:00.000Z'

const admin: UserDto = {
  id: 'user_admin',
  email: 'admin@example.com',
  displayName: 'Ada Admin',
  role: 'admin',
  createdAt,
}
const users: AdminUserSummary[] = [
  admin,
  {
    id: 'user_2',
    email: 'a.rather.long.address@example.com',
    displayName: null,
    role: 'user',
    createdAt,
  },
]
const originalMatchMedia = globalThis.matchMedia

afterEach(() => {
  globalThis.matchMedia = originalMatchMedia
})

test('below the table breakpoint each user is a list item whose fields carry visible or screen-reader labels', () => {
  const html = renderDirectory({ fitsTable: false })

  expect(html).not.toContain('data-slot="table"')

  const items = listItems(html)
  expect(items).toHaveLength(users.length)
  users.forEach((user, index) => {
    const item = items[index] ?? ''

    // The row surface comes from the Item primitive's own variant, not from classes on the <li>.
    expect(item).toMatch(/^[^>]*data-slot="item"[^>]*data-variant="outline"/)
    expect(fieldLabels(item)).toEqual(['User', 'Role', 'Created'])
    expect(fieldValue(item, 'User')).toContain(user.email)
    expect(fieldValue(item, 'Role')).toContain(`aria-label="Role for ${user.email}"`)
    expect(fieldValue(item, 'Created')).toContain('Mar 5, 2026')
  })
  expect(fieldValue(items[0] ?? '', 'User')).toContain('Ada Admin')
})

test('from the table breakpoint up the directory is a real table built from unmodified primitives', () => {
  const html = renderDirectory({ fitsTable: true })

  expect(html).not.toContain('role="list"')
  expect(headerCells(html)).toEqual(['User', 'Role', 'Created'])
  for (const user of users) {
    expect(html).toContain(`aria-label="Role for ${user.email}"`)
  }

  const pristine = renderToStaticMarkup(
    createElement(
      Table,
      null,
      createElement(TableHeader, null, createElement(TableRow, null, createElement(TableHead))),
      createElement(TableBody, null, createElement(TableRow, null, createElement(TableCell))),
    ),
  )
  for (const slot of ['table', 'table-header', 'table-body', 'table-row', 'table-head', 'table-cell']) {
    const ownClasses = slotClasses(pristine, slot)[0]
    const rendered = slotClasses(html, slot)

    expect(rendered.length).toBeGreaterThan(0)
    for (const classes of rendered) expect(classes).toBe(ownClasses)
  }
})

// The directory renders host elements and picks its layout from `matchMedia` during the first
// render, so static markup is enough: the repository has no DOM library, and the seeded query
// cache puts the component in its ready state without a request.
function renderDirectory({ fitsTable }: { fitsTable: boolean }) {
  const queries: string[] = []
  globalThis.matchMedia = ((query: string) => {
    queries.push(query)
    return { matches: fitsTable } as MediaQueryList
  }) as typeof matchMedia

  const auth = { transport: {} } as unknown as AuthContextValue
  const queryClient = new QueryClient()
  const page: AdminUsersResponse = {
    items: users,
    page: 1,
    pageSize: 20,
    total: users.length,
    hasNext: false,
  }
  queryClient.setQueryData(
    adminUsersQueryOptions(auth.transport, { page: 1, pageSize: 20 }).queryKey,
    page,
  )

  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        AuthContext.Provider,
        { value: auth },
        createElement(UserDirectory, { currentUser: admin }),
      ),
    ),
  )

  expect(queries).toEqual([tableViewportQuery])
  return html
}

function listItems(html: string) {
  const list = html.match(/<ul[^>]*role="list"[^>]*>([\s\S]*)<\/ul>/)?.[1]
  if (!list) throw new Error('no role="list" element rendered')
  return list.split(/<li\b/).slice(1)
}

function fieldLabels(item: string) {
  return [...item.matchAll(/<dt[^>]*>([^<]*)<\/dt>/g)].map((match) => match[1])
}

function fieldValue(item: string, label: string) {
  const match = item.match(new RegExp(`<dt[^>]*>${label}</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`))
  if (!match) throw new Error(`no field labelled ${label} in ${item}`)
  return match[1] ?? ''
}

function headerCells(html: string) {
  return [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((match) => match[1])
}

function slotClasses(html: string, slot: string) {
  return [...html.matchAll(new RegExp(`<\\w+[^>]*data-slot="${slot}"[^>]*>`, 'g'))].map(
    (match) => match[0].match(/class="([^"]*)"/)?.[1] ?? '',
  )
}
