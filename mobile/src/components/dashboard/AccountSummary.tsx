import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { accountInitials } from './model';
import { SectionCard } from './SectionCard';

type AccountSummaryProps = {
  action?: ReactNode;
  badge?: string;
  description?: string;
  displayName: string | null;
  email: string;
  title?: string;
};

export function AccountSummary({
  action,
  badge,
  description,
  displayName,
  email,
  title = 'Account',
}: AccountSummaryProps) {
  const theme = useUiTheme();

  return (
    <SectionCard action={action} title={title}>
      <View style={[styles.account, { gap: theme.spacing.md }]}>
        <Avatar>
          <AvatarFallback>{accountInitials(displayName, email)}</AvatarFallback>
        </Avatar>
        <View style={[styles.copy, { gap: theme.spacing.xxs }]}>
          <Typography variant="body" weight="700">
            {displayName?.trim() || 'Member'}
          </Typography>
          <Typography variant="bodySm" muted>
            {email}
          </Typography>
          {description ? (
            <Typography variant="caption" muted>
              {description}
            </Typography>
          ) : null}
        </View>
        {badge ? <Badge variant="outline">{badge}</Badge> : null}
      </View>
    </SectionCard>
  );
}

const styles = StyleSheet.create({
  account: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
});
