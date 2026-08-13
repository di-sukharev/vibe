import { expect, test } from 'bun:test';

import {
  DASHBOARD_WIDE_BREAKPOINT,
  NAVIGATION_RAIL_WIDTH,
  accountInitials,
  dashboardNavigationMode,
} from '../src/components/dashboard/model';
import { uiColorTokens } from '../src/components/ui/theme-tokens';

function relativeLuminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4,
    );

  if (!channels || channels.length !== 3) {
    throw new Error(`Expected a six-digit hex color, received "${hex}".`);
  }

  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrastRatio(foreground: string, background: string) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

test('dashboard navigation keeps phones on tabs and moves wide web to a side rail', () => {
  expect(dashboardNavigationMode(DASHBOARD_WIDE_BREAKPOINT - 1)).toBe('tabs');
  expect(dashboardNavigationMode(DASHBOARD_WIDE_BREAKPOINT)).toBe('rail');
  expect(dashboardNavigationMode(DASHBOARD_WIDE_BREAKPOINT + 400)).toBe('rail');
  expect(NAVIGATION_RAIL_WIDTH).toBeGreaterThanOrEqual(200);
});

test('account initials stay useful for names, emails, and empty identities', () => {
  expect(accountInitials('  Ada Lovelace  ', 'ada@example.com')).toBe('AL');
  expect(accountInitials(null, 'member@example.com')).toBe('M');
  expect(accountInitials('Prince', 'prince@example.com')).toBe('P');
  expect(accountInitials(null, '')).toBe('?');
});

// Pinning the token values - a background hex, a radius ordering, a spacing step - asserted the
// design decisions back to themselves and made changing a brand colour a test failure. The
// contrast check below is kept: it computes a ratio and catches a real accessibility regression.

test('semantic muted-surface labels meet normal-text contrast in every theme', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const foreground of [
      uiColorTokens[scheme].mutedForeground,
      uiColorTokens[scheme].navigationForeground,
    ]) {
      expect(contrastRatio(foreground, uiColorTokens[scheme].muted)).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  }
});
