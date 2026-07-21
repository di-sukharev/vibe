import { createHash, randomBytes } from 'node:crypto'

export function createPasswordResetToken() {
  return randomBytes(32).toString('base64url')
}

export function hashPasswordResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
