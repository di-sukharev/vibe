import type { TypographyProps } from './typography';
import type { ReactNode } from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';

import { Button, type ButtonProps } from './button';
import { Input, type InputProps } from './input';
import { Textarea } from './textarea';
import { renderTextChild, Typography } from './primitives';
import { useUiTheme } from './theme';

export function InputGroup({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  const theme = useUiTheme();
  return (
    <View
      {...props}
      style={[styles.group, { borderColor: theme.colors.input, borderRadius: theme.radius.xxl }, style]}>
      {children}
    </View>
  );
}

export function InputGroupAddon({ children, style, ...props }: ViewProps & { children?: ReactNode }) {
  return (
    <View {...props} style={[styles.addon, style]}>
      {renderTextChild(children, undefined, 'mutedForeground')}
    </View>
  );
}

export function InputGroupButton(props: ButtonProps) {
  return <Button {...props} />;
}

export function InputGroupText({ children, style, ...props }: TypographyProps) {
  return (
    <Typography {...props} variant="bodySm" muted style={style}>
      {children}
    </Typography>
  );
}

export function InputGroupInput(props: InputProps) {
  return <Input {...props} style={[styles.input, props.style]} />;
}

export function InputGroupTextarea(props: InputProps) {
  return <Textarea {...props} style={[styles.input, props.style]} />;
}

const styles = StyleSheet.create({
  addon: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  group: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: 4,
  },
  input: {
    borderWidth: 0,
    flex: 1,
  },
});
