import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Typography } from './primitives';
import { useUiTheme } from './theme';

export function Empty({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.empty, { gap: theme.spacing.md }, style]}>
      {children}
    </View>
  );
}

export function EmptyHeader({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.header, style]}>
      {children}
    </View>
  );
}

export function EmptyTitle({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodyLg" weight="700" style={style}>
      {children}
    </Typography>
  );
}

export function EmptyDescription({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={style}>
      {children}
    </Typography>
  );
}

export function EmptyContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.content, style]}>
      {children}
    </View>
  );
}

export function EmptyMedia({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View
      {...props}
      style={[styles.media, { backgroundColor: theme.colors.muted, borderRadius: theme.radius.xxl }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    gap: 8,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  header: {
    alignItems: 'center',
    gap: 4,
  },
  media: {
    alignItems: 'center',
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
});
