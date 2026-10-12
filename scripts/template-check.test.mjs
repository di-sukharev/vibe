import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  validateAgentInstructions,
  validateMarkdownLinks,
  validateRepository,
} from './template-check.mjs'

test('checks an installed project after its setup files are deleted', () => {
  const root = mkdtempSync(join(tmpdir(), 'template-check-'))
  try {
    execFileSync('git', ['init', '--quiet', root])
    writeFileSync(join(root, 'AGENTS.md'), '# AGENTS.md\n')
    writeFileSync(join(root, 'CLAUDE.md'), '@AGENTS.md\n')
    writeFileSync(join(root, 'README.md'), '# Product\n\n[Rules](AGENTS.md)\n')
    expect(validateRepository(root)).toEqual([])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

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
    expect(validateAgentInstructions('@AGENTS.md\n')).toEqual([])
  })

  test('rejects a missing, inline, or fenced import', () => {
    expect(validateAgentInstructions('Read AGENTS.md first.')).toEqual([missingImport])
    expect(validateAgentInstructions('Load `@AGENTS.md`.')).toEqual([missingImport])
    expect(validateAgentInstructions('```text\n@AGENTS.md\n```')).toEqual([missingImport])
  })
})
