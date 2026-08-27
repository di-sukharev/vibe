import type { Meta, StoryObj } from '@storybook/react-vite'

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
    <div className="site-container grid gap-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
      {colors.map(([label, background]) => <div className="rounded-xl border bg-card p-2 text-card-foreground" key={label}><div aria-hidden="true" className={`${background} h-24 rounded-lg border`} /><div className="grid gap-1 p-3"><p className="font-heading text-sm font-bold">{label}</p><p className="text-xs text-muted-foreground">{background}</p></div></div>)}
    </div>
  ),
}

export const TypographyScale: Story = {
  render: () => (
    <div className="site-container grid max-w-3xl gap-7 py-10">
      {[['Display', 'text-5xl sm:text-6xl'], ['Heading 1', 'text-4xl'], ['Heading 2', 'text-3xl'], ['Heading 3', 'text-2xl'], ['Body', 'text-base leading-7'], ['Small', 'text-sm leading-6']].map(([label, classes]) => <div className="grid gap-2 border-b pb-5" key={label}><p className="text-xs tracking-wider text-muted-foreground uppercase">{label}</p><p className={`font-heading font-bold ${classes}`}>Build a clear product surface.</p></div>)}
    </div>
  ),
}
