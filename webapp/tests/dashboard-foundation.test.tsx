import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'

import { DataTableFrame } from '../src/components/dashboard/DataTableFrame'
import { SectionCards } from '../src/components/dashboard/SectionCards'
import { SiteHeader } from '../src/components/dashboard/SiteHeader'
import { SidebarProvider } from '../src/components/ui/sidebar'

test('dashboard route links share exact matching and mobile-sheet closure', () => {
  const dashboardLink = readFileSync(
    new URL('../src/components/dashboard/DashboardLink.tsx', import.meta.url),
    'utf8',
  )
  const consumers = ['AppSidebar.tsx', 'NavMain.tsx', 'NavUser.tsx']
    .map((file) =>
      readFileSync(
        new URL(`../src/components/dashboard/${file}`, import.meta.url),
        'utf8',
      )
    )

  expect(dashboardLink).toContain('activeOptions={{ exact: true }}')
  expect(dashboardLink).toContain('setOpenMobile(false)')
  for (const consumer of consumers) {
    expect(consumer).toContain('<DashboardLink')
    expect(consumer).not.toContain("from '@tanstack/react-router'")
  }
})

test('metric values keep visual emphasis without becoming document headings', () => {
  const markup = renderToStaticMarkup(
    <SectionCards
      items={[
        {
          label: 'Total users',
          value: 1_234,
          description: 'All registered accounts',
        },
      ]}
    />,
  )

  expect(markup).toContain('Total users')
  expect(markup).toContain('>1234</div>')
  expect(markup).not.toContain('<h3')
})

test('dashboard chrome leaves the document heading to its page content', () => {
  const headerMarkup = renderToStaticMarkup(
    <SidebarProvider>
      <SiteHeader title="Users" />
    </SidebarProvider>,
  )
  const tableMarkup = renderToStaticMarkup(
    <DataTableFrame
      nextDisabled
      onNext={() => undefined}
      onPrevious={() => undefined}
      previousDisabled
      summary="Page 1 of 1"
      title="User directory"
    >
      <div />
    </DataTableFrame>,
  )

  expect(headerMarkup).toContain('>Users</span>')
  expect(headerMarkup).not.toContain('<h1')
  expect(headerMarkup).toContain('h-16')
  expect(headerMarkup).toContain('motion-reduce:transition-none')
  expect(tableMarkup).toContain('<h2')
  expect(tableMarkup).toContain('>User directory</h2>')
})

test('the app globally suppresses generated primitive motion when reduced motion is requested', () => {
  const stylesheet = readFileSync(
    new URL('../src/index.css', import.meta.url),
    'utf8',
  )

  expect(stylesheet).toContain('@media (prefers-reduced-motion: reduce)')
  expect(stylesheet).toContain('animation-duration: 0.01ms !important')
  expect(stylesheet).toContain('transition-duration: 0.01ms !important')
})
