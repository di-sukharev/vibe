import type { Meta, StoryObj } from '@storybook/react-vite'

import { Typography } from '@/components/typography'

const meta = {
  component: Typography,
  title: 'Components/Typography',
} satisfies Meta<typeof Typography>

export default meta
type Story = StoryObj<typeof meta>

export const Scale: Story = {
  render: () => (
    <div className="grid max-w-3xl gap-4 p-5">
      {(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((variant) => (
        <Typography key={variant} variant={variant}>
          {variant.toUpperCase()} — Build consistent interfaces
        </Typography>
      ))}
      <Typography variant="lead">Lead text introduces a section without competing with its title.</Typography>
      <Typography>Body text carries the primary reading experience across the application.</Typography>
      <Typography tone="muted" variant="bodySm">Muted supporting text provides useful context.</Typography>
      <Typography variant="code">bun run storybook:webapp</Typography>
    </div>
  ),
}
