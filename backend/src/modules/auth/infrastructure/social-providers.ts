import { OAuth2Client } from 'google-auth-library'
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

import type { SocialAuthProvider } from '@web-app-demo/contracts'

import type { AppEnv } from '../../../env'
import type { SocialIdentity } from '../application/ports'
import { AuthFailure } from '../domain/errors'

export type VerifiedSocialIdentity = SocialIdentity & { provider: SocialAuthProvider }

const appleIssuer = 'https://appleid.apple.com'
const appleJwksUrl = new URL('https://appleid.apple.com/auth/keys')
const googleClient = new OAuth2Client()
let appleJwks: JWTVerifyGetKey | null = null
let appleJwksTimeoutMs: number | null = null

export const socialAuthProviderDeps = {
  async verifyGoogleIdToken(idToken: string, audiences: string[]): Promise<VerifiedSocialIdentity> {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: audiences,
    })
    const payload = ticket.getPayload()
    const subject = normalizeProviderSubject(payload?.sub)
    const email = normalizeProviderEmail(payload?.email)

    if (!subject || !email || payload?.email_verified !== true) {
      throw invalidProviderToken('Google')
    }

    return {
      provider: 'google',
      subject,
      email,
      displayName: normalizeProviderDisplayName(payload.name),
    }
  },

  async verifyAppleIdToken(
    idToken: string,
    bundleId: string,
    timeoutMs: number,
  ): Promise<VerifiedSocialIdentity> {
    const { payload } = await jwtVerify(idToken, appleRemoteJwks(timeoutMs), {
      algorithms: ['RS256'],
      audience: bundleId,
      issuer: appleIssuer,
    })
    const subject = normalizeProviderSubject(payload.sub)

    if (!subject) {
      throw invalidProviderToken('Apple')
    }

    return {
      provider: 'apple',
      subject,
      email: normalizeProviderEmail(payload.email),
      displayName: normalizeProviderDisplayName(payload.name),
    }
  },
}

export async function verifySocialIdentity(
  provider: SocialAuthProvider,
  idToken: string,
  env: AppEnv,
): Promise<VerifiedSocialIdentity> {
  if (provider === 'google') {
    if (env.GOOGLE_AUTH_CLIENT_IDS.length === 0) {
      throw new AuthFailure('provider_not_configured', 'Google Sign-In is not configured')
    }

    return socialAuthProviderDeps
      .verifyGoogleIdToken(idToken, env.GOOGLE_AUTH_CLIENT_IDS)
      .catch((error: unknown) => {
        throw providerError('Google', error)
      })
  }

  if (!env.APPLE_AUTH_BUNDLE_ID) {
    throw new AuthFailure('provider_not_configured', 'Sign in with Apple is not configured')
  }

  return socialAuthProviderDeps
    .verifyAppleIdToken(idToken, env.APPLE_AUTH_BUNDLE_ID, env.APPLE_AUTH_JWKS_TIMEOUT_MS)
    .catch((error: unknown) => {
      throw providerError('Apple', error)
    })
}

function appleRemoteJwks(timeoutMs: number) {
  if (!appleJwks || appleJwksTimeoutMs !== timeoutMs) {
    appleJwks = createRemoteJWKSet(appleJwksUrl, {
      timeoutDuration: timeoutMs,
    })
    appleJwksTimeoutMs = timeoutMs
  }

  return appleJwks
}

function providerError(providerName: 'Apple' | 'Google', error: unknown) {
  if (error instanceof AuthFailure) return error

  if (isProviderUnavailableError(error)) {
    return new AuthFailure('provider_unavailable', `${providerName} Sign-In is temporarily unavailable`)
  }

  return invalidProviderToken(providerName)
}

function invalidProviderToken(providerName: 'Apple' | 'Google') {
  return new AuthFailure('provider_invalid_token', `Invalid ${providerName} identity token`)
}

function isProviderUnavailableError(error: unknown) {
  if (!(error instanceof Error)) return false
  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    error.message.toLowerCase().includes('timeout')
  )
}

function normalizeProviderSubject(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeProviderEmail(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined
}

function normalizeProviderDisplayName(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
