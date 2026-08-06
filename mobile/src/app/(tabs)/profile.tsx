import { AccountSummary, ScreenShell } from '@/components/dashboard';
import { TEST_IDS } from '@/constants/testIds';
import {
  AuthSessionErrorNotice,
  SessionControls,
  useAuth,
} from '@/features/auth';
import {
  SubscriptionSummary,
  useSubscriptionIap,
} from '@/features/billing';

export default function ProfileScreen() {
  const auth = useAuth();
  const iap = useSubscriptionIap();

  if (!auth.user) return null;

  return (
    <ScreenShell
      description="Review your identity, entitlement, and current device session."
      eyebrow="Account"
      testID={TEST_IDS.profile.screen}
      title="Profile">
      <AccountSummary
        badge={auth.user.role === 'admin' ? 'Admin' : 'User'}
        description={`Member since ${formatAccountDate(auth.user.createdAt)}`}
        displayName={auth.user.displayName}
        email={auth.user.email}
      />

      <AuthSessionErrorNotice />

      <SubscriptionSummary
        error={iap.error}
        isConnected={iap.isConnected}
        isManaging={iap.isManagingSubscriptions}
        isSupported={iap.isSupported}
        onManage={() => void iap.manageSubscriptions()}
        subscription={iap.subscription}
      />

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
