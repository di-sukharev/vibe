import '@fontsource-variable/inter'
import type { Decorator, Preview } from '@storybook/react-vite'
import { ThemeProvider } from 'next-themes'

import { TooltipProvider } from '@/components/ui/tooltip'
import './storybook.css'

const withWebsiteProviders: Decorator = (Story) => (
  <ThemeProvider
    attribute="class"
    disableTransitionOnChange
    enableSystem={false}
    forcedTheme="dark"
  >
    <TooltipProvider>
      <div className="dark min-h-32 bg-background p-6 text-foreground">
        <Story />
      </div>
    </TooltipProvider>
  </ThemeProvider>
)

const preview: Preview = {
  decorators: [withWebsiteProviders],
  parameters: {
    a11y: {
      test: 'todo',
    },
    backgrounds: {
      default: 'website',
      values: [{ name: 'website', value: '#0f0f0f' }],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
}

export default preview
