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

/**
 * The stored avatar as an image source, or `null` when there is none.
 *
 * The URI and its key are built in one place so a caller cannot pass the signed URI on its own
 * and lose the cache identity that makes it usable.
 *
 * The web build needs one more thing. There the signed URL is fetched by a real browser, and
 * with the filesystem driver it is served by the API, which sets `Cross-Origin-Resource-Policy:
 * same-origin` - so a plain `<img src>` load is blocked and the avatar silently stays as
 * initials. Giving the source headers makes `expo-image` load it with `fetch` instead, and a
 * CORS request is not subject to that rule. It is the same reason `webapp` renders an object URL
 * rather than pointing an `<img>` at the signed URL, and it keeps the two storage drivers
 * behaving identically in a browser instead of only S3 working.
 *
 * `Accept` is a CORS-safelisted request header, so this adds no preflight and needs no entry in
 * the API's allow-list. Native builds keep the direct path, which `expo-image` can cache.
 */
export function avatarImageSource(avatar: Avatar | null, platform: string) {
  if (!avatar) return null;

  return {
    cacheKey: avatarCacheKey(avatar),
    ...(platform === 'web' ? { headers: { Accept: 'image/*' } } : {}),
    uri: avatar.downloadUrl,
  };
}
