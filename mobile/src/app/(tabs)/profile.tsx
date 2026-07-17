import { KeyValueCard } from '@/components/key-value-card';
import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { Button } from '@/components/ui/button';
import { AuthSessionErrorNotice, useAuth } from '@/features/auth';
import { useSubscriptionIap } from '@/features/billing';

export default function ProfileScreen() {
  const auth = useAuth();
  const iap = useSubscriptionIap();

  if (!auth.user) return null;

  return (
    <Screen centered>
      <PageHeader
        eyebrow="Account"
        title={auth.user.displayName ?? 'Profile'}
        description={auth.user.email}
      />

      <AuthSessionErrorNotice />

      <KeyValueCard label="User ID" value={auth.user.id} />
      <KeyValueCard label="Subscription" value={subscriptionLabel(auth.user.subscription.state)} />

      {auth.user.subscription.platform === 'ios' || auth.user.subscription.platform === 'android' ? (
        <Button
          disabled={!iap.isConnected || iap.isManagingSubscriptions}
          loading={iap.isManagingSubscriptions}
          variant="outline"
          onPress={() => void iap.manageSubscriptions()}>
          Manage subscription
        </Button>
      ) : null}

      <Button
        disabled={auth.isTransitioning}
        loading={auth.isTransitioning}
        variant="outline"
        onPress={() => void auth.logout().catch(() => undefined)}>
        Logout
      </Button>
    </Screen>
  );
}

function subscriptionLabel(state: string) {
  return state.replaceAll('_', ' ');
}
