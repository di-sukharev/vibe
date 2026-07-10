export type AuthMode = 'login' | 'register'
export type FieldName = 'displayName' | 'email' | 'password'
export type FormError = { message?: string }
export type FieldErrors = Partial<Record<FieldName, FormError[]>>
export type AuthDraft = {
  email: string
  password: string
  displayName: string
}

export const emptyDraft: AuthDraft = {
  email: '',
  password: '',
  displayName: '',
}
