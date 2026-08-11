import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { DataTableFrame } from '../src/components/dashboard/DataTableFrame'
import { SectionCards } from '../src/components/dashboard/SectionCards'
import { SiteHeader } from '../src/components/dashboard/SiteHeader'
import { SidebarProvider } from '../src/components/ui/sidebar'

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
  expect(tableMarkup).toContain('<h2')
  expect(tableMarkup).toContain('>User directory</h2>')
})
