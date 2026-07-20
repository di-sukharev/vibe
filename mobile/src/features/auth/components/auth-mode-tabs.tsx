import { StyleSheet, View } from 'react-native';

import { UiPressable } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';

export type AuthMode = 'register' | 'login';

type AuthModeTabsProps = {
  disabled?: boolean;
  loginTestID: string;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  registerTestID: string;
};

export function AuthModeTabs({
  disabled,
  loginTestID,
  mode,
  onModeChange,
  registerTestID,
}: AuthModeTabsProps) {
  const theme = useUiTheme();

  return (
    <View
      accessibilityLabel="Authentication mode"
      accessibilityRole="tablist"
      style={[
        styles.tabs,
        {
          backgroundColor: theme.colors.muted,
          borderRadius: theme.radius.full,
          gap: theme.spacing.xs,
          padding: theme.spacing.xs,
        },
      ]}>
      <AuthModeTab
        active={mode === 'register'}
        disabled={disabled}
        label="Register"
        testID={registerTestID}
        onPress={() => onModeChange('register')}
      />
      <AuthModeTab
        active={mode === 'login'}
        disabled={disabled}
        label="Login"
        testID={loginTestID}
        onPress={() => onModeChange('login')}
      />
    </View>
  );
}

function AuthModeTab({
  active,
  disabled,
  label,
  onPress,
  testID,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const theme = useUiTheme();

  return (
    <UiPressable
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      style={[
        styles.tab,
        {
          backgroundColor: active ? theme.colors.background : theme.colors.transparent,
          borderRadius: theme.radius.full,
          minHeight: 48,
        },
      ]}
      testID={testID}
      onPress={onPress}>
      <Typography variant="label" color={active ? 'foreground' : 'mutedForeground'}>
        {label}
      </Typography>
    </UiPressable>
  );
}

const styles = StyleSheet.create({
  tab: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  tabs: {
    flexDirection: 'row',
  },
});
