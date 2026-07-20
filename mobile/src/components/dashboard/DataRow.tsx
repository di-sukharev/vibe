import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { UiPressable } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';

type DataRowProps = {
  description?: string;
  label: string;
  leading?: ReactNode;
  onPress?: () => void;
  testID?: string;
  trailing?: ReactNode;
  value?: string;
};

export function DataRow({
  description,
  label,
  leading,
  onPress,
  testID,
  trailing,
  value,
}: DataRowProps) {
  const theme = useUiTheme();
  const content = (
    <>
      {leading}
      <View style={[styles.copy, { gap: theme.spacing.xxs }]}>
        <Typography variant="bodySm" weight="700">
          {label}
        </Typography>
        {description ? (
          <Typography variant="caption" muted>
            {description}
          </Typography>
        ) : null}
      </View>
      {value ? (
        <Typography variant="bodySm" muted>
          {value}
        </Typography>
      ) : null}
      {trailing}
    </>
  );
  const rowStyle = [
    styles.row,
    {
      borderBottomColor: theme.colors.border,
      gap: theme.spacing.md,
      minHeight: 52,
      paddingVertical: theme.spacing.sm,
    },
  ];

  if (onPress) {
    return (
      <UiPressable
        accessibilityLabel={label}
        accessibilityRole="button"
        onPress={onPress}
        style={rowStyle}
        testID={testID}>
        {content}
      </UiPressable>
    );
  }

  return (
    <View style={rowStyle} testID={testID}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
  },
});
