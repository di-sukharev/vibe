/**
 * In-memory image fixtures.
 *
 * Kept as base64 constants rather than committed binaries: they are a few dozen bytes each,
 * `setInputFiles` accepts a buffer directly, and a repository with no stray binary files is
 * easier to review.
 */

/** A real 1x1 PNG. */
export const pngImage = {
  name: 'avatar.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
}

/** A real 1x1 JPEG, used to prove the stored content type actually changes on replace. */
export const jpegImage = {
  name: 'avatar.jpg',
  mimeType: 'image/jpeg',
  buffer: Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64',
  ),
}

/**
 * Not an image at all: the finalize check must refuse it whatever the filename says.
 *
 * Deliberately padded past `AVATAR_MIN_BYTES`. Below that floor the browser rejects it on size
 * and the upload never leaves the page, so the server-side magic-byte check - the thing this
 * fixture exists to exercise - would never run.
 */
export const disguisedTextFile = {
  name: 'not-really.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg><!-- padding past the minimum size -->',
    'utf8',
  ),
}

/**
 * Matches the direct upload request on either driver: the filesystem driver serves it from the
 * backend under /storage/objects, the S3 driver from the local bucket.
 */
export const storageUploadUrlPatterns = ['**/storage/objects/**', '**/local-private-storage/**']
