import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type PressableProps, type ViewProps } from 'react-native';

import { UiPressable, Typography } from './primitives';

export function Breadcrumb({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={style}>{children}</View>;
}

export function BreadcrumbList({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.list, style]}>
      {children}
    </View>
  );
}

export function BreadcrumbItem({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.item, style]}>
      {children}
    </View>
  );
}

export function BreadcrumbLink({ children, style, ...props }: PressableProps & { children?: ReactNode }) {
  return (
    <UiPressable {...props} style={style}>
      <Typography variant="bodySm" muted>{children}</Typography>
    </UiPressable>
  );
}

export function BreadcrumbPage({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" weight="700" style={style}>
      {children}
    </Typography>
  );
}

export function BreadcrumbSeparator({ children = '>', style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={style}>
      {children}
    </Typography>
  );
}

export function BreadcrumbEllipsis({ style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={style}>
      ...
    </Typography>
  );
}

const styles = StyleSheet.create({
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  list: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
});
