import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Separator } from './separator';
import { Typography } from './primitives';
import { useUiTheme } from './theme';

export function buttonGroupVariants(options?: { orientation?: 'horizontal' | 'vertical' }) {
  return options ?? {};
}

export function ButtonGroup({
  children,
  orientation = 'horizontal',
  style,
  ...props
}: ViewProps & { children?: ReactNode; orientation?: 'horizontal' | 'vertical' }) {
  const theme = useUiTheme();
  return (
    <View
      {...props}
      style={[
        styles.group,
        { gap: theme.spacing.xs, flexDirection: orientation === 'horizontal' ? 'row' : 'column' },
        style,
      ]}>
      {children}
    </View>
  );
}

export const ButtonGroupSeparator = Separator;

export function ButtonGroupText({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={style}>
      {children}
    </Typography>
  );
}

const styles = StyleSheet.create({
  group: {
    alignItems: 'center',
  },
});
