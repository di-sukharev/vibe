import type { Decorator, Preview } from '@storybook/react-vite'
import { ThemeProvider } from 'next-themes'

import { TooltipProvider } from '@/components/ui/tooltip'
import './storybook.css'

const withAppProviders: Decorator = (Story, context) => {
  const theme = context.globals.theme === 'dark' ? 'dark' : 'light'

  return (
    <ThemeProvider
      attribute="class"
      disableTransitionOnChange
      enableSystem={false}
      forcedTheme={theme}
    >
      <TooltipProvider>
        <div className="min-h-32 bg-background p-6 text-foreground">
          <Story />
        </div>
      </TooltipProvider>
    </ThemeProvider>
  )
}

const preview: Preview = {
  decorators: [withAppProviders],
  globalTypes: {
    theme: {
      description: 'Application color theme',
      toolbar: {
        dynamicTitle: true,
        icon: 'paintbrush',
        items: [
          { icon: 'sun', title: 'Light', value: 'light' },
          { icon: 'moon', title: 'Dark', value: 'dark' },
        ],
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  parameters: {
    a11y: {
      test: 'todo',
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
