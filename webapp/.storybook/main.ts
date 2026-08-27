import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  core: {
    disableTelemetry: true,
  },
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  staticDirs: ['../public'],
  stories: ['../src/stories/**/*.stories.@(ts|tsx)'],
  async viteFinal(viteConfig) {
    const { mergeConfig } = await import('vite')

    return mergeConfig(viteConfig, {
      build: {
        chunkSizeWarningLimit: 1500,
      },
    })
  },
}

export default config
