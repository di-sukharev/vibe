import type { AuthTransportKind } from '@/features/auth';

export function authTransportForPlatform(platform: string): AuthTransportKind {
  return platform === 'web' ? 'cookie' : 'token';
}
