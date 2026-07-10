import { createHash, randomBytes } from 'node:crypto'

export function createRefreshToken() {
  return randomBytes(32).toString('base64url')
}

export function hashRefreshToken(refreshToken: string) {
  return createHash('sha256').update(refreshToken).digest('hex')
}
