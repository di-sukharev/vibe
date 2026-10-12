export type IapDiagnosticPayload = {
  code: string | null;
  network: boolean;
  platform: string;
  productId?: string;
  responseCode?: number;
  retryable: boolean;
};

export function trackIapDiagnostic(event: string, payload: IapDiagnosticPayload) {
  console.warn('[iap]', event, payload);
}
