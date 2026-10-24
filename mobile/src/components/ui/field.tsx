import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Label, type LabelProps } from './label';
import { Separator } from './separator';
import { Typography } from './primitives';
import { useUiTheme } from './theme';

export function Field({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.field, { gap: theme.spacing.sm }, style]}>
      {children}
    </View>
  );
}

export function FieldLabel({ children, ...props }: LabelProps) {
  return <Label {...props}>{children}</Label>;
}

export function FieldDescription({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={style}>
      {children}
    </Typography>
  );
}

export function FieldError({ children, errors, style, ...props }: TypographyProps & { errors?: unknown[] }) {
  const theme = useUiTheme();
  const content = children ?? errors?.map(formatFieldError).join(', ');
  if (!content) return null;

  return (
    <Typography {...props} variant="bodySm" weight="700" style={[{ color: theme.colors.destructive }, style]}>
      {content}
    </Typography>
  );
}

export function FieldGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.group, { gap: theme.spacing.lg }, style]}>
      {children}
    </View>
  );
}

export function FieldLegend({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="body" weight="700" style={style}>
      {children}
    </Typography>
  );
}

export function FieldSeparator(props: ViewProps) {
  return <Separator {...props} />;
}

export function FieldSet({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.set, style]}>
      {children}
    </View>
  );
}

export function FieldContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.content, style]}>
      {children}
    </View>
  );
}

export function FieldTitle({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" weight="700" style={style}>
      {children}
    </Typography>
  );
}

function formatFieldError(error: unknown) {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Invalid value';
}

const styles = StyleSheet.create({
  content: {
    gap: 4,
  },
  field: {},
  group: {},
  set: {
    gap: 12,
  },
});
