import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Button, type ButtonProps } from './button';
import { Typography } from './primitives';

export function Pagination({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.pagination, style]}>{children}</View>;
}

export function PaginationContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={[styles.content, style]}>{children}</View>;
}

export function PaginationItem({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return <View {...props} style={style}>{children}</View>;
}

export function PaginationLink(props: ButtonProps & { isActive?: boolean }) {
  return <Button {...props} variant={props.isActive ? 'secondary' : 'ghost'} size={props.size ?? 'icon-sm'} />;
}

export function PaginationPrevious(props: ButtonProps) {
  return <Button {...props} variant="outline">{props.children ?? '< Previous'}</Button>;
}

export function PaginationNext(props: ButtonProps) {
  return <Button {...props} variant="outline">{props.children ?? 'Next >'}</Button>;
}

export function PaginationEllipsis({ style, ...props }: TypographyProps) {
  return <Typography {...props} muted style={style}>...</Typography>;
}

const styles = StyleSheet.create({
  content: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  pagination: {
    alignItems: 'center',
  },
});
