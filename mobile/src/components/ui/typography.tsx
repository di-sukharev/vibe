import type { ReactNode } from 'react';
import {
  Text,
  type ColorValue,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  useUiTheme,
  type UiTheme,
  type UiTypographyVariant,
} from './theme';

export const TYPOGRAPHY_VARIANTS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'bodyXl',
  'bodyLg',
  'body',
  'bodySm',
  'bodyXs',
  'caption',
  'label',
  'button',
  'link',
  'code',
] as const satisfies readonly UiTypographyVariant[];

export type TypographyVariant = (typeof TYPOGRAPHY_VARIANTS)[number];
export type TypographyColor = keyof UiTheme['colors'];
export type TypographyTextStyle = StyleProp<TextStyle | ViewStyle>;

export type TypographyProps = Omit<TextProps, 'style'> & {
  children?: ReactNode;
  align?: TextStyle['textAlign'];
  color?: TypographyColor;
  colorValue?: ColorValue;
  muted?: boolean;
  variant?: TypographyVariant;
  weight?: TextStyle['fontWeight'];
  style?: TypographyTextStyle;
};

export function Typography({
  align,
  children,
  color = 'foreground',
  colorValue,
  muted,
  style,
  variant = 'body',
  weight,
  ...props
}: TypographyProps) {
  const theme = useUiTheme();
  const textColor = colorValue ?? (muted ? theme.colors.mutedForeground : theme.colors[color]);

  return (
    <Text
      {...props}
      style={[
        theme.typography[variant],
        { color: textColor },
        align && { textAlign: align },
        weight && { fontWeight: weight },
        style as StyleProp<TextStyle>,
      ]}>
      {children}
    </Text>
  );
}
