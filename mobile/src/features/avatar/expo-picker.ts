import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { UploadFileAccess } from '@/platform/uploads';
import { avatarCompressionQuality, avatarResizePlan } from './image-source';
import type { AvatarPickerPort, PickedAvatar } from './picker';

/**
 * The Expo implementation of the picker port.
 *
 * This is the only file that imports `expo-image-picker` and `expo-image-manipulator`, which is
 * what keeps every module above it testable with a plain object literal. Both modules work on
 * every platform Expo targets, including web, so the one platform-specific step - measuring the
 * bytes that were written - arrives as `measureBytes` rather than being decided here.
 *
 * The order below is load-bearing. The picked asset is normalized first and measured **after**,
 * because the backend signs a ticket for one exact byte count: taking the size from the picker
 * asset would describe the original file, and the upload could then never satisfy its own
 * signature. That failure arrives as an unexplained 403 from storage.
 *
 * `allowsEditing` and `aspect` are native-only, and `aspect` is honoured on Android alone - iOS
 * always crops square and the web build has no crop step at all. A web pick therefore keeps its
 * original proportions; the avatar is rendered with `contentFit="cover"` in a circle, so it is
 * cropped for display either way.
 *
 * Normalizing to JPEG also means an iPhone's HEIC photo is stored in a format every client can
 * render. That is client-side convenience only - the backend still verifies the magic bytes of
 * whatever actually arrives.
 */
export function createExpoAvatarPicker({
  measureBytes,
}: Pick<UploadFileAccess, 'measureBytes'>): AvatarPickerPort {
  return {
    async pick(): Promise<PickedAvatar | null> {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        mediaTypes: ['images'],
        // Full quality out of the picker; the manipulator below owns the compression, so the
        // image is only re-encoded once.
        quality: 1,
      });

      if (result.canceled) return null;

      const [asset] = result.assets;
      if (!asset) return null;

      const context = ImageManipulator.manipulate(asset.uri);
      let rendered: Awaited<ReturnType<typeof context.renderAsync>> | null = null;

      try {
        const resize = avatarResizePlan({ height: asset.height, width: asset.width });
        if (resize) context.resize(resize);

        rendered = await context.renderAsync();

        const saved = await rendered.saveAsync({
          compress: avatarCompressionQuality,
          format: SaveFormat.JPEG,
        });

        // `saveAsync` reports dimensions but not a byte count, so the written file is measured.
        return {
          byteSize: await measureBytes(saved.uri),
          contentType: 'image/jpeg',
          uri: saved.uri,
        };
      } finally {
        // Both hold a decoded bitmap of the original photo - tens of megabytes for a modern
        // phone camera - and neither is reachable after this call. Waiting for the collector to
        // notice would let a few picks in a row hold far more memory than the app ever needs.
        rendered?.release();
        context.release();

        // Once the render has settled - succeeded or failed - the browser's handle on the
        // original file is dead weight, and it is the largest of the object URLs in play: the
        // whole multi-megabyte photo, which `expo-image-picker` creates and never revokes.
        // Freeing it here rather than on the success path matters because the failure is the
        // likely one on web, where any format the browser cannot decode rejects the render.
        revokeIfObjectUrl(asset.uri);

        // `release()` is a no-op in a browser, where the render is instead a full-resolution
        // PNG held alive by an object URL until it is revoked - and nothing else ever
        // references this one, since only the saved JPEG is handed out. `uri` exists only on
        // the web implementation of `ImageRef`, which is precisely the case being cleaned up,
        // so it is read defensively rather than declared.
        //
        // The saved JPEG's own object URL is deliberately left alone: it crosses the port to be
        // measured and uploaded, so this function is not its owner and revoking it here would
        // break the upload. At roughly 500 KB per pick that is a bounded, tab-lifetime cost;
        // a product that picks files in bulk should give the port an explicit release step.
        revokeIfObjectUrl((rendered as { uri?: string } | null)?.uri);
      }
    },
  };
}

/**
 * Frees a browser object URL, and does nothing to a native file path.
 *
 * The `blob:` test is what makes this safe to call on every platform: on iOS and Android these
 * are `file://` paths that the OS owns, and revoking is neither possible nor wanted.
 */
function revokeIfObjectUrl(uri: string | undefined) {
  if (uri?.startsWith('blob:')) URL.revokeObjectURL(uri);
}
