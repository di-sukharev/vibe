import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  core: { disableTelemetry: true },
  framework: {
    name: '@storybook/react-vite',
    options: { builder: { viteConfigPath: '.storybook/vite.config.ts' } },
  },
  staticDirs: ['../public'],
  stories: ['../src/stories/**/*.stories.@(ts|tsx)'],
  async viteFinal(config) {
    const { mergeConfig } = await import('vite')
    return mergeConfig(config, { build: { chunkSizeWarningLimit: 1500 } })
  },
}

export default config
