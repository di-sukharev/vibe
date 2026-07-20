import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useUiTheme } from '@/components/ui/theme';

type SectionCardProps = {
  action?: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  testID?: string;
  title: ReactNode;
};

export function SectionCard({
  action,
  children,
  description,
  footer,
  testID,
  title,
}: SectionCardProps) {
  const theme = useUiTheme();

  return (
    <Card testID={testID}>
      <CardHeader>
        <View style={[styles.heading, { gap: theme.spacing.lg }]}>
          <View style={[styles.copy, { gap: theme.spacing.xs }]}>
            <CardTitle>{title}</CardTitle>
            {description ? <CardDescription>{description}</CardDescription> : null}
          </View>
          {action ? <CardAction>{action}</CardAction> : null}
        </View>
      </CardHeader>
      <CardContent>
        <View style={{ gap: theme.spacing.lg }}>{children}</View>
      </CardContent>
      {footer ? <CardFooter>{footer}</CardFooter> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  copy: {
    flex: 1,
    minWidth: 0,
  },
  heading: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
