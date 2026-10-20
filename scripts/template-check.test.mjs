import { expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateRepository } from './template-check.mjs'

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
