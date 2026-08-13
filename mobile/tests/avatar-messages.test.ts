import { describe, expect, test } from 'bun:test';

import {
  avatarPickErrorMessage,
  avatarRemoveErrorMessage,
  avatarUploadErrorMessage,
} from '../src/features/avatar/avatar-messages';
import {
  avatarCacheKey,
  avatarImageSource,
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
    expect(messages[2]).toContain('different photo');
  });

  test('passes a transfer failure through with its own wording', () => {
    for (const reason of ['size-changed', 'transfer-failed'] as const) {
      const message = avatarUploadErrorMessage(new UploadTransferError(reason, `copy for ${reason}`));
      expect(message).toBe(`copy for ${reason}`);
    }
  });

  test('shows what the backend said, since that text is written for a person', () => {
    expect(avatarUploadErrorMessage(new ApiRequestError(500, 'INTERNAL_ERROR', 'boom'))).toBe('boom');
    expect(avatarRemoveErrorMessage(new ApiRequestError(500, 'INTERNAL_ERROR', 'boom'))).toBe('boom');
  });

  test('never puts an internal failure on screen verbatim', () => {
    // A schema failure is the realistic case: its `message` is a JSON dump of the issue array,
    // and echoing it would show the person a validation payload instead of an instruction.
    const validationFailure = new Error(
      '[{"expected":"number","code":"invalid_type","path":["byteSize"]}]',
    );

    for (const failure of [validationFailure, new TypeError('undefined is not an object'), 'nope']) {
      expect(avatarUploadErrorMessage(failure)).toBe('The photo could not be uploaded. Try again.');
      expect(avatarRemoveErrorMessage(failure)).toBe('The photo could not be removed. Try again.');
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

  test('carries no user identifier', () => {
    const key = avatarCacheKey({ byteSize: 4096, updatedAt: '2026-08-12T00:00:00.000Z' });

    expect(key).toBe('avatar-2026-08-12T00:00:00.000Z-4096');
  });
});

describe('avatarImageSource', () => {
  const avatar = {
    byteSize: 4096,
    contentType: 'image/jpeg' as const,
    downloadUrl: 'http://127.0.0.1:3000/storage/objects/avatars/2026/08/abc?x-sig=1',
    updatedAt: '2026-08-12T00:00:00.000Z',
  };

  test('asks the browser to fetch the image instead of loading it as a plain img', () => {
    // The API sets Cross-Origin-Resource-Policy: same-origin, which blocks a no-cors <img> load
    // of a filesystem-driver URL. Headers make expo-image load it with fetch, which is a CORS
    // request and not subject to that rule - without this the web avatar silently stays blank.
    const source = avatarImageSource(avatar, 'web');

    expect(source?.headers).toEqual({ Accept: 'image/*' });
    expect(source?.uri).toBe(avatar.downloadUrl);
  });

  test('leaves native builds on the direct path expo-image can cache', () => {
    for (const platform of ['ios', 'android']) {
      expect(avatarImageSource(avatar, platform)).not.toHaveProperty('headers');
    }
  });

  test('pairs the URI with its cache key, and answers null without a photo', () => {
    expect(avatarImageSource(avatar, 'ios')?.cacheKey).toBe(avatarCacheKey(avatar));
    expect(avatarImageSource(null, 'ios')).toBeNull();
  });
});

describe('avatarPickErrorMessage', () => {
  test('tells the person to pick a different photo, not to retry the same one', () => {
    // Nothing was uploaded, so "try again" would send them back to the file that just failed.
    // The realistic case is a browser refusing to decode HEIC, which rejects with a non-Error.
    // The canvas rejection is not an Error at all, which is why the last case matters.
    for (const failure of [new Error('decode failed'), { tagName: 'CANVAS' }, 'nope']) {
      expect(avatarPickErrorMessage(failure)).toBe(
        'That photo could not be prepared for upload. Try a different one.',
      );
    }
  });

  test('keeps the reader own wording, which names the one recovery that works', () => {
    // An unreadable file cannot be fixed by retrying; the instruction has to survive the mapper.
    const unreadable = new UploadTransferError(
      'unreadable-file',
      'That photo could not be read from this device. Pick it again.',
    );

    expect(avatarPickErrorMessage(unreadable)).toBe(unreadable.message);
    expect(avatarUploadErrorMessage(unreadable)).toBe(unreadable.message);
  });
});
