import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'bun:test'

import {
  agentInstructionsWordBudget,
  readSkillFiles,
  validateAgentInstructions,
  validateChecklist,
  validateMarkdownLinks,
  validateSkill,
  validateSkillsSymlink,
} from './template-check.mjs'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Fixture roots for the filesystem-touching skill checks (the symlink and the skill directory
// listing). Built fresh per test under `.scratch/`, per AGENTS.md, and removed afterward.
function withFixtureRoot(build, run) {
  const scratchDir = path.join(repositoryRoot, '.scratch')
  mkdirSync(scratchDir, { recursive: true })
  const root = mkdtempSync(path.join(scratchDir, 'template-check-'))
  try {
    build(root)
    run(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function writeSkill(root, name, source) {
  const dir = path.join(root, '.agents', 'skills', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, 'SKILL.md'), source)
}

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

describe('Agent Skills: frontmatter', () => {
  function skillSource({ name = 'feature', description = 'Does the thing. Use it for the thing.', totalLines } = {}) {
    const header = ['---', `name: ${name}`, `description: ${description}`, '---']
    const body = totalLines === undefined
      ? ['', '## Steps', '', '1. Do it.']
      : Array.from({ length: Math.max(totalLines - header.length, 0) }, () => '')
    return `${[...header, ...body].join('\n')}\n`
  }

  test('accepts a valid skill', () => {
    expect(validateSkill('feature', skillSource())).toEqual([])
  })

  test('rejects a missing frontmatter block', () => {
    expect(validateSkill('feature', '## Steps\n\n1. Do it.\n')).toEqual([
      '.agents/skills/feature/SKILL.md must start with YAML frontmatter ("---" ... "---").',
    ])
  })

  test('rejects a name that does not match the directory, the naming pattern, or the length limit', () => {
    expect(validateSkill('feature', skillSource({ name: 'other' }))).toEqual([
      '.agents/skills/feature/SKILL.md frontmatter "name" ("other") must equal its directory name "feature".',
    ])
    expect(validateSkill('Feature_1', skillSource({ name: 'Feature_1' }))).toEqual([
      '.agents/skills/Feature_1/SKILL.md frontmatter "name" must match ^[a-z0-9]+(-[a-z0-9]+)*$; found "Feature_1".',
    ])
    const longName = 'a'.repeat(65)
    expect(validateSkill(longName, skillSource({ name: longName }))).toEqual([
      `.agents/skills/${longName}/SKILL.md frontmatter "name" has 65 characters; keep it at most 64.`,
    ])
  })

  test('rejects a missing or empty description', () => {
    const noDescription = '---\nname: feature\n---\n\n## Steps\n'
    expect(validateSkill('feature', noDescription)).toEqual([
      '.agents/skills/feature/SKILL.md frontmatter "description" must not be empty.',
    ])
    expect(validateSkill('feature', skillSource({ description: '' }))).toEqual([
      '.agents/skills/feature/SKILL.md frontmatter "description" must not be empty.',
    ])
  })

  test('rejects a description over the Agent Skills spec limit', () => {
    const longDescription = 'a'.repeat(1025)
    expect(validateSkill('feature', skillSource({ description: longDescription }))).toEqual([
      '.agents/skills/feature/SKILL.md frontmatter "description" has 1025 characters; keep it at most 1024, the Agent Skills spec limit.',
    ])
  })

  test('rejects a block-scalar description, whose length the check could not measure', () => {
    for (const indicator of ['>', '>-', '>+', '|', '|-', '|+', '>2', '|2-', '>-2']) {
      const source = `---\nname: feature\ndescription: ${indicator}\n  Does the thing.\n  Use it for the thing.\n---\n`
      expect(validateSkill('feature', source)).toHaveLength(1)
    }
    expect(validateSkill('feature', skillSource({ description: 'Keeps a > b and a | b as text.' }))).toEqual([])
  })

  test('rejects a description wrapped onto continuation lines, whatever they contain', () => {
    const wrapped = '---\nname: feature\ndescription: Scaffolds a feature.\n  Use when the user asks: build X.\n---\n'
    const overLimit = `---\nname: feature\ndescription: Scaffolds a feature.\n  ${'x'.repeat(2000)}\n---\n`
    for (const source of [wrapped, overLimit]) {
      expect(validateSkill('feature', source)).toHaveLength(1)
    }
  })

  test('rejects a description that YAML cannot parse or would cut short', () => {
    // An unquoted ": " is a YAML syntax error; an unquoted " #" starts a comment.
    for (const description of ['Deploys. Use when: the user asks.', 'Deploys the app #1 priority.']) {
      expect(validateSkill('feature', skillSource({ description }))).toHaveLength(1)
    }
    expect(validateSkill('feature', skillSource({ description: '"Deploys. Use when: the user asks."' }))).toEqual([])
  })

  test('rejects a SKILL.md over 500 lines', () => {
    expect(validateSkill('feature', skillSource({ totalLines: 501 }))).toEqual([
      '.agents/skills/feature/SKILL.md has 501 lines; keep it at most 500.',
    ])
  })
})

describe('Agent Skills: .claude/skills symlink', () => {
  test('accepts a symlink that resolves to .agents/skills', () => {
    withFixtureRoot(
      (root) => {
        mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true })
        mkdirSync(path.join(root, '.claude'), { recursive: true })
        symlinkSync(path.join('..', '.agents', 'skills'), path.join(root, '.claude', 'skills'))
      },
      (root) => expect(validateSkillsSymlink(root)).toEqual([]),
    )
  })

  test('rejects a missing .claude/skills', () => {
    withFixtureRoot(
      (root) => mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true }),
      (root) =>
        expect(validateSkillsSymlink(root)).toEqual([
          '.claude/skills must exist as a symlink to .agents/skills.',
        ]),
    )
  })

  test('rejects a real directory in place of the symlink', () => {
    withFixtureRoot(
      (root) => mkdirSync(path.join(root, '.claude', 'skills'), { recursive: true }),
      (root) =>
        expect(validateSkillsSymlink(root)).toEqual([
          '.claude/skills must be a symlink to .agents/skills, not a real file or directory.',
        ]),
    )
  })

  test('rejects an absolute symlink, which would break in any other clone', () => {
    withFixtureRoot(
      (root) => {
        mkdirSync(path.join(root, '.agents', 'skills'), { recursive: true })
        mkdirSync(path.join(root, '.claude'), { recursive: true })
        symlinkSync(path.join(root, '.agents', 'skills'), path.join(root, '.claude', 'skills'))
      },
      (root) => expect(validateSkillsSymlink(root)).toHaveLength(1),
    )
  })

  test('rejects a symlink that resolves elsewhere', () => {
    withFixtureRoot(
      (root) => {
        mkdirSync(path.join(root, '.claude'), { recursive: true })
        mkdirSync(path.join(root, 'somewhere-else'), { recursive: true })
        symlinkSync(path.join('..', 'somewhere-else'), path.join(root, '.claude', 'skills'))
      },
      (root) => {
        const errors = validateSkillsSymlink(root)
        expect(errors).toHaveLength(1)
        expect(errors[0]).toContain('.claude/skills must be the relative symlink "../.agents/skills"; it points to')
      },
    )
  })
})

describe('Agent Skills: directory listing', () => {
  test('reads every skill with a SKILL.md', () => {
    withFixtureRoot(
      (root) => {
        writeSkill(root, 'feature', '---\nname: feature\ndescription: Does the thing.\n---\n')
        writeSkill(root, 'release', '---\nname: release\ndescription: Ships the thing.\n---\n')
      },
      (root) => {
        const { errors, files } = readSkillFiles(root)
        expect(errors).toEqual([])
        expect(files.map((file) => file.dirName).sort()).toEqual(['feature', 'release'])
      },
    )
  })

  test('reports a skill directory without a SKILL.md', () => {
    withFixtureRoot(
      (root) => mkdirSync(path.join(root, '.agents', 'skills', 'empty'), { recursive: true }),
      (root) => {
        const { errors, files } = readSkillFiles(root)
        expect(errors).toEqual(['.agents/skills/empty must have a SKILL.md.'])
        expect(files).toEqual([])
      },
    )
  })

  test('returns nothing when .agents/skills does not exist', () => {
    withFixtureRoot(
      () => {},
      (root) => expect(readSkillFiles(root)).toEqual({ errors: [], files: [] }),
    )
  })
})
