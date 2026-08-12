import type { AvatarContentType } from '@web-app-demo/contracts';

/** An image that is ready to upload: already normalized, with its real byte size measured. */
export type PickedAvatar = {
  byteSize: number;
  contentType: AvatarContentType;
  uri: string;
};

/**
 * Choosing a photo, behind a port.
 *
 * The port returns an already-normalized descriptor, so nothing above it ever sees an Expo type
 * and a test can substitute an object literal instead of mocking a native module.
 */
export type AvatarPickerPort = {
  /** Resolves `null` when the person cancels. Rejects only on a real failure. */
  pick: () => Promise<PickedAvatar | null>;
};
