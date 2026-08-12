import type { Avatar } from '@web-app-demo/contracts';

/**
 * The longest edge a stored avatar needs.
 *
 * A phone photo is routinely several thousand pixels and many megabytes; an avatar is shown at
 * roughly 40-96pt. Normalizing before asking for a ticket is what keeps ordinary photos under
 * the 5 MB contract limit instead of being refused for a reason the person cannot act on.
 */
export const avatarTargetEdgePixels = 512;

/** JPEG quality for the normalized image. High enough that a 512px avatar shows no artefacts. */
export const avatarCompressionQuality = 0.8;

/**
 * The resize to apply, or `null` when the image is already small enough.
 *
 * Only the longer edge is constrained; the manipulator derives the other one and preserves the
 * aspect ratio. Returning `null` rather than a no-op resize keeps an already-small image from
 * being re-encoded larger than it started.
 */
export function avatarResizePlan(
  size: { height: number; width: number },
  targetEdge = avatarTargetEdgePixels,
): { height?: number; width?: number } | null {
  const longestEdge = Math.max(size.width, size.height);
  if (longestEdge <= targetEdge) return null;

  return size.width >= size.height ? { width: targetEdge } : { height: targetEdge };
}

/**
 * A cache key tied to the image's identity rather than its URL.
 *
 * `expo-image` keys its cache on the URL by default, and every read of the avatar returns a
 * freshly signed `downloadUrl`. Without this, every refetch is a cache miss and a new disk
 * entry, and a stale cached response can hand the loader an already-expired URL - a 403 and a
 * blank avatar. `updatedAt` changes on every publish, so a replaced photo can never be served
 * from the previous one's cache entry.
 *
 * The key holds no user identifier - not for privacy, since it never leaves the device, but
 * because it does not need one: the entry is only ever read back for the account that wrote it,
 * and a collision would need two accounts on one device to publish photos of identical size in
 * the same millisecond.
 */
export function avatarCacheKey(avatar: Pick<Avatar, 'byteSize' | 'updatedAt'>) {
  return `avatar-${avatar.updatedAt}-${avatar.byteSize}`;
}
