export type SocialAuthPlatform = 'ios' | 'android' | string;

export type GoogleSignInConfig = {
  iosClientId?: string;
  iosUrlScheme?: string;
  webClientId?: string;
};

export function googleSignInConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): GoogleSignInConfig {
  return {
    iosClientId: trimEnv(env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID),
    iosUrlScheme: trimEnv(env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME),
    webClientId: trimEnv(env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID),
  };
}

export function isGoogleSignInConfiguredForPlatform(
  platform: SocialAuthPlatform,
  config: GoogleSignInConfig,
) {
  if (platform !== 'ios' && platform !== 'android') return false;
  if (!config.webClientId) return false;
  if (platform === 'ios' && (!config.iosClientId || !config.iosUrlScheme)) return false;
  return true;
}

function trimEnv(value: string | undefined) {
  return value?.trim() || undefined;
}
