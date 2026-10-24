import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Dialog, DialogContent } from './dialog';
import { Input, type InputProps } from './input';
import { Separator } from './separator';
import { renderTextChild, UiPressable, Typography } from './primitives';
import { useUiTheme } from './theme';
import { createMinTouchTargetStyle } from './touch-target';

export function Command({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.command, { gap: theme.spacing.sm }, style]}>
      {children}
    </View>
  );
}

export function CommandDialog({ children, ...props }: { children?: ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void }) {
  return (
    <Dialog {...props}>
      <DialogContent scrollable>{children}</DialogContent>
    </Dialog>
  );
}

export function CommandInput(props: InputProps) {
  return <Input {...props} placeholder={props.placeholder ?? 'Search'} />;
}

export function CommandList({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.list, style]}>
      {children}
    </View>
  );
}

export function CommandEmpty({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={[styles.empty, style]}>
      {children}
    </Typography>
  );
}

export function CommandGroup({ children, heading, style, ...props }: ViewProps & { children?: ReactNode; heading?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {heading ? <Typography variant="caption" weight="700" muted>{heading}</Typography> : null}
      {children}
    </View>
  );
}

export function CommandItem({
  children,
  style,
  ...props
}: Omit<PressableProps, 'style'> & { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <UiPressable {...props} accessibilityRole="button" style={[styles.item, style]}>
      {renderTextChild(children)}
    </UiPressable>
  );
}

export function CommandShortcut({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="caption" muted style={[styles.shortcut, style]}>
      {children}
    </Typography>
  );
}

export const CommandSeparator = Separator;

const styles = StyleSheet.create({
  command: {
    width: '100%',
  },
  empty: {
    padding: 16,
    textAlign: 'center',
  },
  group: {
    gap: 4,
    paddingVertical: 4,
  },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    ...createMinTouchTargetStyle('height'),
    paddingHorizontal: 10,
  },
  list: {
    gap: 4,
  },
  shortcut: {
    marginLeft: 'auto',
  },
});
