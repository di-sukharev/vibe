import { expect, test } from 'bun:test'
import { ESLint } from 'eslint'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { Button } from '../src/components/ui/button'
import { Typography } from '../src/components/ui/typography'

const webRoot = resolve(import.meta.dir, '..')

async function lintPolicyFixture(source: string) {
  const eslint = new ESLint({
    cwd: webRoot,
    overrideConfigFile: resolve(webRoot, 'eslint.config.js'),
  })
  const [result] = await eslint.lintText(source, {
    filePath: resolve(webRoot, 'src/typography-policy.fixture.tsx'),
  })

  return result?.messages
    .filter(
      (message) =>
        message.ruleId === 'typographyPolicy/use-typography-component',
    )
    .map((message) => message.message)
}

test('typography policy allows direct asChild semantic text slots', async () => {
  const messages = await lintPolicyFixture(`
    import { Typography } from '@/components/ui/typography'

    export function Fixture() {
      return (
        <Typography asChild variant="body">
          <p>Allowed text</p>
        </Typography>
      )
    }
  `)

  expect(messages).toEqual([])
})

test('typography policy rejects raw semantic text inside non-slotted Typography', async () => {
  const messages = await lintPolicyFixture(`
    import { Typography } from '@/components/ui/typography'

    export function Fixture() {
      return (
        <Typography variant="body">
          <p>Invalid nested text</p>
        </Typography>
      )
    }
  `)

  expect(messages).toContain('Use <Typography> for semantic text elements instead of raw <p>.')
})

test('typography policy rejects raw text in DOM elements', async () => {
  const messages = await lintPolicyFixture(`
    const label = 'Click me'
    const error = { message: 'Required' }
    const formatDate = (value: Date) => value.toISOString()

    export function Fixture() {
      return (
        <>
          <button>{label}</button>
          <span>{'Inline copy'}</span>
          <li>{error.message}</li>
          <span>{formatDate(new Date())}</span>
        </>
      )
    }
  `)

  expect(messages).toEqual(
    expect.arrayContaining([
      'Wrap text content in <button> with <Typography> instead of raw JSX text.',
      'Wrap text content in <span> with <Typography> instead of raw JSX text.',
      'Wrap text content in <li> with <Typography> instead of raw JSX text.',
    ]),
  )
})

test('typography policy allows passthrough children in layout containers', async () => {
  const messages = await lintPolicyFixture(`
    export function Fixture({ children }: { children: React.ReactNode }) {
      return <div>{children}</div>
    }
  `)

  expect(messages).toEqual([])
})

test('typography policy allows render collections and formatter slots', async () => {
  const messages = await lintPolicyFixture(`
    import { Typography } from '@/components/ui/typography'

    const items = [{ id: 'a', label: 'Alpha' }]

    export function Fixture({
      formatter,
    }: {
      formatter: () => React.ReactNode
    }) {
      return (
        <>
          <div>
            {items.map((item) => (
              <Typography key={item.id}>{item.label}</Typography>
            ))}
          </div>
          <div>{formatter()}</div>
        </>
      )
    }
  `)

  expect(messages).toEqual([])
})

test('typography policy allows native option text labels', async () => {
  const messages = await lintPolicyFixture(`
    const label = 'Alpha'

    export function Fixture() {
      return (
        <select>
          <option value="a">Alpha</option>
          <option value="b">{label}</option>
        </select>
      )
    }
  `)

  expect(messages).toEqual([])
})

test('typography policy rejects className typography utilities outside variants', async () => {
  const messages = await lintPolicyFixture(`
    export function Fixture() {
      return (
        <div className="text-[13px] md:text-[length:13px] text-sm/6 md:text-lg/7 text-[13px]/[18px] font-black leading-[1.1] tracking-[.01em] !font-[500] md:text-sm">
          Invalid utility
        </div>
      )
    }
  `)

  expect(messages).toEqual(
    expect.arrayContaining([
      'Move typography utility "text-[13px]" into the Typography component variants.',
      'Move typography utility "text-[length:13px]" into the Typography component variants.',
      'Move typography utility "text-sm/6" into the Typography component variants.',
      'Move typography utility "text-lg/7" into the Typography component variants.',
      'Move typography utility "text-[13px]/[18px]" into the Typography component variants.',
      'Move typography utility "font-black" into the Typography component variants.',
      'Move typography utility "leading-[1.1]" into the Typography component variants.',
      'Move typography utility "tracking-[.01em]" into the Typography component variants.',
      'Move typography utility "font-[500]" into the Typography component variants.',
      'Move typography utility "text-sm" into the Typography component variants.',
    ]),
  )
})

