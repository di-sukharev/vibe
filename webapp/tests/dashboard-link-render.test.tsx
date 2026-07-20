import { expect, mock, test } from 'bun:test'
import {
  forwardRef,
  type AnchorHTMLAttributes,
  type MouseEvent,
} from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let capturedClick: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined

mock.module('@tanstack/react-router', () => ({
  Link: forwardRef<
    HTMLAnchorElement,
    AnchorHTMLAttributes<HTMLAnchorElement> & {
      activeOptions?: { exact?: boolean }
      to: string
    }
  >(function MockLink({
    activeOptions,
    onClick,
    to,
    ...props
  }, ref) {
    capturedClick = onClick
    return (
      <a
        {...props}
        data-exact={String(activeOptions?.exact)}
        data-to={to}
        ref={ref}
      />
    )
  }),
}))

test('sidebar slot props and click behavior reach the dashboard anchor', async () => {
  const { DashboardLink } = await import(
    '../src/components/dashboard/DashboardLink'
  )
  const {
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
  } = await import('../src/components/ui/sidebar')
  let injectedClicks = 0

  const markup = renderToStaticMarkup(
    <SidebarProvider>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            asChild
            isActive
            onClick={() => {
              injectedClicks += 1
            }}
          >
            <DashboardLink to="/app">Home</DashboardLink>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarProvider>,
  )

  expect(markup).toContain('data-sidebar="menu-button"')
  expect(markup).toContain('data-active="true"')
  expect(markup).toContain('data-exact="true"')
  expect(markup).toContain('data-to="/app"')
  expect(markup).toContain('focus-visible:ring-2')

  capturedClick?.({
    defaultPrevented: false,
  } as MouseEvent<HTMLAnchorElement>)
  expect(injectedClicks).toBe(1)
})
