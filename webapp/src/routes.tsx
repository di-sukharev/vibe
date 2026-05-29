import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'

import { AppPage, HomePage, RootLayout } from './pages'

const rootRoute = createRootRoute({
  component: RootLayout,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
})

const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  component: AppPage,
})

const routeTree = rootRoute.addChildren([indexRoute, appRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
