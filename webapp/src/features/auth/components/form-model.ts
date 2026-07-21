export type FieldName = 'confirmPassword' | 'displayName' | 'email' | 'password'
export type FormError = { message?: string }
export type FieldErrors = Partial<Record<FieldName, FormError[]>>
