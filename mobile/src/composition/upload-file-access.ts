import type { UploadFileAccess } from '@/platform/uploads';
import { nativeFileAccess } from '@/platform/uploads/native-file-access';
import { webFileAccess } from '@/platform/uploads/web-file-access';

/**
 * Picks the reader/sender pair that understands this platform's file URIs.
 *
 * The web build is a real target here (`expo export --platform web`), and `expo-file-system` is
 * a warn-only stub there: its `File` reports no size and its upload resolves with status 0. The
 * image picker and manipulator do work in a browser, so without this choice the web build fails
 * with a valid image in hand.
 */
export function uploadFileAccessForPlatform(platform: string): UploadFileAccess {
  return platform === 'web' ? webFileAccess : nativeFileAccess;
}
