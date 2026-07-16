import { createHash, createHmac, randomBytes } from 'node:crypto'

export function createRefreshToken() {
  return `${randomBytes(32).toString('base64url')}.${randomBytes(32).toString('base64url')}`
}

export function hashRefreshToken(refreshToken: string) {
  return createHash('sha256').update(refreshToken).digest('hex')
}

export function deriveRotatedRefreshToken(refreshToken: string, secret: string) {
  const familyId = refreshTokenFamilyId(refreshToken, secret)
  const nextCredential = createHmac('sha256', secret)
    .update('web-app-demo:refresh-rotation:v1\0')
    .update(refreshToken)
    .digest('base64url')

  return `${familyId}.${nextCredential}`
}

export function hashRefreshTokenFamily(refreshToken: string, secret: string) {
  return createHash('sha256')
    .update(refreshTokenFamilyId(refreshToken, secret))
    .digest('hex')
}

function refreshTokenFamilyId(refreshToken: string, secret: string) {
  const [familyId, credential, extra] = refreshToken.split('.')
  if (
    extra === undefined &&
    /^[A-Za-z0-9_-]{43}$/.test(familyId ?? '') &&
    /^[A-Za-z0-9_-]{43}$/.test(credential ?? '')
  ) {
    return familyId
  }

  return createHmac('sha256', secret)
    .update('web-app-demo:refresh-family:v1\0')
    .update(refreshToken)
    .digest('base64url')
}
