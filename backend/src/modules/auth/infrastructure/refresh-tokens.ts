import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const componentPattern = /^[A-Za-z0-9_-]{43}$/
const familyPurpose = 'web-app-demo:refresh-family:v1\0'
const familyTagPurpose = 'web-app-demo:refresh-family-tag:v1\0'
const rotationPurpose = 'web-app-demo:refresh-rotation:v1\0'

export function createRefreshToken(secret: string) {
  return refreshTokenFor(
    randomBytes(32).toString('base64url'),
    randomBytes(32).toString('base64url'),
    secret,
  )
}

export function hashRefreshToken(refreshToken: string) {
  return createHash('sha256').update(refreshToken).digest('hex')
}

export function deriveRotatedRefreshToken(refreshToken: string, secret: string) {
  const nextCredential = createHmac('sha256', secret)
    .update(rotationPurpose)
    .update(refreshToken)
    .digest('base64url')

  return refreshTokenFor(refreshTokenFamilyId(refreshToken, secret), nextCredential, secret)
}

export function hashRefreshTokenFamily(refreshToken: string, secret: string) {
  return createHash('sha256')
    .update(refreshTokenFamilyId(refreshToken, secret))
    .digest('hex')
}

function refreshTokenFor(familyId: string, credential: string, secret: string) {
  return `${familyId}.${credential}.${familyTag(familyId, secret)}`
}

/**
 * A keyed tag over the family locator. The locator itself travels in the clear inside every token
 * of the family, so without this tag anyone holding half a leaked token could name the family -
 * and naming it is enough to make the reuse check treat the request as a stolen credential and
 * revoke the session. Producing the tag needs the signing secret, so a forged token cannot.
 */
function familyTag(familyId: string, secret: string) {
  return createHmac('sha256', secret)
    .update(familyTagPurpose)
    .update(familyId)
    .digest('base64url')
}

function refreshTokenFamilyId(refreshToken: string, secret: string) {
  const [familyId, credential, tag, extra] = refreshToken.split('.')
  if (
    extra === undefined &&
    componentPattern.test(familyId ?? '') &&
    componentPattern.test(credential ?? '') &&
    tag !== undefined &&
    matchesFamilyTag(familyId ?? '', tag, secret)
  ) {
    return familyId ?? ''
  }

  // Anything this server did not issue - a token forged around a leaked family locator, or one
  // issued before the tag existed - gets a locator of its own instead. No stored session carries
  // it, so such a token can still be matched by its own credential hash, but it can no longer
  // speak for a family it cannot prove membership of.
  return createHmac('sha256', secret)
    .update(familyPurpose)
    .update(refreshToken)
    .digest('base64url')
}

function matchesFamilyTag(familyId: string, tag: string, secret: string) {
  const expected = Buffer.from(familyTag(familyId, secret))
  const presented = Buffer.from(tag)
  return expected.length === presented.length && timingSafeEqual(expected, presented)
}
