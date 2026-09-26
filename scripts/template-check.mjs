import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Repository drift checks: Markdown links and anchors, the CLAUDE.md import of AGENTS.md,
// the CHECKLIST.md capability registry, bootstrap cleanup after a completed install, and the
// `.agents/skills` / `.claude/skills` Agent Skills.

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

// Agent Skills: SKILL.md frontmatter (Codex's canonical `.agents/skills`, symlinked from
// `.claude/skills` for Claude Code). Keep the checks small; this repo hand-parses only the two
// spec keys it uses, `name` and `description`, as flat single-line `key: value` frontmatter.
const skillNamePattern = /^[a-z0-9]+(-[a-z0-9]+)*$/
const skillNameLimit = 64
const skillDescriptionLimit = 1024 // The Agent Skills spec limit.
const skillLineLimit = 500
// A folded (`>`) or literal (`|`) block-scalar header, with optional chomping and indentation
// indicators in either order. The flat parser below would read only this header as the value.
const yamlBlockScalarPattern = /^[>|](?:[+-]?\d?|\d[+-]?)$/

export function validateSkill(dirName, source) {
  const errors = []
  const label = `.agents/skills/${dirName}/SKILL.md`
  const frontmatter = skillFrontmatter(source)
  if (!frontmatter) {
    errors.push(`${label} must start with YAML frontmatter ("---" ... "---").`)
    return errors
  }

  const { fields, invalidLines, yaml } = frontmatter
  const { name, description } = fields
  if (name === undefined) {
    errors.push(`${label} frontmatter must set "name".`)
  } else {
    if (name !== dirName) {
      errors.push(`${label} frontmatter "name" ("${name}") must equal its directory name "${dirName}".`)
    }
    if (!skillNamePattern.test(name)) {
      errors.push(`${label} frontmatter "name" must match ${skillNamePattern.source}; found "${name}".`)
    }
    if (name.length > skillNameLimit) {
      errors.push(`${label} frontmatter "name" has ${name.length} characters; keep it at most ${skillNameLimit}.`)
    }
  }

  if (!description) {
    errors.push(`${label} frontmatter "description" must not be empty.`)
  } else if (yamlBlockScalarPattern.test(description)) {
    errors.push(
      `${label} frontmatter "description" is a YAML block scalar ("${description}"); write it on one line so its length can be checked.`,
    )
  } else if (description.length > skillDescriptionLimit) {
    errors.push(
      `${label} frontmatter "description" has ${description.length} characters; keep it at most ${skillDescriptionLimit}, the Agent Skills spec limit.`,
    )
  }
  // A block scalar's continuation lines are already reported through the error above.
  if (invalidLines.length > 0 && !yamlBlockScalarPattern.test(description ?? '')) {
    const shown = invalidLines[0].length > 60 ? `${invalidLines[0].slice(0, 60)}…` : invalidLines[0]
    errors.push(
      `${label} frontmatter line "${shown}" is not a single-line "key: value"; keep every value, the description included, on one line.`,
    )
  } else if (invalidLines.length === 0 && !yamlBlockScalarPattern.test(description ?? '')) {
    // Skill loaders parse YAML: an unquoted ": " breaks the block, and an unquoted " #" cuts the
    // value short. Either way the loader would not see the value checked above.
    const changed = ['name', 'description'].filter((key) => fields[key] && yaml.parsed?.[key] !== fields[key])
    if (yaml.error || changed.length > 0) {
      errors.push(
        `${label} frontmatter is not the same YAML: ${yaml.error ?? `"${changed.join('", "')}" parses differently`}. Quote the value, for example description: "Use when: ...".`,
      )
    }
  }

  const lineCount = source.replace(/\r?\n$/, '').split(/\r?\n/).length
  if (lineCount > skillLineLimit) {
    errors.push(`${label} has ${lineCount} lines; keep it at most ${skillLineLimit}.`)
  }
  return errors
}

// A flat `key: value` frontmatter block. No folded, block-scalar, or wrapped values: every
// SKILL.md this repo writes keeps `name` and `description` on one line each. Any other non-blank
// line (an indented continuation, a bare key) is returned in `invalidLines`, because this parser
// would otherwise drop it and measure only the first line of a wrapped value.
const skillFrontmatterLinePattern = /^[A-Za-z0-9_-]+:\s/

function skillFrontmatter(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return undefined

  const fields = {}
  const invalidLines = []
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === '') continue
    if (!skillFrontmatterLinePattern.test(line)) {
      invalidLines.push(line)
      continue
    }
    const separator = line.indexOf(':')
    const key = line.slice(0, separator)
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    fields[key] = value
  }
  let yaml
  try {
    yaml = { parsed: Bun.YAML.parse(match[1]) }
  } catch (error) {
    yaml = { error: error.message }
  }
  return { fields, invalidLines, yaml }
}

// `.claude/skills` must be a symlink to `.agents/skills`, Codex's canonical location, so the two
// tools read identical files instead of a copy that can drift. The link text itself must be the
// relative `../.agents/skills`: an absolute target resolves here but breaks in every other clone.
const skillsSymlinkTarget = '../.agents/skills'
export function validateSkillsSymlink(root = repositoryRoot) {
  const linkPath = path.join(root, '.claude', 'skills')
  let stats
  try {
    stats = lstatSync(linkPath)
  } catch {
    return ['.claude/skills must exist as a symlink to .agents/skills.']
  }
  if (!stats.isSymbolicLink()) {
    return ['.claude/skills must be a symlink to .agents/skills, not a real file or directory.']
  }

  const target = readlinkSync(linkPath)
  if (target !== skillsSymlinkTarget) {
    return [`.claude/skills must be the relative symlink "${skillsSymlinkTarget}"; it points to "${target}".`]
  }
  return []
}

// Every directory under `.agents/skills` must have a SKILL.md; one that does not is reported
// directly and left out of the returned files.
export function readSkillFiles(root = repositoryRoot) {
  const skillsRoot = path.join(root, '.agents', 'skills')
  let entries
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true })
  } catch {
    return { errors: [], files: [] }
  }

  const errors = []
  const files = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const relativePath = path.posix.join('.agents', 'skills', entry.name, 'SKILL.md')
    const absolutePath = path.join(skillsRoot, entry.name, 'SKILL.md')
    if (!existsSync(absolutePath)) {
      errors.push(`.agents/skills/${entry.name} must have a SKILL.md.`)
      continue
    }
    files.push({ dirName: entry.name, path: relativePath, source: readFileSync(absolutePath, 'utf8') })
  }
  return { errors, files }
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
  const { errors: skillErrors, files: skillFiles } = readSkillFiles()

  return [
    ...validateChecklist(read('CHECKLIST.md'), agents),
    ...validateAgentInstructions(agents, read('CLAUDE.md')),
    ...validateMarkdownLinks(markdownFiles, paths),
    ...validateSkillsSymlink(),
    ...skillErrors,
    ...skillFiles.flatMap((file) => validateSkill(file.dirName, file.source)),
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
