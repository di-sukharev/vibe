import type { SubscriptionSnapshot } from '@web-app-demo/contracts';

import { DataRow } from '@/components/dashboard/DataRow';
import { SectionCard } from '@/components/dashboard/SectionCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TEST_IDS } from '@/constants/testIds';
import {
  formatSubscriptionDate,
  formatSubscriptionPlatform,
  formatSubscriptionState,
} from './subscription-summary-model';

type SubscriptionSummaryProps = {
  error: string | null;
  isConnected: boolean;
  isManaging: boolean;
  isSupported: boolean;
  onManage: () => void;
  subscription: SubscriptionSnapshot | null;
};

export function SubscriptionSummary({
  error,
  isConnected,
  isManaging,
  isSupported,
  onManage,
  subscription,
}: SubscriptionSummaryProps) {
  // A missing snapshot means one of three different things, and each needs its own answer:
  // this build has no store, the read failed, or it has not answered yet.
  if (!subscription) {
    const pendingState = !isSupported
      ? 'Store subscriptions are only available in the iOS and Android app.'
      : error ?? 'Checking your subscription…';

    return (
      <SectionCard
        description="Store-backed entitlement details are verified by the backend."
        title="Subscription">
        <DataRow label="Status" value={pendingState} />
      </SectionCard>
    );
  }

  const canManage =
    subscription.platform === 'ios' || subscription.platform === 'android';
  const status = formatSubscriptionState(subscription.state);

  return (
    <SectionCard
      action={<Badge variant={subscription.isActive ? 'default' : 'outline'}>{status}</Badge>}
      description="Store-backed entitlement details are verified by the backend."
      footer={
        canManage ? (
          <Button
            disabled={!isConnected || isManaging}
            loading={isManaging}
            testID={TEST_IDS.profile.manageSubscriptionButton}
            variant="outline"
            onPress={onManage}>
            Manage subscription
          </Button>
        ) : undefined
      }
      title="Subscription">
      <DataRow label="Plan" value={subscription.productId ?? 'No active plan'} />
      <DataRow
        label="Store"
        value={formatSubscriptionPlatform(subscription.platform)}
      />
      <DataRow
        label={subscription.willAutoRenew ? 'Renews' : 'Access until'}
        value={formatSubscriptionDate(subscription.expiresAt)}
      />
    </SectionCard>
  );
}
