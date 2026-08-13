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
  /**
   * A photo to show instead of the initials. Presentational: this component fetches nothing.
   *
   * The URI and its cache key travel as one value because a signed URI is re-signed on every
   * read: keyed on the URI alone, every refetch would miss the cache and a cached entry could
   * hand the loader an already-expired signature. Two optional props would let a caller supply
   * the URI without the key and reintroduce exactly that.
   */
  avatarImage?: { cacheKey: string; headers?: Record<string, string>; uri: string } | null;
  avatarTestID?: string;
  badge?: string;
  description?: string;
  displayName: string | null;
  email: string;
  title?: string;
};

export function AccountSummary({
  action,
  avatarImage,
  avatarTestID,
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
          {avatarImage ? (
            <AvatarImage
              // Decorative: the name it stands for is read out right beside it. Both props are
              // needed. `accessible` is what hides it on iOS and Android, and react-native-web
              // does not forward that prop at all - on web the `<img>` is labelled from
              // `accessibilityLabel`, so without an empty one it ships with no `alt` and a
              // screen reader announces the blob: URL next to the name it repeats. `alt` is not
              // the web answer here: expo-image reads it only for a placeholder node, which
              // this avatar does not render.
              accessible={false}
              accessibilityLabel=""
              cachePolicy="memory-disk"
              contentFit="cover"
              source={avatarImage}
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
