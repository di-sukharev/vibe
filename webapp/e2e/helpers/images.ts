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
