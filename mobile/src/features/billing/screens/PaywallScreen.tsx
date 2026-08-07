import { Redirect, useRouter } from 'expo-router';

import { ScreenShell } from '@/components/dashboard';
import { ScreenLoader } from '@/components/screen-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { TEST_IDS } from '@/constants/testIds';
import { AuthSessionErrorNotice, useAuth } from '@/features/auth';
import { useSubscriptionIap } from '../provider';
import { paywallViewState } from './paywall-view-state';
import {
  PaywallAccountActions,
  PaywallActions,
  PaywallErrorNotice,
  PaywallPlanSelector,
} from '../components/paywall-components';

export function PaywallScreen() {
  const auth = useAuth();
  const router = useRouter();
  const iap = useSubscriptionIap();

  const viewState = paywallViewState({
    isBillingMounted: Boolean(iap),
    isBootstrapping: auth.isBootstrapping,
    isSignedIn: Boolean(auth.user),
    isStoreSupported: Boolean(iap?.isSupported),
    isSubscribed: Boolean(iap?.subscription?.isActive),
  });

  if (viewState === 'loading') {
    return <ScreenLoader />;
  }

  if (viewState === 'signed-out') {
    return <Redirect href="/" />;
  }

  // The `!iap` half is not redundant: it narrows the context for the branches below.
  if (viewState === 'billing-off' || !iap) {
    return (
      <ScreenShell
        centered
        description="This screen is the template's subscription flow, kept ready but switched off."
        eyebrow="Premium"
        testID={TEST_IDS.paywall.screen}
        title="Subscriptions are not enabled.">
        <Alert>
          <AlertTitle>Nothing is for sale in this project yet</AlertTitle>
          <AlertDescription>
            The purchase flow, store verification, and receipts are implemented and waiting. Turn
            them on by following “How To Turn Subscriptions On” in docs/IAP.md.
          </AlertDescription>
        </Alert>
        <AuthSessionErrorNotice />
        <PaywallAccountActions
          isLoggingOut={auth.isTransitioning}
          onLogout={() => void auth.logout().catch(() => undefined)}
          onProfile={() => router.push('/profile')}
        />
      </ScreenShell>
    );
  }

  if (viewState === 'subscribed') {
    return (
      <ScreenShell
        centered
        description="Your subscription is active. Manage or review it any time from your profile."
        eyebrow="Premium"
        testID={TEST_IDS.paywall.screen}
        title="You're subscribed.">
        <AuthSessionErrorNotice />
        <PaywallAccountActions
          isLoggingOut={auth.isTransitioning}
          onLogout={() => void auth.logout().catch(() => undefined)}
          onProfile={() => router.push('/profile')}
        />
      </ScreenShell>
    );
  }

  if (viewState === 'unsupported') {
    return (
      <ScreenShell
        centered
        description="Open this screen in the iOS or Android app to subscribe through the native store."
        eyebrow="Premium"
        testID={TEST_IDS.paywall.screen}
        title="Subscriptions are not available here.">
        <AuthSessionErrorNotice />
        <PaywallAccountActions
          isLoggingOut={auth.isTransitioning}
          onLogout={() => void auth.logout().catch(() => undefined)}
          onProfile={() => router.push('/profile')}
        />
      </ScreenShell>
    );
  }

  const selectedPlan = iap.plans.find((plan) => plan.id === iap.selectedPlanId) ?? null;
  const isConnecting = !iap.isConnected && !iap.error;
  const isProductListEmpty = iap.isConnected && !iap.isLoadingProducts && iap.plans.length === 0;
  const storeName = iap.platform === 'android' ? 'Google Play' : 'App Store';
  const planPresentations = iap.plans.map((plan) => ({
    description: plan.product.description,
    displayName: plan.displayName,
    displayPrice: plan.displayPrice,
    id: plan.id,
    introOfferLabel: plan.introOfferLabel,
    productId: plan.productId,
  }));

  return (
    <ScreenShell
      description={`Subscribe through ${storeName}. The backend verifies every transaction before premium access is granted.`}
      eyebrow="Premium"
      testID={TEST_IDS.paywall.screen}
      title="Unlock the full component workspace.">

      <AuthSessionErrorNotice />

      <PaywallPlanSelector
        isConnecting={isConnecting}
        isEmpty={isProductListEmpty}
        isLoading={iap.isLoadingProducts && iap.products.length === 0}
        plans={planPresentations}
        selectedPlanId={selectedPlan?.id ?? null}
        storeName={storeName}
        onSelect={iap.setSelectedPlanId}
      />

      {iap.error ? <PaywallErrorNotice message={iap.error} /> : null}

      <PaywallActions
        canRestore={iap.isConnected}
        isPurchasing={iap.isPurchasing}
        isRedeemingOfferCode={iap.isRedeemingOfferCode}
        isRestoring={iap.isRestoring}
        isSyncing={iap.isSyncing}
        onPurchase={() => void iap.purchase()}
        onRedeemOfferCode={() => void iap.redeemOfferCode()}
        onRestore={() => void iap.restore()}
        platform={iap.platform === 'android' ? 'android' : 'ios'}
        selectedPlanPrice={selectedPlan?.displayPrice ?? null}
      />

      <PaywallAccountActions
        isLoggingOut={auth.isTransitioning}
        onLogout={() => void auth.logout().catch(() => undefined)}
        onProfile={() => router.push('/profile')}
      />
    </ScreenShell>
  );
}
