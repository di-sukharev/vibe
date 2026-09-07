import type {
  LoginRequest,
  PasswordResetConfirmRequest,
  PasswordResetRequest,
  RegisterRequest,
  UserDto,
} from '@web-app-demo/contracts'
import { createContext } from 'react'
import type { AuthenticatedTransport } from '@/platform/api'

export type AuthContextValue = {
  user: UserDto | null
  /**
   * True while the session is still unknown: the cookie refresh has not answered yet, or it
   * restored an access token whose `/api/auth/me` load is still pending. Guards render the
   * loading state while this is set; `user === null` means signed out only once it is false.
   */
  isBootstrapping: boolean
  isAuthenticated: boolean
  sessionError: Error | null
  retrySession: () => Promise<void>
  transport: AuthenticatedTransport
  register: (input: RegisterRequest) => Promise<void>
  login: (input: LoginRequest) => Promise<void>
  logout: () => Promise<void>
  requestPasswordReset: (input: PasswordResetRequest) => Promise<void>
  confirmPasswordReset: (input: PasswordResetConfirmRequest) => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
