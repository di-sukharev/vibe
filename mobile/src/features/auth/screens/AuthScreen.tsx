import { useForm } from '@tanstack/react-form';
import {
  loginRequestSchema,
  registerRequestSchema,
  type LoginRequest,
  type RegisterRequest,
} from '@web-app-demo/contracts';
import { Redirect, type Href } from 'expo-router';
import { useState } from 'react';

import {
  AuthError,
  AuthModeTabs,
  AuthPanel,
  AuthSubmitButton,
  AuthTextField,
  type AuthMode,
} from '../components/auth-components';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { ScreenLoader } from '@/components/screen-states';
import { Button } from '@/components/ui/button';
import { SocialAuthButtons } from '../components/social-auth-buttons';
import { useAuth } from '../provider';
import { TEST_IDS } from '@/constants/testIds';
import { ApiRequestError } from '@/platform/api';

const isE2eMode = process.env.EXPO_PUBLIC_E2E === '1';

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>('register');
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === 'register';

  const form = useForm({
    defaultValues: {
      displayName: '' as string | undefined,
      email: '',
      password: '',
    },
    validators: {
      onChange: ({ value }) => {
        const result = registerRequestSchema.safeParse(value);
        return result.success ? undefined : result.error.issues;
      },
    },
    onSubmit: async ({ value }) => {
      setError(null);

      try {
        if (isRegister) {
          await auth.register(registerRequestSchema.parse(value) as RegisterRequest);
        } else {
          await auth.login(loginRequestSchema.parse(value) as LoginRequest);
        }
      } catch (caughtError) {
        if (caughtError instanceof ApiRequestError) {
          setError(caughtError.message);
          return;
        }
        setError('Unexpected auth error');
      }
    },
  });

  if (auth.isBootstrapping) {
    return <ScreenLoader />;
  }

  if (auth.sessionError && !auth.user) {
    return (
      <Screen centered>
        <PageHeader
          eyebrow="Session recovery"
          title="Your session is still safe."
          description="The server could not be reached, so the app preserved the authority needed to recover safely."
        />
        <AuthError message={auth.sessionError} />
        <Button
          accessibilityLabel="Retry session recovery"
          disabled={auth.isTransitioning}
          loading={auth.isTransitioning}
          onPress={() => void auth.retrySession()}>
          Try again
        </Button>
      </Screen>
    );
  }

  if (auth.user) {
    return <Redirect href={(auth.user.subscription.isActive ? '/components' : '/paywall') as Href} />;
  }

  return (
    <Screen
      centered
      keyboardAvoiding
      scroll
      scrollViewProps={{
        keyboardDismissMode: 'on-drag',
        keyboardShouldPersistTaps: 'handled',
        showsVerticalScrollIndicator: false,
      }}>
      <PageHeader
        eyebrow="Golden path template"
        title="Auth, Zod contracts, Query, and Form are ready."
        size="hero"
      />

      <AuthPanel>
        <AuthModeTabs
          disabled={auth.isTransitioning}
          mode={mode}
          loginTestID={TEST_IDS.auth.loginTab}
          registerTestID={TEST_IDS.auth.registerTab}
          onModeChange={setMode}
        />

        {isRegister && (
          <form.Field name="displayName">
            {(field) => (
              <AuthTextField
                label="Name"
                testID={TEST_IDS.auth.nameInput}
                value={field.state.value ?? ''}
                autoComplete="name"
                onBlur={field.handleBlur}
                onChangeText={field.handleChange}
                errors={field.state.meta.errors}
              />
            )}
          </form.Field>
        )}

        <form.Field name="email">
          {(field) => (
            <AuthTextField
              label="Email"
              testID={TEST_IDS.auth.emailInput}
              value={field.state.value}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              onBlur={field.handleBlur}
              onChangeText={field.handleChange}
              errors={field.state.meta.errors}
            />
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <AuthTextField
              label="Password"
              testID={TEST_IDS.auth.passwordInput}
              value={field.state.value}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              secureTextEntry={!isE2eMode}
              onBlur={field.handleBlur}
              onChangeText={field.handleChange}
              errors={field.state.meta.errors}
            />
          )}
        </form.Field>

        <AuthError message={error} />

        <form.Subscribe selector={(state) => [state.canSubmit, state.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <AuthSubmitButton
              accessibilityLabel={isRegister ? 'Create account' : 'Login'}
              disabled={!canSubmit || isSubmitting || auth.isTransitioning}
              label={isSubmitting ? 'Working...' : isRegister ? 'Create account' : 'Login'}
              loading={isSubmitting}
              testID={TEST_IDS.auth.submitButton}
              onPress={() => void form.handleSubmit()}
            />
          )}
        </form.Subscribe>

        <SocialAuthButtons
          disabled={auth.isTransitioning}
          getDisplayName={() => (isRegister ? form.getFieldValue('displayName') : undefined)}
          onAuthenticate={auth.socialAuth}
          onError={setError}
        />
      </AuthPanel>
    </Screen>
  );
}
