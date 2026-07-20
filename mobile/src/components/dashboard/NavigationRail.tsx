import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type PressableProps,
  type ViewStyle,
} from 'react-native';

import { Surface, UiPressable } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { NAVIGATION_RAIL_WIDTH } from './model';

type NavigationRailProps = {
  children: ReactNode;
  footer?: ReactNode;
  title: string;
};

export function NavigationRail({ children, footer, title }: NavigationRailProps) {
  const theme = useUiTheme();

  return (
    <Surface
      accessibilityLabel="Primary navigation"
      role="navigation"
      style={[
        styles.rail,
        {
          backgroundColor: theme.colors.muted,
          borderRightColor: theme.colors.border,
          gap: theme.spacing.xl,
          padding: theme.spacing.lg,
        },
      ]}
      tone="muted">
      <View style={[styles.brand, { gap: theme.spacing.sm }]}>
        <Surface
          rounded="full"
          style={[styles.brandMark, { backgroundColor: theme.colors.primary }]}>
          <Typography color="primaryForeground" variant="label">
            W
          </Typography>
        </Surface>
        <Typography variant="body" weight="700">
          {title}
        </Typography>
      </View>
      <View style={[styles.items, { gap: theme.spacing.xs }]}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Surface>
  );
}

type NavigationRailItemProps = Omit<PressableProps, 'children' | 'style'> & {
  icon: SymbolViewProps['name'];
  isActive?: boolean;
  label: string;
};

export function NavigationRailItem({
  icon,
  isActive,
  label,
  ...props
}: NavigationRailItemProps) {
  const theme = useUiTheme();
  const foreground = isActive
    ? theme.colors.accentForeground
    : theme.colors.navigationForeground;

  return (
    <UiPressable
      {...props}
      aria-current={isActive ? 'page' : undefined}
      accessibilityLabel={label}
      accessibilityRole="link"
      accessibilityState={{ selected: Boolean(isActive) }}
      style={[
        styles.item,
        {
          backgroundColor: isActive ? theme.colors.accent : theme.colors.transparent,
          borderRadius: theme.radius.lg,
          gap: theme.spacing.md,
          paddingHorizontal: theme.spacing.md,
        },
      ]}>
      <SymbolView name={icon} size={20} tintColor={foreground} />
      <Typography colorValue={foreground} variant="bodySm" weight="600">
        {label}
      </Typography>
    </UiPressable>
  );
}

const styles = StyleSheet.create({
  brand: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  brandMark: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  footer: {
    marginTop: 'auto',
  },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 44,
  },
  items: {
    flex: 1,
  },
  rail: {
    borderRadius: 0,
    borderRightWidth: StyleSheet.hairlineWidth,
    bottom: 0,
    left: 0,
    position: 'fixed' as ViewStyle['position'],
    top: 0,
    width: NAVIGATION_RAIL_WIDTH,
  },
});
