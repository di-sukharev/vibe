import type { ProductSubscription } from 'expo-iap';
import { Redirect, useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { PageHeader } from '@/components/page-header';
import { Screen } from '@/components/screen';
import { ScreenLoader } from '@/components/screen-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Typography } from '@/components/ui/typography';
import { TEST_IDS } from '@/constants/testIds';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';
import { useSubscriptionIap } from '@/lib/iap';
import { introOfferLabel } from '@/lib/iap-utils';

type PaywallPlan = {
  displayName: string;
  displayPrice: string;
  id: string;
  product: ProductSubscription;
  productId: string;
};

export default function PaywallScreen() {
  const auth = useAuth();
  const router = useRouter();
  const iap = useSubscriptionIap();
  const colors = useTheme();

  if (auth.isBootstrapping) {
    return <ScreenLoader />;
  }

  if (!auth.user) {
    return <Redirect href="/" />;
  }

  if (auth.user.subscription.isActive) {
    return <Redirect href="/components" />;
  }

  if (!iap.isSupported) {
    return (
      <Screen centered testID={TEST_IDS.paywall.screen}>
        <PageHeader
          eyebrow="Premium"
          title="Subscriptions are not available here."
          description="Open this screen in the iOS or Android app to subscribe through the native store. Your account, profile, and logout remain available."
        />
        <View style={styles.actions}>
          <Button testID={TEST_IDS.paywall.profileButton} onPress={() => router.push('/profile')} variant="outline">
            Profile
          </Button>
          <Button testID={TEST_IDS.auth.logoutButton} onPress={() => void auth.logout()} variant="outline">
            Logout
          </Button>
        </View>
      </Screen>
    );
  }

  const selectedPlan = iap.plans.find((plan) => plan.id === iap.selectedPlanId) ?? null;
  const isPrimaryLoading = iap.isPurchasing || iap.isSyncing;
  const isConnecting = !iap.isConnected && !iap.error;
  const isProductListEmpty = iap.isConnected && !iap.isLoadingProducts && iap.plans.length === 0;
  const storeName = iap.platform === 'android' ? 'Google Play' : 'App Store';

  return (
    <Screen
      scroll
      contentStyle={styles.content}
      scrollViewProps={{ showsVerticalScrollIndicator: false }}
      testID={TEST_IDS.paywall.screen}>
      <PageHeader
        eyebrow="Premium"
        title="Unlock the full component workspace."
        description={`Subscribe through ${storeName}. The backend verifies every transaction before premium access is granted.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Choose a plan</CardTitle>
          <CardDescription>Monthly and yearly plans are managed by the store and can be restored any time.</CardDescription>
        </CardHeader>
        <CardContent style={styles.cardContent}>
          {iap.isLoadingProducts && iap.products.length === 0 ? (
            <View style={styles.loadingRow} testID={TEST_IDS.paywall.loading}>
              <Spinner />
              <Typography muted>Loading {storeName} products...</Typography>
            </View>
          ) : null}

          {isConnecting ? (
            <View style={styles.loadingRow} testID={TEST_IDS.paywall.loading}>
              <Spinner />
              <Typography muted>Connecting to {storeName}...</Typography>
            </View>
          ) : null}

          {isProductListEmpty ? (
            <View
              style={[
                styles.notice,
                {
                  backgroundColor: colors.backgroundElement,
                },
              ]}
              testID={TEST_IDS.paywall.empty}>
              <Typography weight="600">Products are not available yet.</Typography>
              <Typography muted>
                Check the product IDs, base plans, store status, tester account, real-device build, and custom dev-client.
              </Typography>
            </View>
          ) : null}

          {iap.plans.map((plan) => (
            <PlanOption
              key={plan.id}
              plan={plan}
              selected={plan.id === selectedPlan?.id}
              onPress={() => iap.setSelectedPlanId(plan.id)}
            />
          ))}
        </CardContent>
      </Card>

      {iap.error ? (
        <View
          style={[
            styles.notice,
            {
              backgroundColor: colors.backgroundElement,
            },
          ]}
          testID={TEST_IDS.paywall.error}>
          <Typography weight="600">Subscription is not ready.</Typography>
          <Typography muted>{iap.error}</Typography>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          disabled={!selectedPlan || isPrimaryLoading}
          loading={iap.isPurchasing}
          onPress={() => void iap.purchase()}
          testID={TEST_IDS.paywall.purchaseButton}>
          {selectedPlan ? `Subscribe for ${selectedPlan.displayPrice}` : 'Subscribe'}
        </Button>
        <Button
          disabled={!iap.isConnected || iap.isRestoring || iap.isPurchasing}
          loading={iap.isRestoring}
          onPress={() => void iap.restore()}
          testID={TEST_IDS.paywall.restoreButton}
          variant="outline">
          Restore purchases
        </Button>
        {iap.platform === 'ios' ? (
          <Button
            disabled={!iap.isConnected || iap.isRedeemingOfferCode || iap.isPurchasing}
            loading={iap.isRedeemingOfferCode}
            onPress={() => void iap.redeemOfferCode()}
            testID={TEST_IDS.paywall.redeemOfferCodeButton}
            variant="outline">
            Redeem offer code
          </Button>
        ) : null}
      </View>

      <View style={styles.footerActions}>
        <Button onPress={() => router.push('/profile')} variant="ghost">
          Profile
        </Button>
        <Button onPress={() => void auth.logout()} variant="ghost">
          Logout
        </Button>
      </View>
    </Screen>
  );
}

function PlanOption({
  onPress,
  plan,
  selected,
}: {
  onPress: () => void;
  plan: PaywallPlan;
  selected: boolean;
}) {
  const colors = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.plan,
        {
          backgroundColor: selected ? colors.backgroundSelected : colors.backgroundElement,
          borderColor: selected ? colors.text : colors.backgroundElement,
        },
      ]}
      testID={`${TEST_IDS.paywall.planOption}.${plan.id}`}>
      <View style={styles.planText}>
        <Typography weight="600">{plan.displayName}</Typography>
        <Typography muted>{plan.product.description || plan.productId}</Typography>
        {introOfferLabel(plan.product) ? <Typography muted>{introOfferLabel(plan.product)}</Typography> : null}
      </View>
      <Typography weight="700">{plan.displayPrice}</Typography>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  actions: {
    gap: Spacing.two,
  },
  cardContent: {
    gap: Spacing.two,
  },
  content: {
    paddingBottom: Spacing.five,
  },
  footerActions: {
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'center',
  },
  loadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.two,
  },
  notice: {
    borderRadius: 8,
    gap: Spacing.one,
    padding: Spacing.three,
  },
  plan: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: Spacing.two,
    justifyContent: 'space-between',
    minHeight: 72,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  planText: {
    flex: 1,
    gap: Spacing.half,
  },
});
