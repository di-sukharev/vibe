import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const requiredHeadings = [
  'Project identity',
  'Product',
  'Active surfaces',
  'First-version capabilities',
  'Files, images, and media',
  'Website data and freshness',
  'Payments',
  'Deployment',
  'Decided by the agent - do not ask the user',
  'Capability ledger',
  'Environment checks',
  'After setup',
]
const requiredIntakeQuestions = {
  'Project identity': [
    'New project from this template, or work on the template itself?',
    'Project name / slug',
    'Your own GitHub repository URL, if you have one',
  ],
  Product: [
    'What product do you want to build first?',
    'What is the first user journey that must work end to end?',
  ],
  'Active surfaces': [
    'Why the unmarked surfaces are deferred, if it needs explaining',
    'If `mobile` is active: are Expo/EAS builds, Expo Push, and Maestro E2E needed now, or left unconfigured until later?',
  ],
  'First-version capabilities': [
    'What the first version explicitly should NOT do (write "nothing ruled out" if that is the answer)',
  ],
  'Files, images, and media': [
    'What do users upload?',
    'Public, private, shared with selected people, or mixed?',
    'Who can upload, view, replace, and delete?',
    'Maximum file size and allowed file types',
    'Do images need thumbnails, resizing, format conversion, compression, cropping, or moderation?',
    'How long do files live after the owning record is deleted?',
    'Should filenames be visible to users, or opaque?',
  ],
  'Website data and freshness': [
    'Which public product or content data comes from the backend/database at website build time?',
    'How soon after that data changes must the public website show the change?',
    'Which changes require an automatic rebuild/redeploy rather than a manual release?',
  ],
  Payments: [
    'What exactly do users pay for?',
    'Recurring subscription, one-off purchase, or both?',
    'Does the public website need a local cart or offer selection before registration/sign-in?',
    'Which active surfaces need payment: browser checkout, App Store / Google Play, native card entry, Apple Pay, or Google Pay?',
    'What stops working when someone does not pay?',
  ],
  Deployment: [
    'Is deployment needed now, or local-only for the moment?',
    'Where are your users, and must the data stay in Russia?',
    'Hosting, picked by the agent from the answer above: DigitalOcean / Yandex Cloud / own server',
    'Production domains / URLs for API, webapp, and website; is Yandex CDN needed now?',
    'Which surfaces are released first',
  ],
}
const allowedCapabilityStates = new Set(['included', 'available', 'absent', 'removed'])
const requiredDeploymentHosts = ['DigitalOcean', 'Yandex Cloud', 'Own server']

export function validateChecklist(source, { agents = '', claude = '' } = {}) {
  const errors = []
  const checklist = withoutFencedCode(source)
  const sections = checklistSections(checklist)

  for (const required of requiredHeadings) {
    const matches = sections.filter((section) => section.name.toLowerCase() === required.toLowerCase())
    if (matches.length === 0) {
      errors.push(`CHECKLIST.md is missing required heading "${required}".`)
    } else if (matches.length > 1) {
      errors.push(`CHECKLIST.md contains duplicate heading "${required}".`)
    }
  }

  const status = installStatus(checklist)
  if (!status.valid) {
    errors.push(
      status.error ?? (status.value
        ? `CHECKLIST.md has invalid install status "${status.value}".`
        : 'CHECKLIST.md is missing its install status.'),
    )
  }

  errors.push(...validateIntakeStructure(checklist, sections))
  errors.push(...validateCapabilityLedger(sectionBody(checklist, sections, 'Capability ledger')))

  if (status.valid && status.value === 'not started') {
    const answeredCells = intakeQuestionRows(checklist, sections).map((cells) => cells[1])
    const inlineAnswersUntouched =
      checklist.includes('- [ ] External integrations (which: _unanswered_)') &&
      checklist.includes(
        '- [ ] Validation scope recorded for this project (which suites run before a change is called done): _unanswered_',
      )

    if (answeredCells.some((answer) => answer !== '_unanswered_') || !inlineAnswersUntouched) {
      errors.push(
        'A reusable template with status "not started" must keep every intake answer `_unanswered_`.',
      )
    }

    if (/^- \[[xX]\]/m.test(checklist)) {
      errors.push(
        'A reusable template with status "not started" must keep every checklist item unchecked.',
      )
    }
  }

  if (status.valid && status.value.startsWith('completed ')) {
    const coreSectionNames = Object.keys(requiredIntakeQuestions).filter(
      (sectionName) => sectionName !== 'Deployment',
    )
    const completedAnswers = intakeQuestionRows(checklist, sections, coreSectionNames)
      .map((cells) => cells[1])
    const completedIntake = requiredHeadings
      .slice(0, requiredHeadings.indexOf('Deployment'))
      .map((heading) => sectionBody(checklist, sections, heading))
      .join('\n')

    if (
      completedAnswers.some((answer) => answer === '' || answer === '_unanswered_') ||
      completedIntake.includes('_unanswered_')
    ) {
      errors.push(
        'A completed install must answer every row in sections Project identity through Payments.',
      )
    }

    const activeSurfaces = sectionBody(checklist, sections, 'Active surfaces')
    if (!/^- \[[xX]\]\s+`(?:backend|webapp|website|mobile)`/m.test(activeSurfaces)) {
      errors.push('A completed install must mark at least one active surface.')
    }

    if (hasBootstrapInstructions(agents) || hasBootstrapInstructions(claude)) {
      errors.push(
        'A completed install must remove Bootstrap-Only Instructions from AGENTS.md and CLAUDE.md.',
      )
    }
  }

  errors.push(...validateAgentInstructions(agents, claude))

  return [...new Set(errors)]
}

