import { View, type ViewProps, type ViewStyle } from 'react-native';
import type { Edge } from 'react-native-safe-area-context';

const paddingByEdge = {
  top: 'paddingTop',
  right: 'paddingRight',
  bottom: 'paddingBottom',
  left: 'paddingLeft',
} as const;

export function SafeAreaView({
  edges = ['top', 'right', 'bottom', 'left'],
  style,
  ...props
}: ViewProps & { edges?: readonly Edge[] }) {
  const safeAreaStyle = Object.fromEntries(
    edges.map((edge) => [paddingByEdge[edge], `env(safe-area-inset-${edge}, 0px)`]),
  ) as ViewStyle;

  return <View {...props} style={[safeAreaStyle, style]} />;
}
