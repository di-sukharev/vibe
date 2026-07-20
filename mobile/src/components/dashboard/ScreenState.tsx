import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';

type ScreenStateProps = {
  action?: ReactNode;
  description?: string;
  status: 'empty' | 'error' | 'loading';
  testID?: string;
  title?: string;
};

export function ScreenState({
  action,
  description,
  status,
  testID,
  title,
}: ScreenStateProps) {
  const theme = useUiTheme();

  if (status === 'error') {
    return (
      <Alert variant="destructive" testID={testID}>
        <AlertTitle>{title ?? 'Something went wrong'}</AlertTitle>
        {description ? <AlertDescription>{description}</AlertDescription> : null}
        {action ? <AlertAction>{action}</AlertAction> : null}
      </Alert>
    );
  }

  if (status === 'empty') {
    return (
      <Empty testID={testID}>
        <EmptyHeader>
          <EmptyTitle>{title ?? 'Nothing here yet'}</EmptyTitle>
          {description ? <EmptyDescription>{description}</EmptyDescription> : null}
        </EmptyHeader>
        {action ? <EmptyContent>{action}</EmptyContent> : null}
      </Empty>
    );
  }

  return (
    <View
      accessibilityLabel={title ?? 'Loading'}
      accessibilityRole="progressbar"
      style={[styles.loading, { gap: theme.spacing.md }]}
      testID={testID}>
      <Spinner />
      <Typography variant="bodySm" muted>
        {title ?? 'Loading'}
      </Typography>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
  },
});
