import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { PressableProps } from 'react-native';
import { StyleSheet } from 'react-native';

import { UiPressable } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';

type BottomNavigationItemProps = Omit<
  PressableProps,
  'accessibilityLabel' | 'children' | 'style'
> & {
  icon: SymbolViewProps['name'];
  isActive?: boolean;
  label: string;
};

export function BottomNavigationItem({
  disabled,
  icon,
  isActive,
  label,
  ...props
}: BottomNavigationItemProps) {
  const theme = useUiTheme();
  const foreground = isActive
    ? theme.colors.accentForeground
    : theme.colors.mutedForeground;

  return (
    <UiPressable
      {...props}
      aria-current={isActive ? 'page' : undefined}
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{
        disabled: Boolean(disabled),
        selected: Boolean(isActive),
      }}
      disabled={disabled}
      style={[
        styles.item,
        {
          backgroundColor: isActive
            ? theme.colors.accent
            : theme.colors.transparent,
          borderRadius: theme.radius.lg,
          gap: theme.spacing.xs,
          paddingVertical: theme.spacing.xs,
        },
      ]}>
      <SymbolView name={icon} size={22} tintColor={foreground} />
      <Typography colorValue={foreground} variant="caption" weight="700">
        {label}
      </Typography>
    </UiPressable>
  );
}

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
});
