export type IapDiagnosticPayload = {
  code: string | null;
  debugMessage?: string;
  message?: string;
  network: boolean;
  platform: string;
  productId?: string;
  responseCode?: number;
  retryable: boolean;
  underlyingError?: string;
};

export function trackIapDiagnostic(event: string, payload: IapDiagnosticPayload) {
  console.warn('[iap]', event, payload);
}
