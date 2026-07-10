import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from 'bun:test';

const repoRoot = resolve(import.meta.dir, '../..');

test('alternative billing remains deferred unless product scope is updated', () => {
  const appConfig = readFileSync(resolve(repoRoot, 'mobile/app.config.js'), 'utf8');
  const iapProvider = readFileSync(
    resolve(repoRoot, 'mobile/src/features/billing/provider.tsx'),
    'utf8',
  );
  const docs = readFileSync(resolve(repoRoot, 'docs/IAP.md'), 'utf8');

  expect(appConfig).not.toContain('iosAlternativeBilling');
  expect(appConfig).not.toContain('enableExternalPurchaseLink');
  expect(iapProvider).not.toContain('enableBillingProgramAndroid');
  expect(iapProvider).not.toContain('presentExternalPurchaseLinkIOS');
  expect(iapProvider).not.toContain('launchExternalLinkAndroid');
  expect(iapProvider).not.toContain('createBillingProgramReportingDetailsAndroid');
  expect(docs).toContain('Before enabling alternative billing or external purchase links');
  expect(docs).toContain('report it to Google within the required window');
});
