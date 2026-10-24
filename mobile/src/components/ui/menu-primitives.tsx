import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type PressableProps, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { Checkbox } from './checkbox';
import { RadioGroupIndicator, useRadioGroupItem } from './radio-group';
import { shouldHandleMenuRadioRowPress } from './radio-utils';
import { Separator } from './separator';
import { renderTextChild, UiPressable, Typography } from './primitives';
import { useUiTheme } from './theme';
import { createMinTouchTargetStyle } from './touch-target';

export function MenuGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.group, style]}>
      {children}
    </View>
  );
}

export function MenuLabel({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="caption" weight="700" muted style={[styles.label, style]}>
      {children}
    </Typography>
  );
}

export function MenuItem({
  accessibilityRole = 'menuitem',
  children,
  inset,
  style,
  ...props
}: Omit<PressableProps, 'style'> & {
  children?: ReactNode;
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <UiPressable {...props} accessibilityRole={accessibilityRole} style={[styles.item, inset && styles.inset, style]}>
      {renderTextChild(children)}
    </UiPressable>
  );
}

export function MenuCheckboxItem({
  children,
  checked,
  disabled,
  onCheckedChange,
  ...props
}: Omit<PressableProps, 'style'> & {
  children?: ReactNode;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const isDisabled = disabled === true;

  return (
    <MenuItem
      {...props}
      disabled={isDisabled}
      onPress={(event) => {
        props.onPress?.(event);
        if (!isDisabled) {
          onCheckedChange?.(!checked);
        }
      }}>
      <Checkbox checked={checked} disabled={isDisabled} onCheckedChange={onCheckedChange} />
      <Typography variant="bodySm">{children}</Typography>
    </MenuItem>
  );
}

export function MenuRadioItem({
  children,
  disabled,
  value,
  ...props
}: Omit<PressableProps, 'style'> & { children?: ReactNode; value: string; style?: StyleProp<ViewStyle> }) {
  const { isDisabled, isSelected, select } = useRadioGroupItem(value, disabled === true);

  return (
    <MenuItem
      {...props}
      accessibilityRole="radio"
      accessibilityState={{ checked: isSelected, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={(event) => {
        props.onPress?.(event);
        if (shouldHandleMenuRadioRowPress(isDisabled)) {
          select();
        }
      }}>
      <RadioGroupIndicator value={value} disabled={isDisabled} />
      <Typography variant="bodySm">{children}</Typography>
    </MenuItem>
  );
}

export function MenuSeparator(props: ViewProps) {
  return <Separator {...props} />;
}

export function MenuShortcut({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="caption" muted style={[styles.shortcut, style]}>
      {children}
    </Typography>
  );
}

export function MenuSubTrigger({
  children,
  ...props
}: Omit<PressableProps, 'style' | 'children'> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <MenuItem {...props}>{children} &gt;</MenuItem>;
}

export function MenuSubContent({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View {...props} style={[styles.subContent, { borderColor: theme.colors.border }, style]}>
      {children}
    </View>
  );
}

export function MenuNoop({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

const styles = StyleSheet.create({
  group: {
    gap: 4,
  },
  inset: {
    paddingLeft: 32,
  },
  item: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    ...createMinTouchTargetStyle('height'),
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  label: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  shortcut: {
    marginLeft: 'auto',
  },
  subContent: {
    borderLeftWidth: 1,
    gap: 4,
    marginLeft: 16,
    paddingLeft: 8,
  },
});
