import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const defaultTargets = ['webapp/dist', 'website/dist']

/**
 * An allow-list, not a deny-list, and every entry is UTF-8 text.
 *
 * A deny-list silently starts spending CPU and disk on whatever new binary format lands in a build
 * next, and the size check below cannot be relied on to catch it. The Inter font in `website/dist`
 * is the case to keep in mind: 48256 bytes, which `gzipSync` turns into 48254. Two bytes, 0.004%,
 * is enough to pass "the variant is smaller" and ship a second copy of a file that has to be
 * fetched, stored, and decoded for nothing. (Brotli grows it to 48260 and is caught, and `gzip -9`
 * on the command line reports 48288 because it stores the filename in the header - neither is what
 * this script runs, so neither is what the decision can rest on.) Already-compressed formats have
 * no entropy left to remove; the allow-list is what keeps them out, and the size check only cleans
 * up after high-entropy files that slip through it with a compressible extension.
 */
const compressibleExtensions = new Set([
  '.css',
  '.cjs',
  '.html',
  '.js',
  '.json',
  '.map',
  '.mjs',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
])

export const variantExtensions = ['.br', '.gz']

/**
 * Below this, a sibling costs more than it saves: the response already fits in a single segment,
 * and the gzip envelope alone is ~20 bytes before the deflate stream starts.
 */
export const minimumCompressibleBytes = 1024

export function shouldCompress(filePath, byteLength) {
  if (byteLength < minimumCompressibleBytes) return false
  return compressibleExtensions.has(path.extname(filePath).toLowerCase())
}

/**
 * Is this a sibling we wrote, rather than a file the build meant to publish?
 *
 * The base name has to be compressible too, so a genuine `archive.gz` in `public/` is left alone
 * instead of being deleted as a stale variant of nothing.
 *
 * That protection stops at the extension, and it has to: a published `public/data.json.gz` is
 * indistinguishable from our own leftover for `data.json`, so it is claimed and deleted on every
 * run. Nothing in this template publishes such a file. If a project starts to, give it a name this
 * cannot claim, or keep it out of the precompressed targets - the alternative is keeping stale
 * variants, which serves the previous release and is the worse failure.
 */
export function isVariantPath(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (!variantExtensions.includes(extension)) return false
  const base = filePath.slice(0, -extension.length)
  return compressibleExtensions.has(path.extname(base).toLowerCase())
}

/**
 * Compress once, at the highest level each codec offers, and keep only what actually shrank.
 *
 * The size check catches high-entropy files that carry a compressible extension - an inlined data
 * blob in a `.js`, say - where a variant would come out larger than its source and a proxy would
 * happily serve it to make the page slower. It is a backstop for the allow-list, not a substitute:
 * see why on `compressibleExtensions` above.
 *
 * Both codecs are deterministic under one runtime - its zlib writes the gzip header's mtime field
 * as zeros rather than the current time - so rerunning this produces byte-identical output and no
 * spurious re-uploads or CDN invalidations. The guarantee is per runtime, not absolute: bun and
 * node ship different zlib builds, and on the largest asset here their gzip output differs by
 * about a kilobyte, so running this script with the other one rewrites every `.gz`. Brotli output
 * is identical across both. Nothing depends on this beyond avoiding pointless uploads.
 */
export function compressedVariants(source) {
  const variants = {}

  const gzip = gzipSync(source, { level: constants.Z_BEST_COMPRESSION })
  if (gzip.length < source.length) variants['.gz'] = gzip

  // Quality is the only parameter that earns its place. `BROTLI_MODE_TEXT` and a
  // `BROTLI_PARAM_SIZE_HINT` were both measured across every file in `webapp/dist` and
  // `website/dist` and changed not one byte: the mode matters below maximum quality, and the hint
  // tells a whole-buffer call something it already knows. Re-measure before adding either back.
  const brotli = brotliCompressSync(source, {
    params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
  })
  if (brotli.length < source.length) variants['.br'] = brotli

  return variants
}

