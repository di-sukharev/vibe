import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import {
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { Button } from './button';
import { CommandEmpty, CommandGroup, CommandItem, CommandList } from './command';
import { Input } from './input';
import { OverlayContent, OverlayRoot, OverlayTrigger } from './overlay';
import { Separator } from './separator';
import { Badge } from './badge';
import { Typography } from './primitives';

export const Combobox = OverlayRoot;
export const ComboboxTrigger = OverlayTrigger;
export const ComboboxContent = OverlayContent;
export const ComboboxList = CommandList;
export const ComboboxItem = CommandItem;
export const ComboboxGroup = CommandGroup;
export const ComboboxEmpty = CommandEmpty;
export const ComboboxSeparator = Separator;

export function ComboboxInput(props: TextInputProps) {
  return <Input {...props} />;
}

export function ComboboxLabel({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="caption" weight="700" muted style={[styles.label, style]}>
      {children}
    </Typography>
  );
}

export function ComboboxCollection({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}

export function ComboboxChips({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.chips, style]}>
      {children}
    </View>
  );
}

export function ComboboxChip({
  children,
  ...props
}: Omit<PressableProps, 'style'> & { children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <Badge {...props} variant="secondary">{children}</Badge>;
}

export function ComboboxChipsInput(props: TextInputProps) {
  return <Input {...props} style={[styles.chipsInput, props.style]} />;
}

export function ComboboxValue({ children, placeholder = 'Select' }: { children?: ReactNode; placeholder?: ReactNode }) {
  return (
    <Typography variant="bodySm" muted={!children}>
      {children ?? placeholder}
    </Typography>
  );
}

export function useComboboxAnchor() {
  return null;
}

export function ComboboxDemoTrigger({ children }: { children?: ReactNode }) {
  return <Button variant="outline">{children}</Button>;
}

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chipsInput: {
    minWidth: 120,
  },
  label: {
    paddingHorizontal: 10,
  },
});
