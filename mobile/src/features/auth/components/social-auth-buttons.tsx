import type { SocialAuthProvider, SocialAuthRequest } from '@web-app-demo/contracts';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Typography } from '@/components/ui/typography';
import { useUiTheme } from '@/components/ui/theme';
import { TEST_IDS } from '@/constants/testIds';
import { ApiRequestError } from '@/platform/api';
import {
  googleSignInConfigFromEnv,
  isGoogleSignInConfiguredForPlatform,
} from '../social-auth-config';

type PendingProvider = SocialAuthProvider | null;
type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

type SocialAuthButtonsProps = {
  disabled?: boolean;
  getDisplayName?: () => string | undefined;
  onAuthenticate: (provider: SocialAuthProvider, input: SocialAuthRequest) => Promise<void>;
  onError: (message: string | null) => void;
};

let googleSignInModulePromise: Promise<GoogleSignInModule | null> | null = null;

export function SocialAuthButtons({
  disabled,
  getDisplayName,
  onAuthenticate,
  onError,
}: SocialAuthButtonsProps) {
  const theme = useUiTheme();
  const [pendingProvider, setPendingProvider] = useState<PendingProvider>(null);
  const [isAppleAvailable, setIsAppleAvailable] = useState(false);
  const [googleSignInModule, setGoogleSignInModule] = useState<GoogleSignInModule | null>(null);
  const googleConfig = useMemo(() => googleSignInConfigFromEnv(), []);
  const isGoogleConfigured = useMemo(
    () => isGoogleSignInConfiguredForPlatform(Platform.OS, googleConfig),
    [googleConfig],
  );

  useEffect(() => {
    let mounted = true;

    if (!isGoogleConfigured) {
      setGoogleSignInModule(null);
      return () => {
        mounted = false;
      };
    }

    loadGoogleSignInModule()
      .then((module) => {
        if (!mounted) return;
        if (!module) {
          setGoogleSignInModule(null);
          return;
        }

        module.GoogleSignin.configure({
          iosClientId: googleConfig.iosClientId,
          webClientId: googleConfig.webClientId,
        });
        setGoogleSignInModule(module);
      })
      .catch(() => {
        if (mounted) setGoogleSignInModule(null);
      });

    return () => {
      mounted = false;
    };
  }, [googleConfig, isGoogleConfigured]);

  useEffect(() => {
    let mounted = true;

    if (Platform.OS !== 'ios') {
      setIsAppleAvailable(false);
      return () => {
        mounted = false;
      };
    }

    AppleAuthentication.isAvailableAsync()
      .then((available) => {
        if (mounted) setIsAppleAvailable(available);
      })
      .catch(() => {
        if (mounted) setIsAppleAvailable(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const exchangeProviderToken = useCallback(
    async (provider: SocialAuthProvider, idToken: string, providerDisplayName?: string) => {
      const displayName = normalizedDisplayName(getDisplayName?.()) ?? providerDisplayName;
      await onAuthenticate(provider, {
        idToken,
        displayName,
      });
    },
    [getDisplayName, onAuthenticate],
  );

  const handleGoogleSignIn = useCallback(async () => {
    if (pendingProvider || !isGoogleConfigured) return;

    setPendingProvider('google');
    onError(null);
    let google = googleSignInModule;

    try {
      google ??= await loadGoogleSignInModule();
      if (!google) throw new Error('GOOGLE_SIGN_IN_UNAVAILABLE');

      if (Platform.OS === 'android') {
        await google.GoogleSignin.hasPlayServices({
          showPlayServicesUpdateDialog: true,
        });
      }

      const response = await google.GoogleSignin.signIn();
      if (google.isCancelledResponse(response)) return;
      if (!google.isSuccessResponse(response)) throw new Error('GOOGLE_SIGN_IN_FAILED');

      const tokenResponse = await google.GoogleSignin.getTokens();
      const idToken = response.data.idToken ?? tokenResponse.idToken;
      if (!idToken) throw new Error('GOOGLE_ID_TOKEN_MISSING');

      await exchangeProviderToken('google', idToken, response.data.user.name ?? undefined);
    } catch (error) {
      if (isBenignGoogleError(error, google)) return;
      onError(socialAuthErrorMessage('google', error));
    } finally {
      setPendingProvider(null);
    }
  }, [exchangeProviderToken, googleSignInModule, isGoogleConfigured, onError, pendingProvider]);

  const handleAppleSignIn = useCallback(async () => {
    if (pendingProvider || !isAppleAvailable) return;

    setPendingProvider('apple');
    onError(null);

    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) throw new Error('APPLE_ID_TOKEN_MISSING');

      await exchangeProviderToken(
        'apple',
        credential.identityToken,
        appleCredentialDisplayName(credential.fullName),
      );
    } catch (error) {
      if (isAppleSignInCancelled(error)) return;
      onError(socialAuthErrorMessage('apple', error));
    } finally {
      setPendingProvider(null);
    }
  }, [exchangeProviderToken, isAppleAvailable, onError, pendingProvider]);

  const isGoogleAvailable = Boolean(googleSignInModule);
  if (!isAppleAvailable && !isGoogleAvailable) return null;

  const isAppleLoading = pendingProvider === 'apple';
  const isGoogleLoading = pendingProvider === 'google';

  return (
    <View style={styles.stack}>
      <View style={styles.divider}>
        <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
        <Typography variant="caption" color="mutedForeground">
          or
        </Typography>
        <View style={[styles.dividerLine, { backgroundColor: theme.colors.border }]} />
      </View>
      {isAppleAvailable && (
        <View
          pointerEvents={disabled || isGoogleLoading || isAppleLoading ? 'none' : 'auto'}
          style={[
            styles.appleButtonWrapper,
            (disabled || isGoogleLoading || isAppleLoading) && styles.disabled,
          ]}>
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={6}
            style={styles.appleButton}
            testID={TEST_IDS.auth.socialAppleButton}
            onPress={handleAppleSignIn}
          />
        </View>
      )}
      {isGoogleAvailable && (
        <SocialButton
          label="Continue with Google"
          mark="G"
          loading={isGoogleLoading}
          disabled={disabled || isAppleLoading}
          testID={TEST_IDS.auth.socialGoogleButton}
          onPress={handleGoogleSignIn}
        />
      )}
    </View>
  );
}

function SocialButton({
  disabled,
  label,
  loading,
  mark,
  onPress,
  testID,
}: {
  disabled?: boolean;
  label: string;
  loading: boolean;
  mark: string;
  onPress: () => void;
  testID: string;
}) {
  const theme = useUiTheme();

  return (
    <Button
      accessibilityLabel={label}
      disabled={disabled}
      loading={loading}
      variant="outline"
      testID={testID}
      onPress={onPress}>
      <View style={styles.buttonContent}>
        <View
          style={[
            styles.providerMark,
            {
              borderColor: theme.colors.border,
              backgroundColor: theme.colors.background,
            },
          ]}>
          <Typography variant="label" weight="800">
            {mark}
          </Typography>
        </View>
        <Typography variant="button">{label}</Typography>
      </View>
    </Button>
  );
}

function socialAuthErrorMessage(provider: SocialAuthProvider, error: unknown) {
  const providerName = provider === 'apple' ? 'Apple' : 'Google';

  if (error instanceof ApiRequestError) {
    switch (error.code) {
      case 'AUTH_EMAIL_ALREADY_EXISTS':
        return 'An account with this email already exists. Log in with email and password.';
      case 'AUTH_INVALID_PROVIDER_TOKEN':
        return `${providerName} sign-in failed. Please try again.`;
      case 'AUTH_PROVIDER_ACCOUNT_ALREADY_LINKED':
        return `This ${providerName} account is already linked to another user.`;
      case 'AUTH_PROVIDER_EMAIL_REQUIRED':
        return `${providerName} did not share an email address. Try another sign-in method.`;
      case 'AUTH_PROVIDER_NOT_CONFIGURED':
        return `${providerName} sign-in is not configured yet.`;
      case 'AUTH_PROVIDER_UNAVAILABLE':
        return `${providerName} sign-in is temporarily unavailable. Please try again.`;
      default:
        return error.message;
    }
  }

  return `${providerName} sign-in failed. Please try again.`;
}

function isBenignGoogleError(error: unknown, google: GoogleSignInModule | null) {
  if (!google?.isErrorWithCode(error)) return false;
  return (
    error.code === google.statusCodes.SIGN_IN_CANCELLED ||
    error.code === google.statusCodes.IN_PROGRESS
  );
}

function isAppleSignInCancelled(error: unknown) {
  return errorHasCode(error, ['ERR_REQUEST_CANCELED', 'ERR_REQUEST_CANCELLED']);
}

function appleCredentialDisplayName(fullName: AppleAuthentication.AppleAuthenticationFullName | null) {
  return normalizedDisplayName(
    [fullName?.givenName, fullName?.familyName]
      .map((part) => part?.trim())
      .filter(Boolean)
      .join(' '),
  );
}

function normalizedDisplayName(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed && trimmed.length >= 2 ? trimmed : undefined;
}

function errorHasCode(error: unknown, codes: string[]) {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return typeof error.code === 'string' && codes.includes(error.code);
}

async function loadGoogleSignInModule() {
  googleSignInModulePromise ??= import('@react-native-google-signin/google-signin').catch(
    () => null,
  );
  return googleSignInModulePromise;
}

const styles = StyleSheet.create({
  appleButton: {
    height: 44,
    width: '100%',
  },
  appleButtonWrapper: {
    minHeight: 44,
  },
  buttonContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  divider: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  disabled: {
    opacity: 0.5,
  },
  providerMark: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  stack: {
    gap: 12,
  },
});
