import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Separator } from './separator';
import { Surface, Typography } from './primitives';
import { useUiTheme } from './theme';
import { createMinTouchTargetStyle } from './touch-target';

export function Item({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <Surface {...props} tone="transparent" rounded="xl" style={[styles.item, { gap: theme.spacing.md }, style]}>
      {children}
    </Surface>
  );
}

export function ItemMedia({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <Surface
      {...props}
      tone="muted"
      rounded="xl"
      style={[styles.media, { backgroundColor: theme.colors.muted }, style]}>
      {children}
    </Surface>
  );
}

export function ItemContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.content, style]}>
      {children}
    </View>
  );
}

export function ItemActions({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.actions, style]}>
      {children}
    </View>
  );
}

export function ItemGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function ItemSeparator(props: ViewProps) {
  return <Separator {...props} />;
}

export function ItemTitle({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" weight="700" style={style}>
      {children}
    </Typography>
  );
}

export function ItemDescription({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={style}>
      {children}
    </Typography>
  );
}

export function ItemHeader({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.header, style]}>
      {children}
    </View>
  );
}

export function ItemFooter({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.footer, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  content: {
    flex: 1,
    gap: 2,
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
  },
  group: {
    gap: 4,
  },
  header: {
    flexDirection: 'row',
    gap: 8,
  },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    padding: 12,
  },
  media: {
    alignItems: 'center',
    ...createMinTouchTargetStyle(),
    justifyContent: 'center',
  },
});
