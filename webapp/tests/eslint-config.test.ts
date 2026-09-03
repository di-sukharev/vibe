import { expect, test } from 'bun:test'
import { ESLint } from 'eslint'
import { resolve } from 'node:path'

async function lintTypography(source: string) {
  const eslint = new ESLint({ cwd: resolve(import.meta.dir, '..') })
  const [result] = await eslint.lintText(source, {
    filePath: resolve(import.meta.dir, '..', 'src', 'eslint-policy-fixture.tsx'),
  })
  return result.messages.filter(
    ({ ruleId }) => ruleId === 'typographyPolicy/use-typography-component',
  )
}

test('the typography policy ignores technical text containers but keeps visible UI text guarded', async () => {
  const typographyMessages = await lintTypography(`
      export function TechnicalText() {
        const css = '.example { color: red }'
        return <><title>Demo</title><style>{css}</style><svg><text>42</text></svg></>
      }

      export function VisibleText() {
        return <div>Visible product copy</div>
      }
    `)
  expect(typographyMessages).toHaveLength(1)
  expect(typographyMessages[0]?.message).toContain('<div>')
})

test('the typography policy flags a raw semantic element even without text children', async () => {
  const typographyMessages = await lintTypography(`
      export function Heading() {
        return <h1 />
      }
    `)
  expect(typographyMessages).toHaveLength(1)
  expect(typographyMessages[0]?.message).toContain('<h1>')
})

test('the typography policy lets Typography asChild pass its raw child through unguarded, for both raw text and a raw semantic element', async () => {
  const typographyMessages = await lintTypography(`
      export function Label() {
        return (
          <Typography asChild>
            <div>Visible text</div>
          </Typography>
        )
      }

      export function Heading() {
        return (
          <Typography asChild>
            <h1>Visible heading</h1>
          </Typography>
        )
      }
    `)
  expect(typographyMessages).toHaveLength(0)
})

test('the typography policy ignores other technical text containers beyond title/style/svg', async () => {
  const typographyMessages = await lintTypography(`
      export function Choice() {
        return <option>Choice</option>
      }
    `)
  expect(typographyMessages).toHaveLength(0)
})
