import { StyleSheet, View } from 'react-native';

import { ScreenState } from '@/components/dashboard/ScreenState';
import { SectionCard } from '@/components/dashboard/SectionCard';
import { Button } from '@/components/ui/button';
import { UiPressable } from '@/components/ui/primitives';
import { useUiTheme } from '@/components/ui/theme';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';

export type PaywallPlanPresentation = {
  description: string;
  displayName: string;
  displayPrice: string;
  id: string;
  introOfferLabel: string | null;
  productId: string;
};

type PaywallPlanSelectorProps = {
  isConnecting: boolean;
  isEmpty?: boolean;
  isLoading: boolean;
  onSelect: (planId: string) => void;
  plans: PaywallPlanPresentation[];
  selectedPlanId: string | null;
  storeName: string;
};

export function PaywallPlanSelector({
  isConnecting,
  isEmpty,
  isLoading,
  onSelect,
  plans,
  selectedPlanId,
  storeName,
}: PaywallPlanSelectorProps) {
  const showEmpty = isEmpty ?? (!isLoading && !isConnecting && plans.length === 0);

  return (
    <SectionCard
      description="Monthly and yearly plans are managed by the store and can be restored at any time."
      title="Choose a plan">
      <View
        accessibilityLabel="Choose a subscription plan"
        accessibilityRole="radiogroup"
        style={styles.planList}
        testID={TEST_IDS.paywall.planGroup}>
        {isLoading ? (
          <ScreenState
            status="loading"
            testID={TEST_IDS.paywall.loading}
            title={`Loading ${storeName} products...`}
          />
        ) : isConnecting ? (
          <ScreenState
            status="loading"
            testID={TEST_IDS.paywall.loading}
            title={`Connecting to ${storeName}...`}
          />
        ) : showEmpty ? (
          <ScreenState
            description="Check the store product configuration, tester account, real-device build, and custom development client."
            status="empty"
            testID={TEST_IDS.paywall.empty}
            title="Products are not available yet"
          />
        ) : (
          plans.map((plan) => (
            <PaywallPlanOption
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedPlanId}
              onPress={() => onSelect(plan.id)}
            />
          ))
        )}
      </View>
    </SectionCard>
  );
}

export function PaywallErrorNotice({ message }: { message: string }) {
  return (
    <ScreenState
      description={message}
      status="error"
      testID={TEST_IDS.paywall.error}
      title="Subscription is not ready"
    />
  );
}

type PaywallActionsProps = {
  canRestore: boolean;
  isPurchasing: boolean;
  isRedeemingOfferCode: boolean;
  isRestoring: boolean;
  isSyncing: boolean;
  onPurchase: () => void;
  onRedeemOfferCode: () => void;
  onRestore: () => void;
  platform: 'android' | 'ios';
  selectedPlanPrice: string | null;
};

export function PaywallActions({
  canRestore,
  isPurchasing,
  isRedeemingOfferCode,
  isRestoring,
  isSyncing,
  onPurchase,
  onRedeemOfferCode,
  onRestore,
  platform,
  selectedPlanPrice,
}: PaywallActionsProps) {
  return (
    <SectionCard
      description="Access is granted only after the backend verifies the store transaction."
      title="Complete subscription">
      <View style={styles.actionStack}>
        <Button
          disabled={!selectedPlanPrice || isPurchasing || isSyncing}
          loading={isPurchasing}
          onPress={onPurchase}
          testID={TEST_IDS.paywall.purchaseButton}>
          {selectedPlanPrice
            ? `Subscribe for ${selectedPlanPrice}`
            : 'Select a plan to subscribe'}
        </Button>
        <Button
          disabled={!canRestore || isRestoring || isPurchasing}
          loading={isRestoring}
          onPress={onRestore}
          testID={TEST_IDS.paywall.restoreButton}
          variant="outline">
          Restore purchases
        </Button>
        {platform === 'ios' ? (
          <Button
            disabled={!canRestore || isRedeemingOfferCode || isPurchasing}
            loading={isRedeemingOfferCode}
            onPress={onRedeemOfferCode}
            testID={TEST_IDS.paywall.redeemOfferCodeButton}
            variant="outline">
            Redeem offer code
          </Button>
        ) : null}
      </View>
    </SectionCard>
  );
}

type PaywallAccountActionsProps = {
  isLoggingOut: boolean;
  onLogout: () => void;
  onProfile: () => void;
};

export function PaywallAccountActions({
  isLoggingOut,
  onLogout,
  onProfile,
}: PaywallAccountActionsProps) {
  return (
    <SectionCard
      description="Your profile and session controls remain available without an active subscription."
      title="Account access">
      <View style={styles.accountActions}>
        <Button
          testID={TEST_IDS.paywall.profileButton}
          onPress={onProfile}
          variant="outline">
          Profile
        </Button>
        <Button
          disabled={isLoggingOut}
          loading={isLoggingOut}
          testID={TEST_IDS.auth.logoutButton}
          onPress={onLogout}
          variant="ghost">
          Logout
        </Button>
      </View>
    </SectionCard>
  );
}

function PaywallPlanOption({
  onPress,
  plan,
  selected,
}: {
  onPress: () => void;
  plan: PaywallPlanPresentation;
  selected: boolean;
}) {
  const theme = useUiTheme();

  return (
    <UiPressable
      accessibilityLabel={`${plan.displayName}, ${plan.displayPrice}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        styles.plan,
        {
          backgroundColor: selected ? theme.colors.accent : theme.colors.muted,
          borderColor: selected ? theme.colors.foreground : theme.colors.border,
          borderRadius: theme.radius.xl,
          gap: theme.spacing.md,
          padding: theme.spacing.lg,
        },
      ]}
      testID={`${TEST_IDS.paywall.planOption}.${plan.id}`}>
      <View style={[styles.planCopy, { gap: theme.spacing.xxs }]}>
        <Typography weight="700">{plan.displayName}</Typography>
        <Typography variant="bodySm" muted>
          {plan.description || plan.productId}
        </Typography>
        {plan.introOfferLabel ? (
          <Typography variant="bodySm" muted>
            {plan.introOfferLabel}
          </Typography>
        ) : null}
      </View>
      <Typography variant="body" weight="700">
        {plan.displayPrice}
      </Typography>
    </UiPressable>
  );
}

const styles = StyleSheet.create({
  accountActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionStack: {
    gap: 8,
  },
  plan: {
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 72,
  },
  planCopy: {
    flex: 1,
    minWidth: 0,
  },
  planList: {
    gap: 8,
  },
});