export async function precompressDirectory(directory) {
  const files = await collectFiles(directory)
  const summary = { compressed: 0, skipped: 0, removed: 0, rawBytes: 0, gzipBytes: 0, brotliBytes: 0 }
  const currentVariants = new Set()

  for (const filePath of files) {
    if (isVariantPath(filePath)) continue

    // Decide from the name and the size on disk, before reading. A `dist` holding a hero video
    // would otherwise be buffered in full only to be discarded on the next line.
    if (!shouldCompress(filePath, (await stat(filePath)).size)) {
      summary.skipped += 1
      continue
    }

    const source = await readFile(filePath)
    const variants = compressedVariants(source)
    if (Object.keys(variants).length === 0) {
      summary.skipped += 1
      continue
    }

    summary.compressed += 1
    summary.rawBytes += source.length
    summary.gzipBytes += variants['.gz']?.length ?? source.length
    summary.brotliBytes += variants['.br']?.length ?? source.length

    for (const [extension, buffer] of Object.entries(variants)) {
      const variantPath = `${filePath}${extension}`
      currentVariants.add(variantPath)
      await writeFile(variantPath, buffer)
    }
  }

  /**
   * Anything left is from an earlier build. It has to go: `gzip_static` and Caddy's `precompressed`
   * prefer the sibling whenever it exists, so a stale `index.html.gz` would keep serving the last
   * release while the plain `index.html` next to it is current.
   */
  for (const filePath of files) {
    if (!isVariantPath(filePath) || currentVariants.has(filePath)) continue
    await rm(filePath)
    summary.removed += 1
  }

  return summary
}

async function main() {
  const targets = process.argv.slice(2)
  const requested = targets.length > 0 ? targets : defaultTargets
  let processed = 0

  for (const target of requested) {
    const directory = path.resolve(repositoryRoot, target)
    if (!(await isDirectory(directory))) {
      console.log(`${target}: not built, skipped.`)
      continue
    }

    processed += 1
    console.log(formatSummary(target, await precompressDirectory(directory)))
  }

  if (processed === 0) {
    console.error(
      `Nothing to compress: none of ${requested.join(', ')} exist. Run the build for those surfaces first.`,
    )
    process.exitCode = 1
  }
}

function formatSummary(target, summary) {
  if (summary.compressed === 0) {
    return `${target}: nothing compressible (${summary.skipped} skipped${trailingRemoved(summary)}).`
  }

  const gzip = `gzip ${formatBytes(summary.gzipBytes)} (-${savedPercent(summary.rawBytes, summary.gzipBytes)}%)`
  const brotli = `brotli ${formatBytes(summary.brotliBytes)} (-${savedPercent(summary.rawBytes, summary.brotliBytes)}%)`
  return (
    `${target}: ${summary.compressed} files, ${formatBytes(summary.rawBytes)} -> ${gzip}, ${brotli}` +
    ` (${summary.skipped} skipped${trailingRemoved(summary)}).`
  )
}

function trailingRemoved(summary) {
  return summary.removed === 0 ? '' : `, ${summary.removed} stale removed`
}

function savedPercent(rawBytes, compressedBytes) {
  if (rawBytes === 0) return '0'
  return (100 - (compressedBytes / rawBytes) * 100).toFixed(1)
}

/**
 * Decimal units, because these numbers get compared against the Vite and Astro build summaries
 * printed moments earlier, and both of those are decimal. Reporting 864.5 KB for the file Vite
 * just called 885 kB reads as a discrepancy to chase.
 */
function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`
  return `${(bytes / 1_000_000).toFixed(2)} MB`
}

async function isDirectory(directory) {
  try {
    return (await stat(directory)).isDirectory()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function collectFiles(directory) {
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files.sort()
}

if (import.meta.main) await main()
