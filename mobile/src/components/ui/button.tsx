import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  getControlHeight,
  getInteractiveColors,
  renderTextChild,
  UiPressable,
  type UiSize,
  type UiVariant,
} from './primitives';
import { useUiTheme } from './theme';
import { MIN_TOUCH_TARGET } from './touch-target';
import { buttonAccessibilityLabel } from './button-utils';

export type ButtonProps = Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  variant?: UiVariant;
  size?: UiSize | 'icon' | 'icon-sm' | 'icon-lg' | 'icon-xs';
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  loading?: boolean;
};

export function buttonVariants(options?: { variant?: UiVariant; size?: ButtonProps['size'] }) {
  return options ?? {};
}

export function Button({
  children,
  variant = 'default',
  size = 'default',
  style,
  textStyle,
  loading,
  disabled,
  accessibilityLabel,
  accessibilityState,
  ...props
}: ButtonProps) {
  const theme = useUiTheme();
  const colors = getInteractiveColors(theme, variant);
  const iconSize = size === 'icon-lg' ? 48 : MIN_TOUCH_TARGET;
  const isIcon = String(size).startsWith('icon');
  const height = isIcon ? iconSize : getControlHeight(size as UiSize);

  return (
    <UiPressable
      accessibilityLabel={accessibilityLabel ?? buttonAccessibilityLabel(children)}
      accessibilityRole="button"
      accessibilityState={{
        ...accessibilityState,
        busy: Boolean(loading),
        disabled: Boolean(disabled || loading),
      }}
      {...props}
      disabled={disabled || loading}
      style={[
        styles.button,
        {
          minHeight: height,
          minWidth: isIcon ? height : undefined,
          borderColor: colors.borderColor,
          backgroundColor: colors.backgroundColor,
          borderRadius: theme.radius.full,
          paddingHorizontal: isIcon ? 0 : size === 'lg' ? 18 : size === 'xs' ? 10 : 14,
        },
        variant === 'link' && styles.linkButton,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.color} size="small" />
      ) : (
        renderTextChild(children, [styles.buttonText, { color: colors.color }, textStyle], undefined, 'button')
      )}
    </UiPressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  buttonText: {
    textAlign: 'center',
  },
  linkButton: {
    borderWidth: 0,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 0,
  },
});
