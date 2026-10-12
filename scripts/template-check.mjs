import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function validateAgentInstructions(claude) {
  const lines = withoutFencedCode(claude).split('\n').map((line) => line.trim())
  return lines.includes('@AGENTS.md')
    ? []
    : ['CLAUDE.md must load the shared instructions with a standalone `@AGENTS.md` import line.']
}

export function validateMarkdownLinks(files, trackedPaths) {
  const errors = []
  const metadata = new Map(files.map((file) => [file.path, markdownMetadata(file.source)]))

  for (const file of files) {
    const invalidEncoding = (target) =>
      `${file.path} contains a local link with invalid percent encoding: "${target}".`

    for (const rawTarget of metadata.get(file.path).targets) {
      if (isExternalLink(rawTarget)) continue

      const [rawPathWithQuery, ...fragmentParts] = rawTarget.split('#')
      const rawFragment = fragmentParts.join('#')
      const decodedPath = decoded(rawPathWithQuery.split('?', 1)[0])
      if (decodedPath === undefined) {
        errors.push(invalidEncoding(rawTarget))
        continue
      }

      const resolved = decodedPath
        ? path.posix.normalize(path.posix.join(path.posix.dirname(file.path), decodedPath))
        : file.path
      if (path.posix.isAbsolute(decodedPath) || resolved === '..' || resolved.startsWith('../')) {
        errors.push(`${file.path} contains a local link outside the repository: "${rawTarget}".`)
        continue
      }

      const normalizedPath = resolved.replace(/^\.\//, '').replace(/\/$/, '')
      const normalized = normalizedPath === '.' ? '' : normalizedPath
      const targetExists =
        (normalized === '' && trackedPaths.size > 0) ||
        trackedPaths.has(normalized) ||
        [...trackedPaths].some((trackedPath) => trackedPath.startsWith(`${normalized}/`))
      if (!targetExists) {
        errors.push(`${file.path} links to missing tracked target "${normalized}".`)
        continue
      }

      if (rawFragment && normalized.toLowerCase().endsWith('.md') && metadata.has(normalized)) {
        const fragment = decoded(rawFragment)
        if (fragment === undefined) {
          errors.push(invalidEncoding(rawTarget))
        } else if (!metadata.get(normalized).headings.has(fragment)) {
          errors.push(
            `${file.path} links to missing Markdown heading "#${fragment}" in "${normalized}".`,
          )
        }
      }
    }
  }

  return errors
}

// Tracked and untracked files that exist on disk; ignored and deleted files are excluded.
export function worktreePaths(root = repositoryRoot) {
  const args = ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
  const candidates = execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean)
  return new Set(candidates.filter((filePath) => existsSync(path.join(root, filePath))))
}

function withoutFencedCode(source) {
  let fence
  return source
    .split(/\r?\n/)
    .filter((line) => {
      if (!fence) {
        const opening = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
        const invalidBacktickInfo = opening?.[1][0] === '`' && opening[2].includes('`')
        if (opening && !invalidBacktickInfo) {
          fence = { character: opening[1][0], length: opening[1].length }
          return false
        }
      } else {
        const closing = line.match(/^\s{0,3}(`+|~+)\s*$/)?.[1]
        if (closing && closing[0] === fence.character && closing.length >= fence.length) {
          fence = undefined
        }
        return false
      }
      return true
    })
    .join('\n')
}

function decoded(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}

function isExternalLink(target) {
  return target.startsWith('//') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target)
}

// GitHub anchors: lowercase, punctuation dropped, spaces to dashes, "-1", "-2" for repeated headings.
function markdownMetadata(source) {
  const headings = new Set()
  const targets = new Set()
  const occurrences = new Map()

  Bun.markdown.render(source, {
    heading: (text) => {
      const base = githubHeadingSlug(text)
      const occurrence = occurrences.get(base) ?? 0
      headings.add(occurrence === 0 ? base : `${base}-${occurrence}`)
      occurrences.set(base, occurrence + 1)
      return text
    },
    image: (_text, { src }) => {
      targets.add(unescapeMarkdownTarget(src))
      return ''
    },
    link: (text, { href }) => {
      targets.add(unescapeMarkdownTarget(href))
      return text
    },
  })

  return { headings, targets }
}

function unescapeMarkdownTarget(target) {
  return target.replace(/\\([^\p{L}\p{M}\p{N}\s])/gu, '$1')
}

function githubHeadingSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

export function validateRepository(root = repositoryRoot) {
  const paths = worktreePaths(root)
  const read = (filePath) => readFileSync(path.join(root, filePath), 'utf8')
  const markdownFiles = [...paths]
    .filter((filePath) => filePath.toLowerCase().endsWith('.md'))
    .map((filePath) => ({ path: filePath, source: read(filePath) }))
  return [
    ...validateAgentInstructions(read('CLAUDE.md')),
    ...validateMarkdownLinks(markdownFiles, paths),
  ]
}

if (import.meta.main) {
  const errors = validateRepository()
  if (errors.length > 0) {
    for (const error of errors) console.error(`[template-check] ${error}`)
    process.exitCode = 1
  } else {
    console.log('Template check passed.')
  }
}
