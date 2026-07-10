const offerCodeRedemptionClientTtlMs = 14 * 60 * 1000;

type OfferCodeRedemptionSession = {
  expiresAtMs: number;
  token: string;
};

export class OfferCodeRedemptionController {
  private session: OfferCodeRedemptionSession | null = null;

  clear() {
    this.session = null;
  }

  current(nowMs: number) {
    if (!this.session || this.session.expiresAtMs <= nowMs) {
      this.session = null;
      return null;
    }
    return this.session.token;
  }

  store(token: string, nowMs: number) {
    this.session = {
      expiresAtMs: nowMs + offerCodeRedemptionClientTtlMs,
      token,
    };
  }
}
