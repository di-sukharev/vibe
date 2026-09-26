import { describe, expect, test } from 'bun:test'

import {
  agentInstructionsWordBudget,
  validateAgentInstructions,
  validateChecklist,
  validateMarkdownLinks,
} from './template-check.mjs'

const agents = [
  '# AGENTS.md',
  '',
  '<!-- BOOTSTRAP_ONLY_START -->',
  '## New project setup',
  '<!-- BOOTSTRAP_ONLY_END -->',
  '',
  '## Workflow',
].join('\n')
const cleanAgents = '# AGENTS.md\n\n## Workflow\n'

function checklist({ status = 'not started', rows = [] } = {}) {
  return [
    '# Чеклист установки',
    '',
    `**Статус установки:** \`${status}\``,
    '',
    '## Реестр возможностей',
    '',
    '| Возможность | Состояние | Примечание |',
    '| --- | --- | --- |',
    '| Auth (email + password) | included | Базовая возможность. |',
    ...rows,
  ].join('\n')
}

describe('Markdown links', () => {
  const guide = { path: 'docs/GUIDE.md', source: '# Гайд\n\n## Установка и запуск\n\n## Установка и запуск\n' }

  function linkErrors(readme) {
    const files = [{ path: 'README.md', source: readme }, guide]
    return validateMarkdownLinks(files, new Set(['README.md', 'docs/GUIDE.md', 'docs/logo.png']))
  }

  test('accepts files, directories, Cyrillic anchors, and duplicate-heading suffixes', () => {
    const readme = [
      '# Readme',
      '[guide](docs/GUIDE.md) [docs](docs/) [self](#readme) ![logo](docs/logo.png)',
      '[setup](docs/GUIDE.md#установка-и-запуск) [again](docs/GUIDE.md#установка-и-запуск-1)',
      '[encoded](docs/GUIDE.md#%D0%B3%D0%B0%D0%B9%D0%B4) [web](https://example.com/missing.md)',
      '```md',
      '[example only](missing.md)',
      '```',
    ].join('\n')
    expect(linkErrors(readme)).toEqual([])
  })

  test('reports a missing file, a missing anchor, and a link outside the repository', () => {
    const readme = '[gone](docs/GONE.md)\n[anchor](docs/GUIDE.md#нет-такого)\n[up](../secret.md)'
    expect(linkErrors(readme)).toEqual([
      'README.md links to missing tracked target "docs/GONE.md".',
      'README.md links to missing Markdown heading "#нет-такого" in "docs/GUIDE.md".',
      'README.md contains a local link outside the repository: "../secret.md".',
    ])
  })
})

describe('CLAUDE.md import', () => {
  const missingImport =
    'CLAUDE.md must load the shared instructions with a standalone `@AGENTS.md` import line.'

  test('accepts a standalone import line', () => {
    expect(validateAgentInstructions(agents, '@AGENTS.md\n')).toEqual([])
  })

  test('rejects a missing, inline, or fenced import', () => {
    expect(validateAgentInstructions(agents, 'Read AGENTS.md first.')).toEqual([missingImport])
    expect(validateAgentInstructions(agents, 'Load `@AGENTS.md`.')).toEqual([missingImport])
    expect(validateAgentInstructions(agents, '```text\n@AGENTS.md\n```')).toEqual([missingImport])
  })

  test('rejects a restated AGENTS.md section', () => {
    expect(validateAgentInstructions(agents, '@AGENTS.md\n\n## Workflow\n\nCopied rules.')).toEqual([
      'CLAUDE.md must not restate AGENTS.md sections; it imports them with `@AGENTS.md`.',
    ])
  })

  test('keeps AGENTS.md within its word budget', () => {
    const atBudget = `${agents}\n${'word '.repeat(agentInstructionsWordBudget - agents.split(/\s+/).length)}`
    expect(validateAgentInstructions(atBudget, '@AGENTS.md\n')).toEqual([])
    expect(validateAgentInstructions(`${atBudget} extra`, '@AGENTS.md\n')).toEqual([
      `AGENTS.md has ${agentInstructionsWordBudget + 1} words; keep it at most ${agentInstructionsWordBudget}. Move area detail into docs/ or an app README.`,
    ])
  })
})

describe('CHECKLIST.md capability registry', () => {
  test('accepts valid states under a Russian or an English header', () => {
    expect(validateChecklist(checklist({ rows: ['| Push notifications | absent | |'] }), agents)).toEqual([])
    const english = checklist().replace('| Возможность | Состояние |', '| Capability | State |')
    expect(validateChecklist(english, agents)).toEqual([])
  })

  test('rejects an invalid state and a duplicate capability', () => {
    const rows = ['| Push notifications | enabled | |', '| Auth (email + password) | absent | |']
    expect(validateChecklist(checklist({ rows }), agents)).toEqual([
      'Capability "Push notifications" has invalid state "enabled".',
      'Capability ledger contains duplicate capability "Auth (email + password)".',
    ])
  })

  test('reports a missing table; fenced or commented tables do not count', () => {
    const missing = [
      'CHECKLIST.md has no capability ledger table with a "Capability | State" or "Возможность | Состояние" header.',
    ]
    expect(validateChecklist('# Чеклист установки\n', agents)).toEqual(missing)
    expect(validateChecklist(`\`\`\`md\n${checklist()}\n\`\`\``, agents)).toEqual(missing)
    expect(validateChecklist(`<!--\n${checklist()}\n-->`, agents)).toEqual(missing)
  })
})

describe('CHECKLIST.md install status', () => {
  const leftover =
    'A completed install must remove the BOOTSTRAP_ONLY section and its markers from AGENTS.md.'

  test('rejects bootstrap markers in AGENTS.md after a completed install', () => {
    const completed = checklist({ status: 'completed 2026-09-25' })
    expect(validateChecklist(completed, agents)).toEqual([leftover])
    expect(validateChecklist(completed.replace('Статус установки', 'Install status'), agents)).toEqual([
      leftover,
    ])
  })

  test('accepts a completed install without markers, an unfinished install, and a missing status', () => {
    expect(validateChecklist(checklist({ status: 'completed 2026-09-25' }), cleanAgents)).toEqual([])
    expect(validateChecklist(checklist({ status: 'in progress' }), agents)).toEqual([])
    const noStatus = checklist({ status: 'completed 2026-09-25' }).replace(/^\*\*.*$/m, '')
    expect(validateChecklist(noStatus, agents)).toEqual([])
  })
})
