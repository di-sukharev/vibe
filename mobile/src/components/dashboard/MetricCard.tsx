import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { StyleSheet, View } from 'react-native';

import { Surface } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';

type MetricCardProps = {
  description?: string;
  icon?: SymbolViewProps['name'];
  label: string;
  testID?: string;
  value: number | string;
};

export function MetricCard({
  description,
  icon,
  label,
  testID,
  value,
}: MetricCardProps) {
  const theme = useUiTheme();

  return (
    <Surface
      bordered
      padded="lg"
      rounded="xxl"
      testID={testID}
      style={[styles.root, { gap: theme.spacing.lg }]}>
      <View style={[styles.heading, { gap: theme.spacing.md }]}>
        <Typography variant="bodySm" muted>
          {label}
        </Typography>
        {icon ? (
          <Surface
            rounded="full"
            tone="muted"
            style={[styles.icon, { backgroundColor: theme.colors.muted }]}>
            <SymbolView name={icon} size={18} tintColor={theme.colors.foreground} />
          </Surface>
        ) : null}
      </View>
      <Typography variant="h5" weight="700">
        {value}
      </Typography>
      {description ? (
        <Typography variant="bodySm" muted>
          {description}
        </Typography>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  heading: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  icon: {
    alignItems: 'center',
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  root: {
    flexGrow: 1,
    minWidth: 220,
  },
});
