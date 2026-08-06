import { SymbolView } from 'expo-symbols';
import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { SectionCard } from '@/components/dashboard/SectionCard';
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useUiTheme } from '@/components/ui/theme';
export { AuthModeTabs } from './auth-mode-tabs';
export type { AuthMode } from './auth-mode-tabs';

type AuthTextFieldProps = {
  errors: unknown[];
  label: string;
  testID: string;
  value: string;
  onBlur: () => void;
  onChangeText: (value: string) => void;
} & Pick<
  ComponentProps<typeof Input>,
  'autoCapitalize' | 'autoComplete' | 'keyboardType' | 'secureTextEntry'
>;

export function AuthPanel({
  children,
  description,
  title,
}: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <View style={styles.panel}>
      <SectionCard description={description} title={title}>
        {children}
      </SectionCard>
    </View>
  );
}

export function AuthTextField({
  errors,
  label,
  testID,
  ...inputProps
}: AuthTextFieldProps) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Input
        {...inputProps}
        accessibilityLabel={label}
        invalid={errors.length > 0}
        testID={testID}
      />
      <FieldError errors={errors} />
    </Field>
  );
}

export function AuthPasswordField({
  isVisible,
  onToggleVisibility,
  visibilityButtonTestID,
  ...fieldProps
}: Omit<AuthTextFieldProps, 'secureTextEntry'> & {
  isVisible: boolean;
  visibilityButtonTestID: string;
  onToggleVisibility: () => void;
}) {
  const theme = useUiTheme();
  const actionLabel = isVisible ? 'Hide password' : 'Show password';

  return (
    <Field>
      <FieldLabel>{fieldProps.label}</FieldLabel>
      <View style={styles.passwordInputFrame}>
        <Input
          accessibilityLabel={fieldProps.label}
          autoCapitalize={fieldProps.autoCapitalize}
          autoComplete={fieldProps.autoComplete}
          invalid={fieldProps.errors.length > 0}
          keyboardType={fieldProps.keyboardType}
          onBlur={fieldProps.onBlur}
          onChangeText={fieldProps.onChangeText}
          secureTextEntry={!isVisible}
          style={styles.passwordInput}
          testID={fieldProps.testID}
          value={fieldProps.value}
        />
        <Button
          accessibilityLabel={actionLabel}
          accessibilityValue={{ text: isVisible ? 'visible' : 'hidden' }}
          onPress={onToggleVisibility}
          size="icon"
          style={styles.passwordVisibilityButton}
          testID={visibilityButtonTestID}
          variant="ghost">
          <SymbolView
            name={{
              ios: isVisible ? 'eye.slash' : 'eye',
              android: isVisible ? 'visibility_off' : 'visibility',
              web: isVisible ? 'visibility_off' : 'visibility',
            }}
            size={20}
            tintColor={theme.colors.mutedForeground}
          />
        </Button>
      </View>
      <FieldError errors={fieldProps.errors} />
    </Field>
  );
}

export function AuthSubmitButton({
  accessibilityLabel,
  disabled,
  label,
  loading,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  disabled: boolean;
  label: string;
  loading: boolean;
  testID: string;
  onPress: () => void;
}) {
  return (
    <Button
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      loading={loading}
      testID={testID}
      onPress={onPress}>
      {label}
    </Button>
  );
}

export function AuthError({ message }: { message?: string | null }) {
  if (!message) return null;

  return (
    <Alert accessibilityLiveRegion="polite" variant="destructive">
      <AlertTitle>Authentication failed</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

const styles = StyleSheet.create({
  passwordInput: {
    paddingRight: 56,
  },
  passwordInputFrame: {
    position: 'relative',
  },
  passwordVisibilityButton: {
    borderWidth: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  panel: {
    alignSelf: 'center',
    maxWidth: 520,
    width: '100%',
  },
});
