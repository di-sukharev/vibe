import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';

/**
 * The picker's own docblock calls its order load-bearing: normalize first, measure the file that
 * was actually written second. Getting it backwards signs a ticket for the original photo's size
 * and the upload can then never satisfy its own signature, which storage reports as a bare 403.
 *
 * Both Expo modules are substituted at their boundary, the way `iap-provider.test.tsx` substitutes
 * `expo-iap`. The fakes record what they were asked for; nothing here asserts what a real picker
 * or manipulator does with the request.
 */

type ManipulateCall = { resizes: unknown[]; uri: string };

const manipulateCalls: ManipulateCall[] = [];
const saveOptions: Record<string, unknown>[] = [];
const released: string[] = [];
const revoked: string[] = [];
let pickerResult: unknown = { assets: [], canceled: true };
let renderFails = false;
let savedUri = 'file:///tmp/normalized.jpg';

const originalRevoke = URL.revokeObjectURL;
URL.revokeObjectURL = (uri: string) => {
  revoked.push(uri);
};
afterAll(() => {
  URL.revokeObjectURL = originalRevoke;
});

beforeEach(() => {
  manipulateCalls.length = 0;
  saveOptions.length = 0;
  released.length = 0;
  revoked.length = 0;
  pickerResult = { assets: [], canceled: true };
  renderFails = false;
  savedUri = 'file:///tmp/normalized.jpg';
});

mock.module('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => pickerResult,
}));

mock.module('expo-image-manipulator', () => ({
  ImageManipulator: {
    manipulate(uri: string) {
      const call: ManipulateCall = { resizes: [], uri };
      manipulateCalls.push(call);

      const context = {
        release() {
          released.push('context');
        },
        resize(plan: unknown) {
          call.resizes.push(plan);
          return context;
        },
        async renderAsync() {
          if (renderFails) throw new Error('the browser cannot decode this image');

          return {
            release() {
              released.push('render');
            },
            // Only the web implementation of `ImageRef` has a `uri`, and it is an object URL.
            ...(uri.startsWith('blob:') ? { uri: 'blob:http://localhost:8081/render' } : {}),
            async saveAsync(options: Record<string, unknown>) {
              saveOptions.push(options);
              return { height: 512, uri: savedUri, width: 512 };
            },
          };
        },
      };

      return context;
    },
  },
  SaveFormat: { JPEG: 'jpeg' },
}));

const { createExpoAvatarPicker } = await import('../src/features/avatar/expo-picker');
const { avatarCompressionQuality, avatarTargetEdgePixels } = await import(
  '../src/features/avatar/image-source',
);

function pickerWithMeasure() {
  const measured: string[] = [];
  const picker = createExpoAvatarPicker({
    measureBytes: async (uri) => {
      measured.push(uri);
      return 2048;
    },
  });

  return { measured, picker };
}

describe('createExpoAvatarPicker', () => {
  test('measures the normalized file, not the picked asset', async () => {
    // The single most costly mistake available here: the ticket is signed for one exact byte
    // count, and the original photo's size is not the size that will be sent.
    pickerResult = {
      assets: [{ height: 4000, uri: 'file:///tmp/original.heic', width: 3000 }],
      canceled: false,
    };

    const { measured, picker } = pickerWithMeasure();
    const picked = await picker.pick();

    expect(measured).toEqual(['file:///tmp/normalized.jpg']);
    expect(picked).toEqual({
      byteSize: 2048,
      contentType: 'image/jpeg',
      uri: 'file:///tmp/normalized.jpg',
    });
  });

  test('resizes a large photo by its longer edge, and leaves a small one alone', async () => {
    for (const [asset, expected] of [
      [{ height: 4000, width: 3000 }, [{ height: avatarTargetEdgePixels }]],
      [{ height: 3000, width: 4000 }, [{ width: avatarTargetEdgePixels }]],
      [{ height: 200, width: 200 }, []],
    ] as const) {
      pickerResult = { assets: [{ ...asset, uri: 'file:///tmp/original.jpg' }], canceled: false };

      const { picker } = pickerWithMeasure();
      await picker.pick();

      // The last call, since the array accumulates across the loop.
      const call = manipulateCalls[manipulateCalls.length - 1];
      expect(call.uri).toBe('file:///tmp/original.jpg');
      expect(call.resizes).toEqual(expected as unknown[]);
    }
  });

  test('encodes as JPEG, which is the content type it then declares', async () => {
    // These two are the same claim made twice: the bytes are encoded here, and the type is
    // declared to the backend a few lines later. Finalize reads the stored object's magic bytes
    // and rejects a mismatch, so changing the format without the declaration would fail every
    // upload at the last step - with a message blaming the person's photo.
    pickerResult = {
      assets: [{ height: 4000, uri: 'file:///tmp/original.heic', width: 3000 }],
      canceled: false,
    };

    const { picker } = pickerWithMeasure();
    const picked = await picker.pick();

    expect(saveOptions).toHaveLength(1);
    expect(saveOptions[0].format).toBe('jpeg');
    expect(saveOptions[0].compress).toBe(avatarCompressionQuality);
    expect(picked?.contentType).toBe('image/jpeg');
  });

  test('answers null when the person cancels, without touching the manipulator', async () => {
    // Cancelling has to be distinguishable from a failure, or the screen shows an error for
    // something the person did on purpose.
    pickerResult = { assets: [], canceled: true };

    const { measured, picker } = pickerWithMeasure();

    expect(await picker.pick()).toBeNull();
    expect(manipulateCalls).toHaveLength(0);
    expect(measured).toHaveLength(0);
  });
});

describe('resource cleanup', () => {
  test('releases the decoded bitmaps even when the render fails', async () => {
    // The release exists because these hold a full-resolution bitmap. A failed decode is exactly
    // the path where that memory would otherwise be stranded, and it is reachable on web for any
    // format the browser refuses.
    renderFails = true;
    pickerResult = {
      assets: [{ height: 4000, uri: 'blob:http://localhost:8081/original', width: 3000 }],
      canceled: false,
    };

    const { picker } = pickerWithMeasure();
    const failure = await picker.pick().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    // The context is released even though the render never produced anything to release.
    expect(released).toEqual(['context']);
    // And the original photo is freed. This is the path that strands the largest object URL if
    // the cleanup sits on the success branch, and on web it is the likely one: any format the
    // browser cannot decode rejects here, after the picker has already created the URL.
    expect(revoked).toEqual(['blob:http://localhost:8081/original']);
  });

  test('revokes the object URLs it owns, and never the one it hands out', async () => {
    // On web these are the original photo and the intermediate render - megabytes each, held for
    // the tab's lifetime unless revoked. The saved JPEG is excluded on purpose: it crosses the
    // port to be uploaded, so revoking it here would break the transfer.
    savedUri = 'blob:http://localhost:8081/saved';
    pickerResult = {
      assets: [{ height: 4000, uri: 'blob:http://localhost:8081/original', width: 3000 }],
      canceled: false,
    };

    const { picker } = pickerWithMeasure();
    await picker.pick();

    expect(released).toEqual(['render', 'context']);
    expect(revoked).toEqual([
      'blob:http://localhost:8081/original',
      'blob:http://localhost:8081/render',
    ]);
    expect(revoked).not.toContain('blob:http://localhost:8081/saved');
  });

  test('leaves native file paths alone', async () => {
    pickerResult = {
      assets: [{ height: 4000, uri: 'file:///tmp/original.heic', width: 3000 }],
      canceled: false,
    };

    const { picker } = pickerWithMeasure();
    await picker.pick();

    expect(revoked).toEqual([]);
  });
});
