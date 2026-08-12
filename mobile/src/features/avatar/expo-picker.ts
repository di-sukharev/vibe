import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import { avatarCompressionQuality, avatarResizePlan } from './image-source';
import type { AvatarPickerPort, PickedAvatar } from './picker';

/**
 * The Expo implementation of the picker port.
 *
 * This is the only file that imports `expo-image-picker` and `expo-image-manipulator`, which is
 * what keeps every module above it testable with a plain object literal.
 *
 * The order below is load-bearing. The picked asset is normalized first and measured **after**,
 * because the backend signs a ticket for one exact byte count: taking the size from the picker
 * asset would describe the original file, and the upload could then never satisfy its own
 * signature. That failure arrives as an unexplained 403 from storage.
 *
 * Normalizing to JPEG also means an iPhone's HEIC photo is stored in a format every client can
 * render. That is client-side convenience only - the backend still verifies the magic bytes of
 * whatever actually arrives.
 */
export function createExpoAvatarPicker(): AvatarPickerPort {
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
      const resize = avatarResizePlan({ height: asset.height, width: asset.width });
      if (resize) context.resize(resize);

      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({
        compress: avatarCompressionQuality,
        format: SaveFormat.JPEG,
      });

      // `saveAsync` reports dimensions but not a byte count, so the written file is measured.
      return { byteSize: new File(saved.uri).size, contentType: 'image/jpeg', uri: saved.uri };
    },
  };
}
