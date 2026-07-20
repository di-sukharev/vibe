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
export { AuthModeTabs } from './auth-mode-tabs';
export type { AuthMode } from './auth-mode-tabs';

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
}: {
  errors: unknown[];
  label: string;
  testID: string;
  value: string;
  onBlur: () => void;
  onChangeText: (value: string) => void;
} & Pick<
  ComponentProps<typeof Input>,
  'autoCapitalize' | 'autoComplete' | 'keyboardType' | 'secureTextEntry'
>) {
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
  panel: {
    alignSelf: 'center',
    maxWidth: 520,
    width: '100%',
  },
});
