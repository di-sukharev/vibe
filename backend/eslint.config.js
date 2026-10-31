import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { codeStyle } from '@web-app-demo/eslint-config'

export default defineConfig([
  globalIgnores(['src/generated']),
  {
    files: ['**/*.{ts,mjs,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, codeStyle],
    languageOptions: { globals: { ...globals.node, Bun: 'readonly' } },
  },
])