export function validateAgentInstructions(agents, claude) {
  if (
    normalizeAgentInstructions(agents, 'AGENTS.md') ===
    normalizeAgentInstructions(claude, 'CLAUDE.md')
  ) return []

  return [
    'AGENTS.md and CLAUDE.md differ beyond their document titles and reciprocal filename references.',
  ]
}

export function validateCapabilityContract(
  source,
  requiredCapabilities,
  { exclusiveState } = {},
) {
  const checklist = withoutFencedCode(source)
  const sections = checklistSections(checklist)
  const tables = markdownTableBlocks(sectionBody(checklist, sections, 'Capability ledger'))
  const rows = (tables.length === 1 ? tables[0].map((entry) => entry.cells) : []).filter(
    (cells) => cells.length >= 3 && !isTableHeaderOrSeparator(cells),
  )
  const states = new Map(rows.map(([capability, state]) => [capability, state]))
  const errors = []

  for (const [capability, expectedState] of Object.entries(requiredCapabilities)) {
    const actualState = states.get(capability)
    if (actualState === undefined) {
      errors.push(`Capability ledger is missing required capability "${capability}".`)
    } else if (actualState !== expectedState) {
      errors.push(
        `Capability "${capability}" must be "${expectedState}" for this template, found "${actualState}".`,
      )
    }
  }

  if (exclusiveState) {
    for (const [capability, state] of rows) {
      if (state === exclusiveState && !Object.hasOwn(requiredCapabilities, capability)) {
        errors.push(
          `Capability "${capability}" must not be "${exclusiveState}" for this template.`,
        )
      }
    }
  }

  return errors
}

export function validateMarkdownLinks(files, trackedPaths) {
  const errors = []
  const markdownSources = new Map(files.map((file) => [file.path, file.source]))
  const metadata = new Map(
    files.map((file) => [file.path, markdownMetadata(file.source)]),
  )

  for (const file of files) {
    for (const rawTarget of metadata.get(file.path).targets) {
      if (isExternalLink(rawTarget)) continue

      const [rawPathWithQuery, ...fragmentParts] = rawTarget.split('#')
      const rawPathPart = rawPathWithQuery.split('?', 1)[0]
      const rawFragment = fragmentParts.length > 0 ? fragmentParts.join('#') : undefined
      let decodedPath
      try {
        decodedPath = decodeURIComponent(rawPathPart)
      } catch {
        errors.push(`${file.path} contains a local link with invalid percent encoding: "${rawTarget}".`)
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

      if (
        rawFragment !== undefined &&
        rawFragment !== '' &&
        normalized.toLowerCase().endsWith('.md') &&
        markdownSources.has(normalized)
      ) {
        let fragment
        try {
          fragment = decodeURIComponent(rawFragment)
        } catch {
          errors.push(`${file.path} contains a local link with invalid percent encoding: "${rawTarget}".`)
          continue
        }

        if (!metadata.get(normalized).headings.has(fragment)) {
          errors.push(
            `${file.path} links to missing Markdown heading "#${fragment}" in "${normalized}".`,
          )
        }
      }
    }
  }

  return errors
}

export function worktreePaths(root = repositoryRoot) {
  const candidates = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)

  return new Set(candidates.filter((filePath) => existsSync(path.join(root, filePath))))
}

