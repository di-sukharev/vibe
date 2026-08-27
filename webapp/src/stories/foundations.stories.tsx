import type { Meta, StoryObj } from '@storybook/react-vite'

import { Typography } from '@/components/typography'

const meta = {
  title: 'Foundations/Tokens',
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const colors = [
  ['Background', 'bg-background', 'text-foreground'],
  ['Card', 'bg-card', 'text-card-foreground'],
  ['Primary', 'bg-primary', 'text-primary-foreground'],
  ['Secondary', 'bg-secondary', 'text-secondary-foreground'],
  ['Muted', 'bg-muted', 'text-muted-foreground'],
  ['Destructive', 'bg-destructive', 'text-white'],
] as const

export const Colors: Story = {
  render: () => (
    <div className="mx-auto grid max-w-5xl gap-4 p-6 sm:grid-cols-2 lg:grid-cols-3">
      {colors.map(([label, background]) => (
        <div className="rounded-xl border bg-card p-2 text-card-foreground" key={label}>
          <div aria-hidden="true" className={`${background} h-24 rounded-lg border`} />
          <div className="grid gap-1 p-3">
            <Typography variant="bodySmMedium">{label}</Typography>
            <Typography tone="muted" variant="caption">{background}</Typography>
          </div>
        </div>
      ))}
    </div>
  ),
}

export const TypographyScale: Story = {
  render: () => (
    <div className="mx-auto grid max-w-3xl gap-5 p-6">
      {(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'lead', 'body', 'bodySm', 'caption', 'code'] as const).map((variant) => (
        <div className="grid gap-1 border-b pb-4" key={variant}>
          <Typography variant="caption" tone="muted">{variant}</Typography>
          <Typography variant={variant}>The quick brown fox builds a consistent interface.</Typography>
        </div>
      ))}
    </div>
  ),
}
