import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import {
  validateAgentInstructions,
  validateChecklist,
  validateMarkdownLinks,
  worktreePaths,
} from './template-check.mjs'

const repositoryRoot = resolve(import.meta.dir, '..')
const currentChecklist = readFileSync(resolve(repositoryRoot, 'CHECKLIST.md'), 'utf8')
const currentAgents = readFileSync(resolve(repositoryRoot, 'AGENTS.md'), 'utf8')
const currentClaude = readFileSync(resolve(repositoryRoot, 'CLAUDE.md'), 'utf8')
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('template checklist validation', () => {
  test('accepts the pristine reusable template', () => {
    expect(validateChecklist(currentChecklist, { agents: currentAgents, claude: currentClaude })).toEqual([])
  })

  test('accepts the mobile template capability states without depending on a branch ref', () => {
    const checklistWithPayments = /^\| Payments \/ subscriptions\s+\|/m.test(currentChecklist)
      ? currentChecklist
      : currentChecklist.replace(
        /^(\| Browser checkout \/ payments\s+\| absent\s+\|.*)$/m,
        '$1\n| Payments / subscriptions        | available | Mobile store subscriptions are available. |',
      )
    const mobileChecklist = checklistWithPayments
      .replace(
        /^(\| Payments \/ subscriptions\s+\|)\s*(?:included|available|absent|removed)(\s+\|)/m,
        '$1 available$2',
      )
      .replace(
        /^(\| Push notifications\s+\|)\s*(?:included|available|absent|removed)(\s+\|)/m,
        '$1 available$2',
      )
      .replace(
        /^(\| Social sign-in \(Apple \/ Google\)\s+\|)\s*(?:included|available|absent|removed)(\s+\|)/m,
        '$1 available$2',
      )

    expect(
      validateChecklist(mobileChecklist, { agents: currentAgents, claude: currentClaude }),
    ).toEqual([])
  })

  test('rejects missing and duplicate semantic headings even when numbers change', () => {
    const renumbered = currentChecklist.replace('## 1. Project identity', '## 20. Project identity')
    expect(validateChecklist(renumbered, { agents: currentAgents, claude: currentClaude })).toEqual([])

    const missing = currentChecklist.replace('## 2. Product', '## Product removed')
    expect(validateChecklist(missing, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md is missing required heading "Product".',
    )

    const duplicate = currentChecklist.replace('## 2. Product', '## 2. Product\n\n## Product')
    expect(validateChecklist(duplicate, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md contains duplicate heading "Product".',
    )

    const fencedHeading = currentChecklist.replace(
      '## 1. Project identity',
      '```md\n## 1. Project identity\n```',
    )
    expect(validateChecklist(fencedHeading, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md is missing required heading "Project identity".',
    )

    const commentedHeading = currentChecklist.replace(
      '## 2. Product',
      '<!--\n## 2. Product\n-->',
    )
    expect(
      validateChecklist(commentedHeading, { agents: currentAgents, claude: currentClaude }),
    ).toContain('CHECKLIST.md is missing required heading "Product".')

    const nestedShorterFence = `${currentChecklist}\n\`\`\`\`md\n\`\`\`\n**Install status:** \`completed 2026-08-16\`\n\`\`\`\``
    expect(validateChecklist(nestedShorterFence, { agents: currentAgents, claude: currentClaude })).toEqual([])
  })

  test('rejects malformed install status and invalid or duplicate ledger rows', () => {
    const malformedStatus = currentChecklist.replace('`not started`', '`almost ready`')
    expect(validateChecklist(malformedStatus, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md has invalid install status "almost ready".',
    )

    const duplicateStatus = currentChecklist.replace(
      '**Install status:** `not started`',
      '**Install status:** `not started`\n**Install status:** `completed 2026-08-16`',
    )
    expect(validateChecklist(duplicateStatus, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md must contain exactly one install status declaration.',
    )

    const invalidState = currentChecklist.replace('| Auth (email + password)         | included |', '| Auth (email + password)         | enabled  |')
    expect(validateChecklist(invalidState, { agents: currentAgents, claude: currentClaude })).toContain(
      'Capability "Auth (email + password)" has invalid state "enabled".',
    )

    const duplicateCapability = currentChecklist.replace(
      '| Admin roles                     | included |',
      '| Auth (email + password)         | included |',
    )
    expect(validateChecklist(duplicateCapability, { agents: currentAgents, claude: currentClaude })).toContain(
      'Capability ledger contains duplicate capability "Auth (email + password)".',
    )

    const missingColumns = currentChecklist.replace(
      /^\| Auth \(email \+ password\).*$/m,
      '| Auth (email + password) |',
    )
    expect(validateChecklist(missingColumns, { agents: currentAgents, claude: currentClaude })).toContain(
      'Capability ledger row for "Auth (email + password)" must contain exactly three columns (found 1).',
    )

    const extraColumns = currentChecklist.replace(
      /^\| Auth \(email \+ password\).*$/m,
      '| Auth (email + password) | included | Baseline. | unexpected |',
    )
    expect(validateChecklist(extraColumns, { agents: currentAgents, claude: currentClaude })).toContain(
      'Capability ledger row for "Auth (email + password)" must contain exactly three columns (found 4).',
    )

    const unclosedRow = currentChecklist.replace(
      /^\| Auth \(email \+ password\).*$/m,
      '| Auth (email + password) | definitely-invalid | malformed note',
    )
    expect(validateChecklist(unclosedRow, { agents: currentAgents, claude: currentClaude })).toContain(
      'Capability ledger row for "Auth (email + password)" must end with "|".',
    )

    const missingLedgerScaffold = currentChecklist.replace(
      /^\| Capability[^\n]*\n\| -[^\n]*$/m,
      '',
    )
    const ledgerErrors = validateChecklist(missingLedgerScaffold, {
      agents: currentAgents,
      claude: currentClaude,
    })
    expect(ledgerErrors).toContain(
      'Capability ledger must start with Capability, State, and Note columns.',
    )
    expect(ledgerErrors).toContain(
      'Capability ledger must keep a three-column Markdown table separator.',
    )

    const commentedLedger = currentChecklist.replace(
      /(## 10\. Capability ledger\n\n)([\s\S]*?)(\n\n## 11\. Environment checks)/,
      '$1<!--\n$2\n-->$3',
    )
    expect(
      validateChecklist(commentedLedger, { agents: currentAgents, claude: currentClaude }),
    ).toContain('Capability ledger must start with Capability, State, and Note columns.')

    const separatorShapedNote = currentChecklist.replace(
      /^\| Auth \(email \+ password\).*$/m,
      '| Auth (email + password) | enabled | --- |',
    )
    expect(validateChecklist(separatorShapedNote, { agents: currentAgents, claude: currentClaude })).toContain(
      'Capability "Auth (email + password)" has invalid state "enabled".',
    )

    const duplicateLedgerHeader = currentChecklist.replace(
      /^(\| Capability[^\n]*\n\| -[^\n]*)$/m,
      '$1\n| Capability | State | Note |',
    )
    expect(validateChecklist(duplicateLedgerHeader, { agents: currentAgents, claude: currentClaude })).toContain(
      'Capability ledger must contain exactly one Capability/State/Note header row.',
    )

    const duplicateLedgerSeparator = currentChecklist.replace(
      /^(\| Capability[^\n]*\n\| -[^\n]*)$/m,
      '$1\n| --- | --- | --- |',
    )
    expect(validateChecklist(duplicateLedgerSeparator, { agents: currentAgents, claude: currentClaude })).toContain(
      'Capability ledger must contain exactly one table separator row.',
    )
  })

  test('keeps a reusable not-started intake pristine', () => {
    const answered = currentChecklist.replace('| Project name / slug                                             | _unanswered_ |', '| Project name / slug                                             | demo         |')
    expect(validateChecklist(answered, { agents: currentAgents, claude: currentClaude })).toContain(
      'A reusable template with status "not started" must keep every intake answer `_unanswered_`.',
    )

    const checked = currentChecklist.replace('- [ ] `backend` - API, database, auth', '- [x] `backend` - API, database, auth')
    expect(validateChecklist(checked, { agents: currentAgents, claude: currentClaude })).toContain(
      'A reusable template with status "not started" must keep every checklist item unchecked.',
    )

    const malformedIntake = currentChecklist.replace(
      /^\| Project name \/ slug.*$/m,
      '| Project name / slug | answered | extra |',
    )
    expect(validateChecklist(malformedIntake, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md section "Project identity" intake row "Project name / slug" must contain exactly two columns (found 3).',
    )

    const missingSeparator = currentChecklist.replace(
      '| --------------------------------------------------------------- | ------------ |',
      '',
    )
    expect(validateChecklist(missingSeparator, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md section "Project identity" must keep a two-column Markdown table separator.',
    )

    const extraIntakeTable = currentChecklist.replace(
      '## 2. Product',
      '| Question | Answer |\n| --- | --- |\n| Shadow answer | answered |\n\n## 2. Product',
    )
    expect(validateChecklist(extraIntakeTable, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md section "Project identity" must contain exactly one Question/Answer intake table (found 2).',
    )

    const informationalTable = currentChecklist.replace(
      '## 3. Active surfaces',
      '| Example | Meaning |\n| --- | --- |\n| MVP | First useful release |\n\n## 3. Active surfaces',
    )
    expect(
      validateChecklist(informationalTable, { agents: currentAgents, claude: currentClaude }),
    ).toEqual([])

    const escapedPipe = currentChecklist
      .replace('**Install status:** `not started`', '**Install status:** `in progress`')
      .replace(
        '| Project name / slug                                             | _unanswered_ |',
        '| Project name / slug                                             | web \\| mobile |',
      )
    expect(
      validateChecklist(escapedPipe, { agents: currentAgents, claude: currentClaude }),
    ).toEqual([])

    const extraHostingRow = currentChecklist.replace(
      /^\| Own server\s+\|.*$/m,
      '$&\n| Shadow host | Never | Nothing |',
    )
    expect(validateChecklist(extraHostingRow, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md Deployment hosting comparison must contain exactly five rows (found 6).',
    )

    const duplicateHostingHeader = currentChecklist.replace(
      /^(\| Hosting\s+\|.*\n\| -.*)$/m,
      '$1\n| Hosting | Chosen when | What the template gives you |',
    )
    expect(validateChecklist(duplicateHostingHeader, { agents: currentAgents, claude: currentClaude })).toContain(
      'CHECKLIST.md Deployment hosting comparison must contain exactly five rows (found 6).',
    )
  })

  test('requires completed installs to finish the core intake and remove bootstrap instructions', () => {
    const completed = completedChecklist()
    const cleanAgents = withoutBootstrapBlock(currentAgents)
    const cleanClaude = withoutBootstrapBlock(currentClaude)

    expect(validateChecklist(completed, { agents: cleanAgents, claude: cleanClaude })).toEqual([])

    const incomplete = completed.replace(
      /^(\| Project name \/ slug\s+\|) n\/a(\s+\|)$/m,
      '$1 _unanswered_$2',
    )
    expect(validateChecklist(incomplete, { agents: cleanAgents, claude: cleanClaude })).toContain(
      'A completed install must answer every row in sections Project identity through Payments.',
    )

    const emptyAnswer = completed.replace(
      /^(\| Project name \/ slug\s+\|) n\/a(\s+\|)$/m,
      '$1 $2',
    )
    expect(validateChecklist(emptyAnswer, { agents: cleanAgents, claude: cleanClaude })).toContain(
      'A completed install must answer every row in sections Project identity through Payments.',
    )

    const missingQuestion = completed.replace(
      /^\| What product do you want to build first\?.*$/m,
      '',
    )
    expect(validateChecklist(missingQuestion, { agents: cleanAgents, claude: cleanClaude })).toContain(
      'CHECKLIST.md section "Product" is missing required question "What product do you want to build first?".',
    )

    const noSurface = completed.replace('- [x] `website` - public pages', '- [ ] `website` - public pages')
    expect(validateChecklist(noSurface, { agents: cleanAgents, claude: cleanClaude })).toContain(
      'A completed install must mark at least one active surface.',
    )

    expect(validateChecklist(completed, { agents: currentAgents, claude: currentClaude })).toContain(
      'A completed install must remove Bootstrap-Only Instructions from AGENTS.md and CLAUDE.md.',
    )
  })
})

describe('agent instruction equivalence', () => {
  test('accepts only the intentional title and reciprocal filename differences', () => {
    expect(validateAgentInstructions(currentAgents, currentClaude)).toEqual([])

    const drifted = currentClaude.replace('Prefer evidence over ceremony.', 'Prefer guesses over evidence.')
    expect(validateAgentInstructions(currentAgents, drifted)).toEqual([
      'AGENTS.md and CLAUDE.md differ beyond their document titles and reciprocal filename references.',
    ])

    const hiddenFilenameDrift = currentClaude.replace(
      'from both `AGENTS.md` and `CLAUDE.md`',
      'from both `CLAUDE.md` and `CLAUDE.md`',
    )
    expect(validateAgentInstructions(currentAgents, hiddenFilenameDrift)).toEqual([
      'AGENTS.md and CLAUDE.md differ beyond their document titles and reciprocal filename references.',
    ])
  })
})

describe('tracked Markdown links', () => {
  test('accepts files, directories, heading fragments, external links, and fenced examples', () => {
    const files = [
      {
        path: 'README.md',
        source: [
          '# Testing',
          '[file](docs/TESTING.md)',
          '[file with query](README.md?plain=1)',
          '[directory](docs/)',
          '[encoded](docs/My%20Guide.md)',
          '[parenthesized](docs/My_(Guide).md)',
          '[nested parentheses](docs/Nested_((Guide)).md)',
          '[escaped parentheses](docs/A_\\(B\\).md)',
          '[root](./)',
          '[fragment](#testing)',
          '[file fragment](docs/TESTING.md#details--recovery)',
          '[setext fragment](docs/SETEXT.md#my-heading)',
          '[indented ATX](docs/Headings.md#heading)',
          '[inline-link heading](docs/Headings.md#guide)',
          '[reference-link heading](docs/ReferenceHeading.md#reference-guide)',
          '[entity heading](docs/Entities.md#fish--chips)',
          '[numeric entity heading](docs/Entities.md#cafe)',
          '[named entity heading](docs/Entities.md#copyright--2026)',
          '[reference guide][testing-guide]',
          '[testing-guide]: docs/TESTING.md',
          '[external](https://example.com/path)',
          '`[inline example](missing-inline.md)`',
          '<!-- [temporarily hidden](missing-comment.md) -->',
          '\\[literal](missing-literal.md)',
          '',
          '    [indented example](missing-indented.md)',
          '```md',
          '[example only](missing.md)',
          '```',
        ].join('\n'),
      },
      { path: 'docs/TESTING.md', source: '# Testing\n\n## Details & recovery' },
      { path: 'docs/My Guide.md', source: '# Guide' },
      { path: 'docs/My_(Guide).md', source: '# Parenthesized guide' },
      { path: 'docs/Nested_((Guide)).md', source: '# Nested guide' },
      { path: 'docs/SETEXT.md', source: 'My heading\n==========' },
      { path: 'docs/Headings.md', source: '   ## Heading\n\n# [Guide](A_(B).md)' },
      { path: 'docs/ReferenceHeading.md', source: '# [Reference Guide][ref]\n\n[ref]: A.md' },
      {
        path: 'docs/Entities.md',
        source: '# Fish &amp; Chips\n\n## &#67;afe\n\n## Copyright &copy; 2026',
      },
      { path: 'docs/A_(B).md', source: '# Inline destination' },
      { path: 'docs/A.md', source: '# Reference destination' },
    ]
    const trackedPaths = new Set(files.map((file) => file.path))

    expect(validateMarkdownLinks(files, trackedPaths)).toEqual([])
  })

  test('discovers current tracked and untracked files while excluding ignored and deleted paths', () => {
    const root = mkdtempSync(resolve(tmpdir(), 'template-check-'))
    temporaryDirectories.push(root)
    execFileSync('git', ['init', '--quiet'], { cwd: root })
    writeFileSync(resolve(root, '.gitignore'), 'ignored.md\n')
    writeFileSync(resolve(root, 'tracked.md'), '# Tracked\n')
    writeFileSync(resolve(root, 'deleted.md'), '# Deleted\n')
    execFileSync('git', ['add', '.gitignore', 'tracked.md', 'deleted.md'], { cwd: root })
    unlinkSync(resolve(root, 'deleted.md'))
    writeFileSync(resolve(root, 'untracked.md'), '# Untracked\n')
    writeFileSync(resolve(root, 'ignored.md'), '# Ignored\n')

    expect([...worktreePaths(root)].sort()).toEqual([
      '.gitignore',
      'tracked.md',
      'untracked.md',
    ])
  })

  test('rejects missing targets and traversal outside the repository', () => {
    const files = [
      {
        path: 'docs/TESTING.md',
        source: [
          '# Testing',
          '[missing](MISSING.md)',
          '[outside](../../private.md)',
          '[missing local heading](#definitely-missing)',
          '[missing file heading](GUIDE.md#definitely-missing)',
          '[indented code is not a heading](CODE.md#code)',
          '[nested missing](MISSING_((a)).md)',
          '[outer [inner]](MISSING-NESTED.md)',
          '- outer',
          '  - inner',
          '    - deep',
          '',
          '        [real list link](LIST-MISSING.md)',
          '',
          '[missing reference][missing-guide]',
          '',
          '[missing-guide]: MISSING-GUIDE.md',
          '```md`oops',
          '[invalid fence link](INVALID-FENCE.md)',
        ].join('\n'),
      },
      { path: 'docs/GUIDE.md', source: '# Guide' },
      { path: 'docs/CODE.md', source: '    Code\n---' },
    ]

    expect(validateMarkdownLinks(files, new Set(files.map((file) => file.path)))).toEqual([
      'docs/TESTING.md links to missing tracked target "docs/MISSING.md".',
      'docs/TESTING.md contains a local link outside the repository: "../../private.md".',
      'docs/TESTING.md links to missing Markdown heading "#definitely-missing" in "docs/TESTING.md".',
      'docs/TESTING.md links to missing Markdown heading "#definitely-missing" in "docs/GUIDE.md".',
      'docs/TESTING.md links to missing Markdown heading "#code" in "docs/CODE.md".',
      'docs/TESTING.md links to missing tracked target "docs/MISSING_((a)).md".',
      'docs/TESTING.md links to missing tracked target "docs/MISSING-NESTED.md".',
      'docs/TESTING.md links to missing tracked target "docs/LIST-MISSING.md".',
      'docs/TESTING.md links to missing tracked target "docs/MISSING-GUIDE.md".',
      'docs/TESTING.md links to missing tracked target "docs/INVALID-FENCE.md".',
    ])
  })
})

function completedChecklist() {
  const deploymentStart = currentChecklist.indexOf('## 8. Deployment')
  const completed = `${currentChecklist.slice(0, deploymentStart).replaceAll('_unanswered_', 'n/a')}${currentChecklist.slice(deploymentStart)}`

  return completed
    .replace('**Install status:** `not started`', '**Install status:** `completed 2026-08-16`')
    .replace('- [ ] `website`', '- [x] `website`')
}

function withoutBootstrapBlock(source) {
  return source.replace(
    /## Bootstrap-Only Instructions\n\n<!-- BOOTSTRAP_ONLY_START -->[\s\S]*?<!-- BOOTSTRAP_ONLY_END -->\n\n/,
    '',
  )
}
