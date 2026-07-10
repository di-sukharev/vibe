import { expect, test } from 'bun:test';

import { OfferCodeRedemptionController } from '../src/features/billing/offer-code-controller';

test('offer-code controller owns token expiry lifecycle with an explicit clock', () => {
  const controller = new OfferCodeRedemptionController();
  const now = Date.parse('2026-07-10T12:00:00.000Z');

  controller.store('redemption-token', now);
  expect(controller.current(now + 13 * 60 * 1000)).toBe('redemption-token');
  expect(controller.current(now + 15 * 60 * 1000)).toBeNull();

  controller.store('next-token', now);
  controller.clear();
  expect(controller.current(now)).toBeNull();
});
