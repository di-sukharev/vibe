import { describe, expect, test } from 'bun:test';

import {
  avatarRemoveErrorMessage,
  avatarUploadErrorMessage,
} from '../src/features/avatar/avatar-messages';
import {
  avatarCacheKey,
  avatarImageSource,
  avatarResizePlan,
  avatarTargetEdgePixels,
} from '../src/features/avatar/image-source';

describe('avatar error messages', () => {
  test('never put an internal failure on screen verbatim', () => {
    // A schema failure is the realistic case: its `message` is a JSON dump of the issue array,
    // and echoing it would show the person a validation payload instead of an instruction.
    const validationFailure = new Error(
      '[{"expected":"number","code":"invalid_type","path":["byteSize"]}]',
    );

    for (const [failure, internalText] of [
      [validationFailure, validationFailure.message],
      [new TypeError('undefined is not an object'), 'undefined is not an object'],
      ['nope', 'nope'],
    ] as const) {
      for (const message of [avatarUploadErrorMessage(failure), avatarRemoveErrorMessage(failure)]) {
        expect(message).toBeString();
        expect(message).not.toContain(internalText);
      }
    }
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
});

describe('avatarImageSource', () => {
  const avatar = {
    byteSize: 4096,
    contentType: 'image/jpeg' as const,
    downloadUrl: 'http://127.0.0.1:3000/storage/objects/avatars/2026/08/abc?x-sig=1',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };

  test('fetches the image on web only, and keeps native builds on the cacheable direct path', () => {
    // The API sets Cross-Origin-Resource-Policy: same-origin, which blocks a no-cors <img> load
    // of a filesystem-driver URL. Headers make expo-image load it with fetch, which is a CORS
    // request and not subject to that rule - without this the web avatar silently stays blank.
    const source = avatarImageSource(avatar, 'web');

    expect(source?.headers).toEqual({ Accept: 'image/*' });
    expect(source?.uri).toBe(avatar.downloadUrl);
    for (const platform of ['ios', 'android']) {
      expect(avatarImageSource(avatar, platform)).not.toHaveProperty('headers');
    }
  });

  test('pairs the URI with its cache key, and answers null without a photo', () => {
    expect(avatarImageSource(avatar, 'ios')?.cacheKey).toBe(avatarCacheKey(avatar));
    expect(avatarImageSource(null, 'ios')).toBeNull();
  });
});
