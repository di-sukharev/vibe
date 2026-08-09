import { describe, expect, test } from 'bun:test'

import { detectImageFormat, imageFormatMatchesDeclaredType } from './image-format'

function bytes(...values: number[]) {
  return new Uint8Array(values)
}

function isoBaseMedia(brand: string) {
  return new Uint8Array([
    0x00,
    0x00,
    0x00,
    0x18,
    ...[...'ftyp'].map((character) => character.charCodeAt(0)),
    ...[...brand].map((character) => character.charCodeAt(0)),
  ])
}

describe('detectImageFormat', () => {
  test('recognises the three formats the product accepts', () => {
    expect(detectImageFormat(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10))).toBe('image/jpeg')
    expect(detectImageFormat(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe(
      'image/png',
    )

    for (const brand of ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1']) {
      expect(detectImageFormat(isoBaseMedia(brand))).toBe('image/heic')
    }
  })

  test('rejects formats a browser would treat as active content', () => {
    // SVG: markup a browser will execute if it is ever served inline.
    expect(detectImageFormat(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg">'))).toBeNull()
    // HTML smuggled under an image name.
    expect(detectImageFormat(new TextEncoder().encode('<!doctype html><script>'))).toBeNull()
    // A Mach-O / ELF style binary prefix.
    expect(detectImageFormat(bytes(0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01))).toBeNull()
  })

  test('rejects image formats that are simply not supported here', () => {
    expect(detectImageFormat(new TextEncoder().encode('GIF89a'))).toBeNull()
    expect(detectImageFormat(bytes(0x42, 0x4d, 0x00, 0x00))).toBeNull()
    // An ISO base media file that is a video, not an image.
    expect(detectImageFormat(isoBaseMedia('isom'))).toBeNull()
  })

  test('rejects truncated and empty input rather than guessing', () => {
    expect(detectImageFormat(new Uint8Array())).toBeNull()
    expect(detectImageFormat(bytes(0xff, 0xd8))).toBeNull()
    expect(detectImageFormat(bytes(0x89, 0x50, 0x4e))).toBeNull()
    expect(detectImageFormat(isoBaseMedia('heic').subarray(0, 10))).toBeNull()
  })
})

describe('imageFormatMatchesDeclaredType', () => {
  test('treats HEIC and HEIF as the same container', () => {
    expect(imageFormatMatchesDeclaredType('image/heic', 'image/heif')).toBe(true)
    expect(imageFormatMatchesDeclaredType('image/heif', 'image/heic')).toBe(true)
  })

  test('does not let one image type stand in for another', () => {
    expect(imageFormatMatchesDeclaredType('image/png', 'image/jpeg')).toBe(false)
    expect(imageFormatMatchesDeclaredType('image/jpeg', 'image/heic')).toBe(false)
    expect(imageFormatMatchesDeclaredType('image/png', 'image/png')).toBe(true)
  })
})
