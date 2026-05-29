import { expect, mock, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

type PrimitiveProps = React.HTMLAttributes<HTMLElement> & {
  asChild?: boolean
  children?: React.ReactNode
}

function Primitive(tag: keyof React.JSX.IntrinsicElements) {
  return function Component({ asChild, ...props }: PrimitiveProps) {
    void asChild
    return React.createElement(tag, props)
  }
}

function Portal({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function Root({ children }: { children?: React.ReactNode }) {
  return <>{children}</>
}

function SlotRoot({
  children,
  className,
  ...props
}: PrimitiveProps) {
  const child = React.Children.only(children)

  if (!React.isValidElement<{ className?: string }>(child)) {
    return null
  }

  return React.cloneElement(child, {
    ...props,
    ...child.props,
    className: [className, child.props.className].filter(Boolean).join(' '),
  })
}

const div = Primitive('div')
const h2 = Primitive('h2')
const p = Primitive('p')
const span = Primitive('span')

mock.module('radix-ui', () => ({
  Dialog: {
    Close: Primitive('button'),
    Content: div,
    Description: p,
    Overlay: div,
    Portal,
    Root,
    Title: h2,
    Trigger: Primitive('button'),
  },
  DropdownMenu: {
    CheckboxItem: div,
    Content: div,
    Group: div,
    Item: div,
    ItemIndicator: span,
    Label: div,
    Portal,
    RadioGroup: div,
    RadioItem: div,
    Root,
    Separator: div,
    Shortcut: span,
    Sub: Root,
    SubContent: div,
    SubTrigger: div,
    Trigger: Primitive('button'),
  },
  Select: {
    Content: div,
    Group: div,
    Icon: span,
    Item: div,
    ItemIndicator: span,
    ItemText: span,
    Label: div,
    Portal,
    Root,
    ScrollDownButton: div,
    ScrollUpButton: div,
    Separator: div,
    Trigger: Primitive('button'),
    Value: span,
    Viewport: div,
  },
  Slot: {
    Root: SlotRoot,
  },
}))

test('wrapped Radix-like primitives keep child slots and Typography classes at runtime', async () => {
  const { Button } = await import('../src/components/ui/button')
  const { DialogDescription, DialogTitle } = await import(
    '../src/components/ui/dialog'
  )
  const { DropdownMenuItem } = await import(
    '../src/components/ui/dropdown-menu'
  )
  const { SelectItem } = await import('../src/components/ui/select')

  const markup = renderToStaticMarkup(
    <>
      <Button asChild className="text-background">
        <a href="/settings">Settings</a>
      </Button>
      <DialogTitle className="custom-title">Title</DialogTitle>
      <DialogDescription>Description</DialogDescription>
      <DropdownMenuItem className="custom-menu">Open</DropdownMenuItem>
      <SelectItem className="custom-select" value="alpha">
        Alpha
      </SelectItem>
    </>,
  )

  expect(markup).toContain('href="/settings"')
  expect(markup).toContain('data-slot="button"')
  expect(markup).toContain('text-background')
  expect(markup).toContain('text-sm leading-none font-medium')

  expect(markup).toContain('data-slot="dialog-title"')
  expect(markup).toContain('custom-title')
  expect(markup).toContain('font-heading text-base')

  expect(markup).toContain('data-slot="dialog-description"')
  expect(markup).toContain('text-muted-foreground')

  expect(markup).toContain('data-slot="dropdown-menu-item"')
  expect(markup).toContain('custom-menu')
  expect(markup).toContain('data-slot="select-item"')
  expect(markup).toContain('custom-select')
  expect(markup).toContain('text-sm leading-normal font-normal')
  expect(markup).not.toContain('data-slot="typography"')
})
