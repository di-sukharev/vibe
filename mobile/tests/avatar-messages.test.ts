import { describe, expect, test } from 'bun:test';

import { avatarRemoveErrorMessage, avatarUploadErrorMessage } from '../src/features/avatar/avatar-messages';
import {
  avatarCacheKey,
  avatarResizePlan,
  avatarTargetEdgePixels,
} from '../src/features/avatar/image-source';
import { ApiRequestError } from '../src/platform/api';
import { UploadTransferError } from '../src/platform/uploads';

describe('avatarUploadErrorMessage', () => {
  test('gives each recoverable backend failure its own instruction', () => {
    // The backend distinguishes these three on purpose; collapsing them would throw away the
    // only thing that tells someone what to do next.
    const messages = ['UPLOAD_NOT_COMPLETED', 'UPLOAD_EXPIRED', 'UPLOAD_REJECTED'].map((code) =>
      avatarUploadErrorMessage(new ApiRequestError(409, code, 'server copy')),
    );

    expect(new Set(messages).size).toBe(3);
    expect(messages[0]).toContain('again');
    expect(messages[1]).toContain('start over');
    expect(messages[2]).toContain('JPEG');
  });

  test('passes a transfer failure through with its own wording', () => {
    for (const reason of ['size-changed', 'transfer-failed'] as const) {
      const message = avatarUploadErrorMessage(new UploadTransferError(reason, `copy for ${reason}`));
      expect(message).toBe(`copy for ${reason}`);
    }
  });

  test('falls back without inventing an explanation it does not have', () => {
    expect(avatarUploadErrorMessage(new ApiRequestError(500, 'INTERNAL_ERROR', 'boom'))).toBe('boom');
    expect(avatarUploadErrorMessage('not an error')).toBe('Something went wrong. Try again.');
    expect(avatarRemoveErrorMessage(new Error('nope'))).toBe('nope');
  });
});

describe('avatarResizePlan', () => {
  test('leaves an image that is already small enough untouched', () => {
    // Re-encoding a small image at a larger target would make the file bigger, not smaller.
    expect(avatarResizePlan({ height: 200, width: 200 })).toBeNull();
    expect(avatarResizePlan({ height: avatarTargetEdgePixels, width: 100 })).toBeNull();
  });

  test('constrains only the longer edge, so the aspect ratio is preserved', () => {
    expect(avatarResizePlan({ height: 1200, width: 4000 })).toEqual({ width: avatarTargetEdgePixels });
    expect(avatarResizePlan({ height: 4000, width: 1200 })).toEqual({ height: avatarTargetEdgePixels });
    expect(avatarResizePlan({ height: 4000, width: 4000 })).toEqual({ width: avatarTargetEdgePixels });
  });
});

describe('avatarCacheKey', () => {
  test('changes when the photo is replaced', () => {
    // expo-image keys on the URL by default, and the signed URL changes on every read. Without a
    // key tied to identity, a replaced photo could be served from the previous one's cache entry.
    const first = avatarCacheKey({ byteSize: 4096, updatedAt: '2026-08-12T00:00:00.000Z' });
    const replaced = avatarCacheKey({ byteSize: 4096, updatedAt: '2026-08-12T00:01:00.000Z' });

    expect(first).not.toBe(replaced);
    expect(avatarCacheKey({ byteSize: 4096, updatedAt: '2026-08-12T00:00:00.000Z' })).toBe(first);
  });

  test('carries no user identifier', () => {
    const key = avatarCacheKey({ byteSize: 4096, updatedAt: '2026-08-12T00:00:00.000Z' });

    expect(key).toBe('avatar-2026-08-12T00:00:00.000Z-4096');
  });
});
