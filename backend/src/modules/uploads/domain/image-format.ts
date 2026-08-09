import type { AvatarContentType } from '@web-app-demo/contracts'

/**
 * Identifies an image by its leading bytes.
 *
 * A declared content type is a claim by the uploader, and the storage endpoint stores whatever
 * arrives. This is the only check that looks at what was actually written, so it is what stands
 * between the product and an executable, an SVG full of script, or a renamed archive being
 * served back to a browser as someone's avatar.
 */

/** Enough for the PNG signature (8) and the ISO-BMFF box header plus brand (12). */
export const imageSignatureByteLength = 12

const heifBrands = new Set(['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1', 'heim', 'heis'])

export function detectImageFormat(bytes: Uint8Array): AvatarContentType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }

  // ISO base media format: a `ftyp` box at offset 4, then a four-character brand.
  if (bytes.length >= imageSignatureByteLength && asciiAt(bytes, 4, 4) === 'ftyp') {
    return heifBrands.has(asciiAt(bytes, 8, 4)) ? 'image/heic' : null
  }

  return null
}

/**
 * HEIC and HEIF are the same container. Phones and browsers disagree about which name to send,
 * and the declared type is part of the upload signature, so treating them as different would
 * reject valid photos rather than protect anything.
 */
export function imageFormatMatchesDeclaredType(
  detected: AvatarContentType,
  declared: AvatarContentType,
) {
  return normalizeImageFormat(detected) === normalizeImageFormat(declared)
}

function normalizeImageFormat(contentType: AvatarContentType) {
  return contentType === 'image/heif' ? 'image/heic' : contentType
}

function asciiAt(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}