function checklistSections(source) {
  const matches = [...source.matchAll(/^##\s+(.+)$/gm)]
  return matches.map((match, index) => ({
    name: match[1].replace(/^\d+\.\s*/, '').trim(),
    start: match.index,
    bodyStart: match.index + match[0].length,
    end: matches[index + 1]?.index ?? source.length,
  }))
}

function sectionBody(source, sections, name) {
  const section = sections.find((candidate) => candidate.name.toLowerCase() === name.toLowerCase())
  return section ? source.slice(section.bodyStart, section.end) : ''
}

function validateIntakeStructure(source, sections) {
  const errors = []

  for (const [sectionName, requiredQuestions] of Object.entries(requiredIntakeQuestions)) {
    const allTables = markdownTableBlocks(sectionBody(source, sections, sectionName))
    const tables = allTables.filter(isQuestionAnswerTable)
    if (tables.length !== 1) {
      errors.push(
        `CHECKLIST.md section "${sectionName}" must contain exactly one Question/Answer intake table (found ${tables.length}).`,
      )
    }
    if (tables.length === 0) {
      continue
    }
    const table = tables[0]

    const [header] = table
    if (
      !header.closed ||
      header.cells.length !== 2 ||
      header.cells[0] !== 'Question' ||
      header.cells[1] !== 'Answer'
    ) {
      errors.push(`CHECKLIST.md section "${sectionName}" must start its intake table with Question and Answer columns.`)
    }

    const separator = table[1]
    if (
      !separator ||
      !separator.closed ||
      separator.cells.length !== 2 ||
      !separator.cells.every((cell) => /^:?-{3,}:?$/.test(cell))
    ) {
      errors.push(`CHECKLIST.md section "${sectionName}" must keep a two-column Markdown table separator.`)
    }

    if (table.filter((entry) => isQuestionAnswerHeader(entry.cells)).length !== 1) {
      errors.push(`CHECKLIST.md section "${sectionName}" must contain exactly one Question/Answer header row.`)
    }
    if (table.filter((entry) => isTableSeparator(entry.cells)).length !== 1) {
      errors.push(`CHECKLIST.md section "${sectionName}" must contain exactly one table separator row.`)
    }

    for (const entry of table) {
      if (!entry.closed) {
        errors.push(
          `CHECKLIST.md section "${sectionName}" has an intake row that does not end with "|": "${entry.cells[0] || '<empty>'}".`,
        )
      }
      if (entry.cells.length !== 2) {
        errors.push(
          `CHECKLIST.md section "${sectionName}" intake row "${entry.cells[0] || '<empty>'}" must contain exactly two columns (found ${entry.cells.length}).`,
        )
      }
    }

    const questionEntries = table.filter((entry) => !isTableHeaderOrSeparator(entry.cells))
    for (const question of requiredQuestions) {
      const matches = questionEntries.filter((entry) => entry.cells[0] === question)
      if (matches.length === 0) {
        errors.push(`CHECKLIST.md section "${sectionName}" is missing required question "${question}".`)
      } else if (matches.length > 1) {
        errors.push(`CHECKLIST.md section "${sectionName}" contains duplicate question "${question}".`)
      }
    }

    if (sectionName === 'Deployment') {
      const hostingTables = allTables.filter(isDeploymentHostingTable)
      if (hostingTables.length !== 1) {
        errors.push(
          `CHECKLIST.md Deployment section must contain exactly one hosting comparison table (found ${hostingTables.length}).`,
        )
      } else {
        errors.push(...validateDeploymentHostingTable(hostingTables[0]))
      }
    }
  }

  return errors
}

function intakeQuestionRows(source, sections, sectionNames = Object.keys(requiredIntakeQuestions)) {
  return sectionNames.flatMap((sectionName) =>
    intakeTableBlocks(sectionBody(source, sections, sectionName))
      .flat()
      .filter(
        (entry) =>
          entry.closed &&
          entry.cells.length === 2 &&
          !isTableHeaderOrSeparator(entry.cells),
      )
      .map((entry) => entry.cells),
  )
}

function validateDeploymentHostingTable(table) {
  const errors = []
  if (table.length !== 5) {
    errors.push(`CHECKLIST.md Deployment hosting comparison must contain exactly five rows (found ${table.length}).`)
  }
  const header = table[0]
  if (
    !header?.closed ||
    header.cells.length !== 3 ||
    header.cells[0] !== 'Hosting' ||
    header.cells[1] !== 'Chosen when' ||
    header.cells[2] !== 'What the template gives you'
  ) {
    errors.push('CHECKLIST.md Deployment section must keep its canonical hosting comparison header.')
  }

  const separator = table[1]
  if (
    !separator?.closed ||
    separator.cells.length !== 3 ||
    !isTableSeparator(separator.cells)
  ) {
    errors.push('CHECKLIST.md Deployment hosting comparison must keep a three-column separator.')
  }

  for (const entry of table) {
    if (!entry.closed || entry.cells.length !== 3) {
      errors.push('CHECKLIST.md Deployment hosting comparison rows must contain exactly three closed columns.')
      break
    }
  }

  const hostRows = table.slice(2).map((entry) => entry.cells[0])
  if (
    hostRows.length !== requiredDeploymentHosts.length ||
    hostRows.some((host, index) => host !== requiredDeploymentHosts[index])
  ) {
    errors.push(
      `CHECKLIST.md Deployment hosting comparison must contain only ${requiredDeploymentHosts.join(', ')} in that order.`,
    )
  }
  return errors
}

function installStatus(source) {
  const declarations = [...source.matchAll(/^\*\*Install status:\*\*.*$/gm)]
  if (declarations.length > 1) {
    return {
      valid: false,
      value: undefined,
      error: 'CHECKLIST.md must contain exactly one install status declaration.',
    }
  }

  const value = declarations[0]?.[0].match(/^\*\*Install status:\*\*\s+`([^`]+)`$/)?.[1]
  if (!value) return { valid: false, value: undefined }
  if (value === 'not started' || value === 'in progress') return { valid: true, value }

  const completed = value.match(/^completed (\d{4})-(\d{2})-(\d{2})$/)
  if (!completed) return { valid: false, value }

  const [, year, month, day] = completed
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`)
  const validDate = !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === `${year}-${month}-${day}`
  return { valid: validDate, value }
}

