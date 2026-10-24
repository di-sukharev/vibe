import { index, route, type RouteConfig } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'),
  route('login', 'routes/login.tsx'),
  route('signup', 'routes/signup.tsx'),
  route('forgot-password', 'routes/forgot-password.tsx'),
  route('reset-password', 'routes/reset-password.tsx'),
  route('app', 'routes/user-layout.tsx', [
    index('routes/user-home.tsx'),
    route('profile', 'routes/user-profile.tsx'),
    route('settings', 'routes/user-settings.tsx'),
  ]),
  route('admin', 'routes/admin-layout.tsx', [
    index('routes/admin-dashboard.tsx'),
    route('users', 'routes/admin-users.tsx'),
    route('settings', 'routes/admin-settings.tsx'),
  ]),
  route('*', 'routes/not-found.tsx'),
] satisfies RouteConfig
