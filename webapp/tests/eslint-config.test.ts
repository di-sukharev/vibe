import { expect, test } from 'bun:test'
import { ESLint } from 'eslint'
import { resolve } from 'node:path'

test('the typography policy ignores technical text containers but keeps visible UI text guarded', async () => {
  const eslint = new ESLint({ cwd: resolve(import.meta.dir, '..') })
  const [result] = await eslint.lintText(
    `
      export function TechnicalText() {
        const css = '.example { color: red }'
        return <><title>Demo</title><style>{css}</style><svg><text>42</text></svg></>
      }

      export function VisibleText() {
        return <div>Visible product copy</div>
      }
    `,
    { filePath: resolve(import.meta.dir, '..', 'src', 'eslint-policy-fixture.tsx') },
  )

  const typographyMessages = result.messages.filter(
    ({ ruleId }) => ruleId === 'typographyPolicy/use-typography-component',
  )
  expect(typographyMessages).toHaveLength(1)
  expect(typographyMessages[0]?.message).toContain('<div>')
})
