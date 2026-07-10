import { expect, test } from 'bun:test';

import {
  googleSignInConfigFromEnv,
  isGoogleSignInConfiguredForPlatform,
} from '../src/features/auth/social-auth-config';

test('Google Sign-In config trims public Expo env values', () => {
  expect(
    googleSignInConfigFromEnv({
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: ' ios-client ',
      EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME: ' com.googleusercontent.apps.ios-client ',
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: ' web-client ',
    } as NodeJS.ProcessEnv),
  ).toEqual({
    iosClientId: 'ios-client',
    iosUrlScheme: 'com.googleusercontent.apps.ios-client',
    webClientId: 'web-client',
  });
});

test('Google Sign-In is fail-closed on platforms without complete native config', () => {
  expect(
    isGoogleSignInConfiguredForPlatform('ios', {
      iosClientId: 'ios-client',
      webClientId: 'web-client',
    }),
  ).toBe(false);
  expect(
    isGoogleSignInConfiguredForPlatform('ios', {
      iosClientId: 'ios-client',
      iosUrlScheme: 'com.googleusercontent.apps.ios-client',
      webClientId: 'web-client',
    }),
  ).toBe(true);
  expect(
    isGoogleSignInConfiguredForPlatform('android', {
      webClientId: 'web-client',
    }),
  ).toBe(true);
  expect(
    isGoogleSignInConfiguredForPlatform('web', {
      iosClientId: 'ios-client',
      iosUrlScheme: 'com.googleusercontent.apps.ios-client',
      webClientId: 'web-client',
    }),
  ).toBe(false);
});
