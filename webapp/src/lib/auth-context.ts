import { createContext } from 'react'
import type { LoginRequest, RegisterRequest, UserDto } from '@web-app-demo/contracts'

export type AuthContextValue = {
  user: UserDto | null
  isBootstrapping: boolean
  isAuthenticated: boolean
  register: (input: RegisterRequest) => Promise<void>
  login: (input: LoginRequest) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)
