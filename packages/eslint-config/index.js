import { readFileSync } from 'node:fs'

// Workspace packages share one npm scope. Read it from this package so a project rename keeps
// the project module rule working.
const workspaceScope = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
).name.split('/')[0]

const projectModulePrefixes = ['.', '@/', `${workspaceScope}/`]

function importedName(specifier) {
  return specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value
}

const codeStylePlugin = {
  rules: {
    'no-renamed-import': {
      meta: {
        type: 'suggestion',
        messages: {
          renamed: 'Import "{{name}}" under its own name.',
        },
      },
      create(context) {
        return {
          ImportSpecifier(node) {
            const name = importedName(node)
            if (name !== node.local.name) context.report({ node, messageId: 'renamed', data: { name } })
          },
        }
      },
    },
    'no-project-namespace-import': {
      meta: {
        type: 'suggestion',
        messages: {
          namespace: 'Import named exports from "{{source}}" instead of a namespace.',
        },
      },
      create(context) {
        return {
          ImportNamespaceSpecifier(node) {
            const source = node.parent.source.value
            if (projectModulePrefixes.some((prefix) => source.startsWith(prefix))) {
              context.report({ node, messageId: 'namespace', data: { source } })
            }
          },
        }
      },
    },
  },
}

// `typescript-eslint` recommended already reports `let` without reassignment and `any`.
export const codeStyle = {
  plugins: {
    codeStyle: codeStylePlugin,
  },
  rules: {
    // `const { secret: _secret, ...rest } = value` omits a field from a copy.
    '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
    'no-else-return': ['error', { allowElseIf: false }],
    'codeStyle/no-renamed-import': 'error',
    'codeStyle/no-project-namespace-import': 'error',
  },
}

// Generated shadcn primitives keep the registry's import style.
export const generatedPrimitives = {
  rules: {
    'codeStyle/no-renamed-import': 'off',
  },
}
