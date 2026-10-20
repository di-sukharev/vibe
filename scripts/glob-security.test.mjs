import { test } from 'bun:test'
import { execFileSync } from 'node:child_process'

test('brace expansion handles deeply nested patterns without exhausting the stack', () => {
  // CVE-2026-93687: these patterns fit the input limit but overflow the old walkers.
  execFileSync('node', ['--stack-size=512', '--input-type=commonjs', '-e', `
    const assert = require('node:assert/strict')
    const braces = require('braces')

    assert.deepEqual(braces.expand('src/{api,ui}/{01..02}.ts'), [
      'src/api/01.ts', 'src/api/02.ts', 'src/ui/01.ts', 'src/ui/02.ts',
    ])

    for (const [open, close] of [['{', '}'], ['(', ')']]) {
      const pattern = open.repeat(4500) + 'a,b' + close.repeat(4500)
      assert.equal(typeof braces.compile(pattern), 'string')
      assert.ok(braces.expand(pattern).length > 0)
      assert.equal(braces.stringify(pattern), pattern)
    }
  `], { cwd: new URL('..', import.meta.url), timeout: 5000, stdio: 'pipe' })
})
