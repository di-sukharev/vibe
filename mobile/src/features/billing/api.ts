import {
  appStoreOfferCodeRedemptionResponseSchema,
  appStoreReconcileRequestSchema,
  appStoreTransactionRequestSchema,
  googlePlayReconcileRequestSchema,
  googlePlayTransactionRequestSchema,
  iapEntitlementResponseSchema,
  iapMutationResponseSchema,
  type AppStoreOfferCodeRedemptionResponse,
  type AppStoreReconcileRequest,
  type AppStoreTransactionRequest,
  type GooglePlayReconcileRequest,
  type GooglePlayTransactionRequest,
  type IapEntitlementResponse,
  type IapMutationResponse,
} from '@web-app-demo/contracts';

import type { ApiTransport } from '@/platform/api';

export class BillingApi {
  constructor(private readonly transport: ApiTransport) {}

  entitlement(): Promise<IapEntitlementResponse> {
    return this.transport.request('/api/iap/entitlement', iapEntitlementResponseSchema, {
      auth: true,
    });
  }

  ingestAppStoreTransaction(input: AppStoreTransactionRequest): Promise<IapMutationResponse> {
    return this.transport.request('/api/iap/app-store/transactions', iapMutationResponseSchema, {
      method: 'POST', body: appStoreTransactionRequestSchema.parse(input), auth: true,
    });
  }

  createAppStoreOfferCodeRedemption(): Promise<AppStoreOfferCodeRedemptionResponse> {
    return this.transport.request(
      '/api/iap/app-store/offer-code-redemption',
      appStoreOfferCodeRedemptionResponseSchema,
      { method: 'POST', auth: true },
    );
  }

  reconcileAppStoreTransactions(input: AppStoreReconcileRequest): Promise<IapMutationResponse> {
    return this.transport.request('/api/iap/app-store/reconcile', iapMutationResponseSchema, {
      method: 'POST', body: appStoreReconcileRequestSchema.parse(input), auth: true,
    });
  }

  ingestGooglePlayTransaction(input: GooglePlayTransactionRequest): Promise<IapMutationResponse> {
    return this.transport.request('/api/iap/google-play/transactions', iapMutationResponseSchema, {
      method: 'POST', body: googlePlayTransactionRequestSchema.parse(input), auth: true,
    });
  }

  reconcileGooglePlayTransactions(input: GooglePlayReconcileRequest = {}): Promise<IapMutationResponse> {
    return this.transport.request('/api/iap/google-play/reconcile', iapMutationResponseSchema, {
      method: 'POST', body: googlePlayReconcileRequestSchema.parse(input), auth: true,
    });
  }
}

export type BillingApiPort = BillingApi;
