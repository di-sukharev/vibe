import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'

import type { AppEnv } from '../../../env'
import { BillingFailure } from '../domain/errors'

const offerCodeRedemptionScope = 'iap_offer_code_redemption'
const offerCodeRedemptionTtlSeconds = 15 * 60
const offerCodeRedemptionPayloadSchema = z.object({
  scope: z.literal(offerCodeRedemptionScope),
  sub: z.string().min(1),
  iat: z.number().int().positive(),
})

function secretKey(secret: string) {
  return new TextEncoder().encode(secret)
}

export function signOfferCodeRedemptionToken(userId: string, env: Pick<AppEnv, 'JWT_SECRET'>) {
  return new SignJWT({ scope: offerCodeRedemptionScope })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${offerCodeRedemptionTtlSeconds}s`)
    .sign(secretKey(env.JWT_SECRET))
}

export async function verifyOfferCodeRedemptionToken(
  token: string,
  env: Pick<AppEnv, 'JWT_SECRET'>,
) {
  const { payload } = await jwtVerify(token, secretKey(env.JWT_SECRET)).catch(() => {
    throw new BillingFailure(
      'IAP_OWNERSHIP_MISMATCH',
      'Offer code redemption session is invalid or expired',
    )
  })
  const parsed = offerCodeRedemptionPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new BillingFailure(
      'IAP_OWNERSHIP_MISMATCH',
      'Offer code redemption session is invalid or expired',
    )
  }

  return {
    issuedAt: new Date(parsed.data.iat * 1000),
    userId: parsed.data.sub,
  }
}
