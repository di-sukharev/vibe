import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'

import type { AppEnv } from '../../../env'

const accessTokenPayloadSchema = z.object({
  sub: z.string().min(1),
  sessionId: z.string().min(1),
  email: z.string().email(),
})

export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>

function secretKey(secret: string) {
  return new TextEncoder().encode(secret)
}

export function signAccessToken(payload: AccessTokenPayload, env: AppEnv) {
  return new SignJWT({
    sessionId: payload.sessionId,
    email: payload.email,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${env.ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(secretKey(env.JWT_SECRET))
}

export async function verifyAccessToken(token: string, env: Pick<AppEnv, 'JWT_SECRET'>) {
  const { payload } = await jwtVerify(token, secretKey(env.JWT_SECRET))
  return accessTokenPayloadSchema.parse({
    sub: payload.sub,
    sessionId: payload.sessionId,
    email: payload.email,
  })
}