test('typography policy rejects typography utilities in class constants passed to className', async () => {
  const messages = await lintPolicyFixture(`
    const raw = 'text-sm font-bold'

    export function Fixture() {
      return <div className={raw} />
    }
  `)

  expect(messages).toEqual(
    expect.arrayContaining([
      'Move typography utility "text-sm" into the Typography component variants.',
      'Move typography utility "font-bold" into the Typography component variants.',
    ]),
  )
})

test('typography policy allows shadowed class constant identifiers', async () => {
  const messages = await lintPolicyFixture(`
    const raw = 'text-sm'
    const classes = { root: 'text-sm' }

    export function Fixture({
      classes,
      raw,
    }: {
      classes: { root: string }
      raw: string
    }) {
      return (
        <>
          <div className={raw} />
          <div className={classes.root} />
        </>
      )
    }
  `)

  expect(messages).toEqual([])
})

test('typography policy rejects typography utilities in object class constants', async () => {
  const messages = await lintPolicyFixture(`
    const classes = {
      root: 'text-sm font-bold',
      ['label']: 'tracking-wide',
    }

    export function Fixture() {
      return (
        <>
          <div className={classes.root} />
          <div className={classes['label']} />
        </>
      )
    }
  `)

  expect(messages).toEqual(
    expect.arrayContaining([
      'Move typography utility "text-sm" into the Typography component variants.',
      'Move typography utility "font-bold" into the Typography component variants.',
      'Move typography utility "tracking-wide" into the Typography component variants.',
    ]),
  )
})

test('typography policy rejects typography utilities in class helpers', async () => {
  const messages = await lintPolicyFixture(`
    function cn(...values: string[]) {
      return values.join(' ')
    }

    function cva(base: string, config?: unknown) {
      return [base, config]
    }

    export const menuItemClassName = cn('rounded-md', 'font-extrabold')
    export const rawClassName = 'text-sm font-bold'
    export const composedClassName = cn(rawClassName, 'rounded-md')
    export const chipVariants = cva('inline-flex', {
      variants: {
        size: {
          sm: 'text-sm font-light',
        },
      },
    })
  `)

  expect(messages).toEqual(
    expect.arrayContaining([
      'Move typography utility "font-extrabold" into the Typography component variants.',
      'Move typography utility "text-sm" into the Typography component variants.',
      'Move typography utility "font-bold" into the Typography component variants.',
      'Move typography utility "font-light" into the Typography component variants.',
    ]),
  )
})

test('typography policy allows non-class copy strings', async () => {
  const messages = await lintPolicyFixture(`
    export const copy = 'Use font-black and text-[13px] in docs as plain words.'
  `)

  expect(messages).toEqual([])
})

test('typography policy allows arbitrary text color utilities', async () => {
  const messages = await lintPolicyFixture(`
    export function Fixture() {
      return <div className="text-[CanvasText] text-muted-foreground" />
    }
  `)

  expect(messages).toEqual([])
})

test('toggle group items inherit control typography through Typography', () => {
  const source = readFileSync(
    resolve(webRoot, 'src/components/ui/toggle-group.tsx'),
    'utf8',
  )

  expect(source).toContain('<Typography asChild variant="control">')
  expect(source).toContain('<ToggleGroupPrimitive.Item')
})

test('current tone inherits color without forcing text-current', () => {
  const source = readFileSync(
    resolve(webRoot, 'src/components/ui/typography.tsx'),
    'utf8',
  )

  expect(source).toContain('current: ""')
  expect(source).not.toContain('tracking-normal text-current')
})

test('Typography asChild preserves child-owned data slots', () => {
  function CustomRoot(props: React.ComponentProps<'div'>) {
    return React.createElement('div', {
      'data-slot': 'calendar',
      ...props,
    })
  }

  const markup = renderToStaticMarkup(
    React.createElement(
      Typography,
      { asChild: true, variant: 'calendar' },
      React.createElement(CustomRoot),
    ),
  )

  expect(markup).toContain('data-slot="calendar"')
  expect(markup).not.toContain('data-slot="typography"')
  expect(markup).toContain('data-variant="calendar"')
})

