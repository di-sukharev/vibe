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
  AuthPasswordField,
  AuthSubmitButton,
  AuthTextField,
  type AuthMode,
} from '../components/auth-components';
import { ScreenShell, ScreenState } from '@/components/dashboard';
import { ScreenLoader } from '@/components/screen-states';
import { Button } from '@/components/ui/button';
// Sign in with Apple / Google is turned off; see docs/SOCIAL_AUTH.md before uncommenting.
// import { SocialAuthButtons } from '../components/social-auth-buttons';
import { useAuth } from '../provider';
import { TEST_IDS } from '@/constants/testIds';
import { ApiRequestError } from '@/platform/api';

export function AuthScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<AuthMode>('register');
  const [error, setError] = useState<string | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isRegister = mode === 'register';

  const handleModeChange = (nextMode: AuthMode) => {
    setIsPasswordVisible(false);
    setMode(nextMode);
  };

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
      <ScreenShell
        centered
        description="The app preserved your local authority and will only continue after the server confirms the session."
        eyebrow="Session recovery"
        title="Your session is still safe.">
        <ScreenState
          action={
            <Button
              accessibilityLabel="Retry session recovery"
              disabled={auth.isTransitioning}
              loading={auth.isTransitioning}
              onPress={() => void auth.retrySession()}>
              Try again
            </Button>
          }
          description={auth.sessionError}
          status="error"
          title="We could not reach the server"
        />
      </ScreenShell>
    );
  }

  if (auth.user) {
    return <Redirect href={'/components' as Href} />;
  }

  return (
    <ScreenShell
      centered
      description="Sign in with your email and password."
      eyebrow="Golden path template"
      keyboardAware
      title="Welcome to your workspace.">

      <AuthPanel
        description={
          isRegister
            ? 'Create a user account. Account roles are assigned securely by the server.'
            : 'Enter your existing account credentials to continue.'
        }
        title={isRegister ? 'Create an account' : 'Welcome back'}>
        <AuthModeTabs
          disabled={auth.isTransitioning}
          mode={mode}
          loginTestID={TEST_IDS.auth.loginTab}
          registerTestID={TEST_IDS.auth.registerTab}
          onModeChange={handleModeChange}
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
            <AuthPasswordField
              label="Password"
              testID={TEST_IDS.auth.passwordInput}
              value={field.state.value}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              isVisible={isPasswordVisible}
              onBlur={field.handleBlur}
              onChangeText={field.handleChange}
              onToggleVisibility={() => setIsPasswordVisible((visible) => !visible)}
              errors={field.state.meta.errors}
              visibilityButtonTestID={TEST_IDS.auth.passwordVisibilityButton}
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

        {/* Uncomment together with the backend social route (docs/SOCIAL_AUTH.md):
        <SocialAuthButtons
          disabled={auth.isTransitioning}
          getDisplayName={() => (isRegister ? form.getFieldValue('displayName') : undefined)}
          onAuthenticate={auth.socialAuth}
          onError={setError}
        /> */}
      </AuthPanel>
    </ScreenShell>
  );
}
