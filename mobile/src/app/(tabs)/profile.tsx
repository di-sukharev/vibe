import { useMemo } from 'react';
import { Platform } from 'react-native';

import { AccountSummary, ScreenShell } from '@/components/dashboard';
import { TEST_IDS } from '@/constants/testIds';
import {
  AuthSessionErrorNotice,
  SessionControls,
  useAuth,
} from '@/features/auth';
import { avatarImageSource, AvatarControls, useAvatar } from '@/features/avatar';
// Subscriptions are turned off; see docs/IAP.md before uncommenting.
// import {
//   SubscriptionSummary,
//   useSubscriptionIap,
// } from '@/features/billing';

export default function ProfileScreen() {
  const auth = useAuth();
  const avatar = useAvatar();
  // const iap = useSubscriptionIap();

  // Kept stable across renders on purpose. On web this object identity is what expo-image keys
  // its fetch effect on, so a fresh one per render would re-download the signed photo on every
  // spinner or notice change. Above the early return, since it is a hook.
  const avatarImage = useMemo(
    () => avatarImageSource(avatar.avatar, Platform.OS),
    [avatar.avatar],
  );

  if (!auth.user) return null;

  return (
    <ScreenShell
      description="Review your identity and current device session."
      eyebrow="Account"
      testID={TEST_IDS.profile.screen}
      title="Profile">
      <AccountSummary
        avatarImage={avatarImage}
        avatarTestID={TEST_IDS.profile.avatarPreview}
        badge={auth.user.role === 'admin' ? 'Admin' : 'User'}
        description={`Member since ${formatAccountDate(auth.user.createdAt)}`}
        displayName={auth.user.displayName}
        email={auth.user.email}
      />

      <AvatarControls />

      <AuthSessionErrorNotice />

      {/* Uncomment with the billing provider (docs/IAP.md). The optional chaining is required:
          useSubscriptionIap() returns null whenever IapProvider is not mounted.
      <SubscriptionSummary
        error={iap?.error ?? null}
        isConnected={Boolean(iap?.isConnected)}
        isManaging={Boolean(iap?.isManagingSubscriptions)}
        isSupported={Boolean(iap?.isSupported)}
        onManage={() => void iap?.manageSubscriptions()}
        subscription={iap?.subscription ?? null}
      /> */}

      <SessionControls
        isLoggingOut={auth.isTransitioning}
        onLogout={() => void auth.logout().catch(() => undefined)}
      />
    </ScreenShell>
  );
}

function formatAccountDate(createdAt: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(createdAt));
}
