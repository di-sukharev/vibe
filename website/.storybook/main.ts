import path from 'node:path'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import type { StorybookConfig } from '@storybook/react-vite'
import { mergeConfig } from 'vite'

const configDirectory = path.dirname(fileURLToPath(import.meta.url))

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
    return mergeConfig(viteConfig, {
      build: {
        chunkSizeWarningLimit: 1500,
      },
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(configDirectory, '../src'),
        },
      },
    })
  },
}

export default config