function validateCapabilityLedger(source) {
  const errors = []
  const names = new Set()
  const tables = markdownTableBlocks(source)
  if (tables.length !== 1) {
    errors.push(`Capability ledger must contain exactly one Markdown table (found ${tables.length}).`)
  }
  const entries = tables.flat()
  const rows = entries.filter((entry) => !isTableHeaderOrSeparator(entry.cells))

  const header = tables[0]?.[0]
  if (
    !header ||
    !header.closed ||
    header.cells.length !== 3 ||
    header.cells[0] !== 'Capability' ||
    header.cells[1] !== 'State' ||
    header.cells[2] !== 'Note'
  ) {
    errors.push('Capability ledger must start with Capability, State, and Note columns.')
  }

  const separator = tables[0]?.[1]
  if (
    !separator ||
    !separator.closed ||
    separator.cells.length !== 3 ||
    !separator.cells.every((cell) => /^:?-{3,}:?$/.test(cell))
  ) {
    errors.push('Capability ledger must keep a three-column Markdown table separator.')
  }
  if (entries.filter((entry) => isCapabilityHeader(entry.cells)).length !== 1) {
    errors.push('Capability ledger must contain exactly one Capability/State/Note header row.')
  }
  if (entries.filter((entry) => isTableSeparator(entry.cells)).length !== 1) {
    errors.push('Capability ledger must contain exactly one table separator row.')
  }

  if (rows.length === 0) errors.push('Capability ledger must contain at least one capability.')

  for (const entry of entries) {
    const { cells } = entry
    const [capability, state] = cells
    if (!entry.closed) {
      errors.push(
        `Capability ledger row for "${capability || '<empty>'}" must end with "|".`,
      )
    }
    if (cells.length !== 3) {
      errors.push(
        `Capability ledger row for "${capability || '<empty>'}" must contain exactly three columns (found ${cells.length}).`,
      )
    }
    if (!entry.closed || cells.length !== 3) {
      continue
    }

    if (isTableHeaderOrSeparator(cells)) continue

    if (!capability) {
      errors.push('Capability ledger contains an empty capability name.')
      continue
    }
    if (names.has(capability)) {
      errors.push(`Capability ledger contains duplicate capability "${capability}".`)
    }
    names.add(capability)

    if (!allowedCapabilityStates.has(state)) {
      errors.push(`Capability "${capability}" has invalid state "${state}".`)
    }
  }

  return errors
}

