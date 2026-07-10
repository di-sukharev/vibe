import type { LoginRequest, RegisterRequest, UserDto } from '@web-app-demo/contracts'
import { createContext } from 'react'

export type AuthContextValue = {
  user: UserDto | null
  isBootstrapping: boolean
  isAuthenticated: boolean
  register: (input: RegisterRequest) => Promise<void>
  login: (input: LoginRequest) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
