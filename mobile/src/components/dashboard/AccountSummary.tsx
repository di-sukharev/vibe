import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { accountInitials } from './model';
import { SectionCard } from './SectionCard';

type AccountSummaryProps = {
  action?: ReactNode;
  /** Cache key for the photo. Required alongside `avatarUri` when the URI is short-lived. */
  avatarCacheKey?: string;
  avatarTestID?: string;
  /** A photo to show instead of the initials. Presentational: this component fetches nothing. */
  avatarUri?: string | null;
  badge?: string;
  description?: string;
  displayName: string | null;
  email: string;
  title?: string;
};

export function AccountSummary({
  action,
  avatarCacheKey,
  avatarTestID,
  avatarUri,
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
        <Avatar testID={avatarTestID}>
          {/*
            The fallback stays mounted underneath: AvatarImage is absolutely positioned, so the
            initials show while the photo loads and remain if it never does.
          */}
          <AvatarFallback>{accountInitials(displayName, email)}</AvatarFallback>
          {avatarUri ? (
            <AvatarImage
              // Decorative: the name it stands for is read out right beside it.
              accessible={false}
              cachePolicy="memory-disk"
              contentFit="cover"
              source={{ cacheKey: avatarCacheKey, uri: avatarUri }}
              transition={120}
            />
          ) : null}
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