function markdownTableRows(source) {
  return markdownTableBlocks(source)
    .flat()
    .filter((entry) => entry.closed)
    .map((entry) => entry.cells)
}

function markdownTableBlocks(source) {
  const blocks = []
  let current = []

  for (const line of withoutFencedCode(source).split(/\r?\n/)) {
    if (line.trimStart().startsWith('|')) {
      current.push(parseMarkdownTableLine(line))
    } else if (current.length > 0) {
      blocks.push(current)
      current = []
    }
  }
  if (current.length > 0) blocks.push(current)
  return blocks
}

function intakeTableBlocks(source) {
  return markdownTableBlocks(source).filter(isQuestionAnswerTable)
}

function parseMarkdownTableLine(line) {
  const trimmed = line.trim()
  const closed = trimmed.endsWith('|')
  const content = closed ? trimmed.slice(1, -1) : trimmed.slice(1)
  return {
    cells: splitMarkdownTableCells(content).map((cell) => cell.trim()),
    closed,
  }
}

function splitMarkdownTableCells(content) {
  const cells = []
  let current = ''

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\\' && content[index + 1] === '|') {
      current += '|'
      index += 1
    } else if (content[index] === '|') {
      cells.push(current)
      current = ''
    } else {
      current += content[index]
    }
  }
  cells.push(current)
  return cells
}

function isTableHeaderOrSeparator(cells) {
  return isTableSeparator(cells) || isQuestionAnswerHeader(cells) || isCapabilityHeader(cells)
}

function isTableSeparator(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isQuestionAnswerHeader(cells) {
  return cells.length === 2 && cells[0] === 'Question' && cells[1] === 'Answer'
}

function isQuestionAnswerTable(table) {
  return isQuestionAnswerHeader(table[0]?.cells ?? [])
}

function isDeploymentHostingTable(table) {
  const cells = table[0]?.cells ?? []
  return cells.length === 3 &&
    cells[0] === 'Hosting' &&
    cells[1] === 'Chosen when' &&
    cells[2] === 'What the template gives you'
}

function isCapabilityHeader(cells) {
  return cells.length === 3 &&
    cells[0] === 'Capability' &&
    cells[1] === 'State' &&
    cells[2] === 'Note'
}

function hasBootstrapInstructions(source) {
  return source.includes('<!-- BOOTSTRAP_ONLY_START -->') ||
    source.includes('<!-- BOOTSTRAP_ONLY_END -->')
}

function normalizeAgentInstructions(source, fileName) {
  const peerName = fileName === 'AGENTS.md' ? 'CLAUDE.md' : 'AGENTS.md'
  const titlePattern = fileName === 'AGENTS.md' ? /^# AGENTS\.md$/m : /^# CLAUDE\.md$/m
  const reciprocalInstruction = `- When editing this file, keep equivalent agent files such as \`${peerName}\` aligned.`

  return source
    .replace(titlePattern, '# AGENT_INSTRUCTIONS.md')
    .replace(
      reciprocalInstruction,
      '- When editing this file, keep the peer agent file aligned.',
    )
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
        if (
          closing &&
          closing[0] === fence.character &&
          closing.length >= fence.length
        ) {
          fence = undefined
        }
        return false
      }
      return true
    })
    .join('\n')
}

function isExternalLink(target) {
  return target.startsWith('//') || /^[A-Za-z][A-Za-z\d+.-]*:/.test(target)
}

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
  const currentPaths = worktreePaths()
  const markdownFiles = [...currentPaths]
    .filter((filePath) => filePath.toLowerCase().endsWith('.md'))
    .map((filePath) => ({
      path: filePath,
      source: readFileSync(path.join(repositoryRoot, filePath), 'utf8'),
    }))
  const checklist = readFileSync(path.join(repositoryRoot, 'CHECKLIST.md'), 'utf8')
  const agents = readFileSync(path.join(repositoryRoot, 'AGENTS.md'), 'utf8')
  const claude = readFileSync(path.join(repositoryRoot, 'CLAUDE.md'), 'utf8')

  return [
    ...validateChecklist(checklist, { agents, claude }),
    ...validateMarkdownLinks(markdownFiles, currentPaths),
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
