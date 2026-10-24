import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const defaultTargets = ['webapp/build/client', 'website/build/client']

// Compress text formats only. Already-compressed binaries can produce smaller variants
// with negligible savings, which do not justify a second copy.
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

// Small files do not save enough bytes to justify extra variants.
export const minimumCompressibleBytes = 1024

export function shouldCompress(filePath, byteLength) {
  if (byteLength < minimumCompressibleBytes) return false
  return compressibleExtensions.has(path.extname(filePath).toLowerCase())
}

// Only text-file siblings are generated variants. Do not publish precompressed text files
// in these targets: cleanup cannot distinguish them from generated siblings.
export function isVariantPath(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (!variantExtensions.includes(extension)) return false
  const base = filePath.slice(0, -extension.length)
  return compressibleExtensions.has(path.extname(base).toLowerCase())
}

// Output is deterministic within one runtime. Bun and Node can emit different gzip bytes,
// so use the same runtime when comparing artifacts or avoiding redundant uploads.
export function compressedVariants(source) {
  const variants = {}

  const gzip = gzipSync(source, { level: constants.Z_BEST_COMPRESSION })
  if (gzip.length < source.length) variants['.gz'] = gzip

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

    // Inspect metadata before buffering large binary assets.
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

  // Remove stale variants so static hosts cannot serve an older release.
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

// Match the decimal units in Vite build summaries.
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
