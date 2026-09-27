import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repository drift checks: Markdown links and anchors, the CLAUDE.md import of AGENTS.md,
// the CHECKLIST.md capability registry, and bootstrap cleanup after a completed install.

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const capabilityStates = new Set(['included', 'available', 'absent', 'removed'])
const bootstrapMarkers = ['<!-- BOOTSTRAP_ONLY_START -->', '<!-- BOOTSTRAP_ONLY_END -->']

// CHECKLIST.md: valid, unique capability states; a completed install has no bootstrap block in AGENTS.md.
export function validateChecklist(checklist, agents = '') {
  const errors = []
  const rows = capabilityRows(checklist)
  if (!rows) {
    errors.push(
      'CHECKLIST.md has no capability ledger table with a "Capability | State" or "Возможность | Состояние" header.',
    )
  }

  const names = new Set()
  for (const { name, state } of rows ?? []) {
    if (!capabilityStates.has(state)) errors.push(`Capability "${name}" has invalid state "${state}".`)
    if (names.has(name)) errors.push(`Capability ledger contains duplicate capability "${name}".`)
    names.add(name)
  }

  const completed = /^completed\b/i.test(installStatus(checklist) ?? '')
  if (completed && bootstrapMarkers.some((marker) => agents.includes(marker))) {
    errors.push('A completed install must remove the BOOTSTRAP_ONLY section and its markers from AGENTS.md.')
  }
  return errors
}

// Rows of the capability registry table, found by its header in English or Russian.
// Returns undefined when CHECKLIST.md has no such table. Fenced code and HTML comments do not count.
export function capabilityRows(checklist) {
  const lines = withoutFencedCode(checklist).replace(/<!--[\s\S]*?(?:-->|$)/g, '').split('\n')
  const header = lines.findIndex((line) => {
    const [capability, state] = tableCells(line) ?? []
    return ['Capability', 'Возможность'].includes(capability) && ['State', 'Состояние'].includes(state)
  })
  if (header === -1) return undefined

  const rows = []
  for (const line of lines.slice(header + 1)) {
    const cells = tableCells(line)
    if (!cells) break
    if (cells.every((cell) => /^:?-+:?$/.test(cell))) continue
    rows.push({ name: cells[0], state: cells[1] ?? '' })
  }
  return rows
}

// Every agent session loads AGENTS.md, so its size is a per-session token cost. Area detail
// belongs in docs/ and app READMEs, which agents read on demand.
export const agentInstructionsWordBudget = 1500

// CLAUDE.md must import AGENTS.md outside fenced code and must not copy its "## " sections.
export function validateAgentInstructions(agents, claude) {
  const errors = []
  const lines = withoutFencedCode(claude).split('\n').map((line) => line.trim())
  const sections = new Set(
    withoutFencedCode(agents).split('\n').map((line) => line.trim()).filter((line) => line.startsWith('## ')),
  )
  const words = agents.split(/\s+/).filter(Boolean).length

  if (words > agentInstructionsWordBudget) {
    errors.push(
      `AGENTS.md has ${words} words; keep it at most ${agentInstructionsWordBudget}. Move area detail into docs/ or an app README.`,
    )
  }
  if (!lines.includes('@AGENTS.md')) {
    errors.push('CLAUDE.md must load the shared instructions with a standalone `@AGENTS.md` import line.')
  }
  if (lines.some((line) => sections.has(line))) {
    errors.push('CLAUDE.md must not restate AGENTS.md sections; it imports them with `@AGENTS.md`.')
  }
  return errors
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

// Lenient: the first backticked value on the status line, or undefined without one.
function installStatus(checklist) {
  return withoutFencedCode(checklist).match(
    /^\*\*(?:Install status|Статус установки):\*\*[^`\n]*`([^`\n]*)`/m,
  )?.[1]
}

function tableCells(line) {
  const row = line.trim()
  if (!row.startsWith('|')) return undefined
  return row.slice(1).replace(/(?<!\\)\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim())
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

function validateRepository() {
  const paths = worktreePaths()
  const read = (filePath) => readFileSync(path.join(repositoryRoot, filePath), 'utf8')
  const markdownFiles = [...paths]
    .filter((filePath) => filePath.toLowerCase().endsWith('.md'))
    .map((filePath) => ({ path: filePath, source: read(filePath) }))
  const agents = read('AGENTS.md')

  return [
    ...validateChecklist(read('CHECKLIST.md'), agents),
    ...validateAgentInstructions(agents, read('CLAUDE.md')),
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