test('Typography asChild merges runtime props through representative primitives', () => {
  const buttonMarkup = renderToStaticMarkup(
    React.createElement(
      Button,
      { asChild: true, className: 'text-background' },
      React.createElement('a', { href: '/settings' }, 'Settings'),
    ),
  )
  const calendarDayMarkup = renderToStaticMarkup(
    React.createElement(
      Typography,
      { asChild: true, className: 'custom-day', variant: 'calendarDay' },
      React.createElement(
        'button',
        { 'data-slot': 'button', 'data-variant': 'ghost' },
        React.createElement('span', null, '14'),
      ),
    ),
  )

  expect(buttonMarkup).toContain('<a ')
  expect(buttonMarkup).toContain('href="/settings"')
  expect(buttonMarkup).toContain('data-slot="button"')
  expect(buttonMarkup).toContain('data-variant="default"')
  expect(buttonMarkup).toContain('text-background')
  expect(buttonMarkup).toContain('text-sm leading-none font-medium')
  expect(buttonMarkup).not.toContain('data-slot="typography"')

  expect(calendarDayMarkup).toContain('<button ')
  expect(calendarDayMarkup).toContain('data-slot="button"')
  expect(calendarDayMarkup).toContain('data-variant="ghost"')
  expect(calendarDayMarkup).toContain('text-sm leading-none font-normal')
  expect(calendarDayMarkup).toContain('custom-day')
  expect(calendarDayMarkup).not.toContain('data-slot="typography"')
})

test('Typography as supports element-specific runtime attributes', () => {
  const markup = renderToStaticMarkup(
    React.createElement(
      Typography,
      { as: 'a', href: '/docs', variant: 'bodySm' },
      'Docs',
    ),
  )

  expect(markup).toContain('<a ')
  expect(markup).toContain('href="/docs"')
  expect(markup).toContain('data-slot="typography"')
  expect(markup).toContain('data-variant="bodySm"')
})

test('calendar typography is owned by Typography variants', () => {
  const typographySource = readFileSync(
    resolve(webRoot, 'src/components/ui/typography.tsx'),
    'utf8',
  )
  const calendarSource = readFileSync(
    resolve(webRoot, 'src/components/ui/calendar.tsx'),
    'utf8',
  )

  expect(typographySource).toContain('calendar:')
  expect(typographySource).toContain('calendarDay:')
  expect(calendarSource).toContain('<Typography asChild variant="calendar">')
  expect(calendarSource).toContain('data-slot="calendar"')
  expect(calendarSource).toContain('<Typography asChild variant="calendarDay">')
  expect(calendarSource).not.toContain('[&>span]:text-xs')
})

test('select items use wrapping body typography instead of control nowrap', () => {
  const source = readFileSync(
    resolve(webRoot, 'src/components/ui/select.tsx'),
    'utf8',
  )
  const selectItemSource = source.slice(
    source.indexOf('function SelectItem'),
    source.indexOf('function SelectSeparator'),
  )

  expect(selectItemSource).toContain('<Typography asChild variant="bodySm">')
  expect(selectItemSource).not.toContain('variant="control"')
})

test('command generated group headings keep typography-owned styling', () => {
  const typographySource = readFileSync(
    resolve(webRoot, 'src/components/ui/typography.tsx'),
    'utf8',
  )
  const commandSource = readFileSync(
    resolve(webRoot, 'src/components/ui/command.tsx'),
    'utf8',
  )

  expect(typographySource).toContain('commandGroup:')
  expect(typographySource).toContain('**:[[cmdk-group-heading]]:text-xs')
  expect(typographySource).toContain('**:[[cmdk-group-heading]]:font-medium')
  expect(commandSource).toContain(
    '<Typography asChild variant="commandGroup" tone="default">',
  )
})

test('kbd and file input preserve component-specific typography variants', () => {
  const typographySource = readFileSync(
    resolve(webRoot, 'src/components/ui/typography.tsx'),
    'utf8',
  )
  const kbdSource = readFileSync(
    resolve(webRoot, 'src/components/ui/kbd.tsx'),
    'utf8',
  )

  expect(typographySource).toContain('kbd: "font-sans text-xs')
  expect(typographySource).toContain('file:text-sm file:font-medium')
  expect(kbdSource).toContain('variant="kbd"')
})
