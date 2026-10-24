import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type ViewProps } from 'react-native';

import { renderTextChild, Typography } from './primitives';
import { useUiTheme } from './theme';
import { createMinTouchTargetStyle } from './touch-target';

export function Table({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View {...props} style={[styles.table, style]}>
        {children}
      </View>
    </ScrollView>
  );
}

export function TableHeader({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.section, style]}>
      {children}
    </View>
  );
}

export function TableBody({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.body, style]}>
      {children}
    </View>
  );
}

export function TableFooter({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.section, style]}>
      {children}
    </View>
  );
}

export function TableHead({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <TableCell {...props} style={style}>
      <Typography variant="bodySm" weight="700" muted>
        {children}
      </Typography>
    </TableCell>
  );
}

export function TableRow({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.row, { borderBottomColor: theme.colors.border }, style]}>
      {children}
    </View>
  );
}

export function TableCell({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.cell, style]}>
      {renderTextChild(children)}
    </View>
  );
}

export function TableCaption({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={[styles.caption, style]}>
      {children}
    </Typography>
  );
}

const styles = StyleSheet.create({
  body: {},
  caption: {
    marginTop: 8,
    textAlign: 'center',
  },
  cell: {
    justifyContent: 'center',
    ...createMinTouchTargetStyle('height'),
    minWidth: 120,
    paddingHorizontal: 12,
  },
  row: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
  section: {},
  table: {
    minWidth: 320,
  },
});
