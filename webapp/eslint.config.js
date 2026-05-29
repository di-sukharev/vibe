import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const lineHeightShorthandPattern =
  String.raw`(?:\/(?:none|tight|snug|normal|relaxed|loose|\d+|\[[^\]]+\]))?`
const textSizePattern = new RegExp(
  String.raw`^text-(xs|sm|base|lg|xl|[2-9]xl|[1-9]\d+xl)${lineHeightShorthandPattern}$`
)
const fontPattern =
  /^font-(heading|sans|mono|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[[^\]]+\])$/
const leadingPattern =
  /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[[^\]]+\])$/
const trackingPattern =
  /^tracking-(tighter|tight|normal|wide|wider|widest|\[[^\]]+\])$/
const arbitraryTextSizePattern =
  new RegExp(
    String.raw`^text-\[(?:length:)?(?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ch|ex|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|%|pt|pc|in|cm|mm)|(?:calc|clamp|min|max)\(.+\))\]${lineHeightShorthandPattern}$`
  )

const typographyElementNames = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'small',
  'strong',
  'em',
  'blockquote',
  'figcaption',
  'caption',
  'code',
  'kbd',
])

const childrenPassthroughElementNames = new Set([
  'article',
  'aside',
  'div',
  'footer',
  'form',
  'header',
  'main',
  'nav',
  'section',
])

const nativeTextOnlyElementNames = new Set([
  'option',
])

function isDomElementName(name) {
  return /^[a-z]/.test(name)
}

function jsxNameToString(name) {
  if (!name) return ''
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') {
    return `${jsxNameToString(name.object)}.${jsxNameToString(name.property)}`
  }
  return ''
}

function isTypographySlotElement(openingElement) {
  const parentOpeningElement = openingElement?.parent?.parent?.openingElement
  const parentName = jsxNameToString(parentOpeningElement?.name)

  return (
    parentName === 'Typography' &&
    hasTruthyJsxAttribute(parentOpeningElement, 'asChild')
  )
}

function hasTruthyJsxAttribute(openingElement, attributeName) {
  const attribute = openingElement?.attributes.find(
    (candidate) =>
      candidate.type === 'JSXAttribute' &&
      jsxNameToString(candidate.name) === attributeName
  )

  if (!attribute) return false
  if (!attribute.value) return true
  if (attribute.value.type !== 'JSXExpressionContainer') return false

  const expression = attribute.value.expression
  return expression.type === 'Literal' && expression.value === true
}

function utilityName(token) {
  let bracketDepth = 0
  let utilityStart = 0

  for (let index = 0; index < token.length; index += 1) {
    const char = token[index]

    if (char === '[') {
      bracketDepth += 1
    } else if (char === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1)
    } else if (char === ':' && bracketDepth === 0) {
      utilityStart = index + 1
    }
  }

  return token.slice(utilityStart).replace(/^\!/, '').replace(/\!$/, '')
}

function typographyUtilities(value) {
  return value
    .split(/\s+/)
    .map(utilityName)
    .filter(
      (token) =>
        textSizePattern.test(token) ||
        arbitraryTextSizePattern.test(token) ||
        fontPattern.test(token) ||
        leadingPattern.test(token) ||
        trackingPattern.test(token)
    )
}

function staticStringValue(node) {
  if (!node) return undefined

  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }

  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? '').join('')
  }

  return undefined
}

function staticPropertyName(node) {
  if (!node) return undefined
  if (node.type === 'Identifier') return node.name
  if (
    node.type === 'Literal' &&
    (typeof node.value === 'string' || typeof node.value === 'number')
  ) {
    return String(node.value)
  }

  return undefined
}

function isChildrenIdentifier(expression) {
  return expression.type === 'Identifier' && expression.name === 'children'
}

function isLikelyTextExpression(expression, parentName) {
  if (!expression) return false
  if (staticStringValue(expression)?.trim()) return true

  if (expression.type === 'Identifier') {
    return (
      !isChildrenIdentifier(expression) ||
      !childrenPassthroughElementNames.has(parentName)
    )
  }

  if (expression.type === 'MemberExpression') return true
  if (expression.type === 'CallExpression') {
    return isLikelyTextCallExpression(expression)
  }
  if (expression.type === 'ChainExpression') {
    return isLikelyTextExpression(expression.expression, parentName)
  }
  if (
    expression.type === 'TSAsExpression' ||
    expression.type === 'TSSatisfiesExpression' ||
    expression.type === 'TSNonNullExpression' ||
    expression.type === 'TSTypeAssertion'
  ) {
    return isLikelyTextExpression(expression.expression, parentName)
  }
  if (expression.type === 'BinaryExpression') return true
  if (expression.type === 'ConditionalExpression') {
    return (
      isLikelyTextExpression(expression.consequent, parentName) ||
      isLikelyTextExpression(expression.alternate, parentName)
    )
  }
  if (expression.type === 'LogicalExpression') {
    return isLikelyTextExpression(expression.right, parentName)
  }

  return false
}

function isLikelyTextCallExpression(expression) {
  const name = calleeName(expression.callee)

  if (
    name === 'map' ||
    name === 'flatMap' ||
    name === 'filter' ||
    name === 'reduce'
  ) {
    return false
  }

  if (name === 'formatter' || name.startsWith('render')) {
    return false
  }

  return true
}

function calleeName(callee) {
  if (!callee) return ''
  if (callee.type === 'Identifier') return callee.name
  if (callee.type === 'MemberExpression') {
    return calleeName(callee.property)
  }
  return ''
}

function hasClassCallAncestor(node) {
  let current = node.parent

  while (current) {
    if (current.type === 'CallExpression') {
      const name = calleeName(current.callee)
      if (name === 'cn' || name === 'cva') return true
    }

    current = current.parent
  }

  return false
}

function hasClassNameAttributeAncestor(node) {
  let current = node.parent

  while (current) {
    if (current.type === 'JSXAttribute') {
      return jsxNameToString(current.name) === 'className'
    }

    if (current.type === 'JSXElement' || current.type === 'Program') {
      return false
    }

    current = current.parent
  }

  return false
}

function isClassNameOrClassCallContext(node) {
  return hasClassNameAttributeAncestor(node) || hasClassCallAncestor(node)
}

const typographyPolicyPlugin = {
  rules: {
    'use-typography-component': {
      meta: {
        type: 'problem',
        messages: {
          rawElement:
            'Use <Typography> for semantic text elements instead of raw <{{name}}>.',
          rawText:
            'Wrap text content in <{{name}}> with <Typography> instead of raw JSX text.',
          rawUtility:
            'Move typography utility "{{name}}" into the Typography component variants.',
        },
      },
      create(context) {
        const filename = context.filename.replaceAll('\\', '/')
        const isTypographyFile = filename.endsWith(
          '/src/components/ui/typography.tsx'
        )
        const classMemberVariableUtilities = new WeakMap()
        const classVariableUtilities = new WeakMap()

        function reportUtilities(node, utilities) {
          for (const name of utilities) {
            context.report({
              node,
              messageId: 'rawUtility',
              data: { name },
            })
          }
        }

        function reportTypographyUtilities(node, value) {
          if (isTypographyFile) return
          if (!isClassNameOrClassCallContext(node)) return

          reportUtilities(node, typographyUtilities(value))
        }

        function reportClassVariableReferenceUtilities(node) {
          if (isTypographyFile) return
          if (!isClassNameOrClassCallContext(node)) return

          const variable = resolveIdentifierVariable(node)
          const utilities = variable
            ? classVariableUtilities.get(variable)
            : undefined
          if (utilities) {
            reportUtilities(node, utilities)
          }
        }

        function reportClassMemberVariableReferenceUtilities(node) {
          if (isTypographyFile) return
          if (!isClassNameOrClassCallContext(node)) return

          const object = node.object
          if (object.type !== 'Identifier') return

          const propertyName = node.computed
            ? staticStringValue(node.property)
            : staticPropertyName(node.property)
          if (!propertyName) return

          const variable = resolveIdentifierVariable(object)
          const utilities = variable
            ? classMemberVariableUtilities.get(variable)?.get(propertyName)
            : undefined

          if (utilities) {
            reportUtilities(node, utilities)
          }
        }

        function reportRawJsxText(node) {
          if (isTypographyFile) return
          if (!node.value.trim()) return

          const parentOpeningElement = node.parent?.openingElement
          const parentName = jsxNameToString(parentOpeningElement?.name)

          if (parentName === 'Typography') return
          if (!isDomElementName(parentName)) return
          if (nativeTextOnlyElementNames.has(parentName)) return
          if (isTypographySlotElement(parentOpeningElement)) return

          context.report({
            node,
            messageId: 'rawText',
            data: { name: parentName },
          })
        }

        function rememberClassVariableUtilities(node) {
          if (isTypographyFile) return
          if (node.id.type !== 'Identifier') return

          const value = staticStringValue(node.init)

          if (value) {
            const utilities = typographyUtilities(value)
            if (utilities.length > 0) {
              const variable = context.sourceCode
                .getDeclaredVariables(node)
                .find((candidate) => candidate.name === node.id.name)

              if (variable) {
                classVariableUtilities.set(variable, utilities)
              }
            }
          }

          rememberClassObjectVariableUtilities(node)
        }

        function rememberClassObjectVariableUtilities(node) {
          if (isTypographyFile) return
          if (node.id.type !== 'Identifier') return
          if (node.init?.type !== 'ObjectExpression') return

          const propertyUtilities = new Map()

          for (const property of node.init.properties) {
            if (property.type !== 'Property') continue

            const name = property.computed
              ? staticStringValue(property.key)
              : staticPropertyName(property.key)
            const value = staticStringValue(property.value)
            if (!name || !value) continue

            const utilities = typographyUtilities(value)
            if (utilities.length > 0) {
              propertyUtilities.set(name, utilities)
            }
          }

          if (propertyUtilities.size === 0) return

          const variable = context.sourceCode
            .getDeclaredVariables(node)
            .find((candidate) => candidate.name === node.id.name)

          if (variable) {
            classMemberVariableUtilities.set(variable, propertyUtilities)
          }
        }

        function resolveIdentifierVariable(node) {
          let scope = context.sourceCode.getScope(node)

          while (scope) {
            const variable = scope.set.get(node.name)
            if (variable) return variable

            scope = scope.upper
          }

          return undefined
        }

        function reportRawExpressionText(node) {
          if (isTypographyFile) return

          const parentOpeningElement = node.parent?.openingElement
          const parentName = jsxNameToString(parentOpeningElement?.name)

          if (parentName === 'Typography') return
          if (!isDomElementName(parentName)) return
          if (nativeTextOnlyElementNames.has(parentName)) return
          if (isTypographySlotElement(parentOpeningElement)) return
          if (!isLikelyTextExpression(node.expression, parentName)) return

          context.report({
            node,
            messageId: 'rawText',
            data: { name: parentName },
          })
        }

        function reportRawSemanticElement(node) {
          if (isTypographyFile) return

          const name = jsxNameToString(node.name)
          const isTypographySlot = isTypographySlotElement(node)

          if (typographyElementNames.has(name) && !isTypographySlot) {
            context.report({
              node,
              messageId: 'rawElement',
              data: { name },
            })
          }
        }

        return {
          VariableDeclarator(node) {
            rememberClassVariableUtilities(node)
          },
          Identifier(node) {
            reportClassVariableReferenceUtilities(node)
          },
          MemberExpression(node) {
            reportClassMemberVariableReferenceUtilities(node)
          },
          Literal(node) {
            if (typeof node.value === 'string') {
              reportTypographyUtilities(node, node.value)
            }
          },
          TemplateElement(node) {
            reportTypographyUtilities(node, node.value.cooked ?? '')
          },
          JSXOpeningElement(node) {
            reportRawSemanticElement(node)
          },
          JSXText(node) {
            reportRawJsxText(node)
          },
          JSXExpressionContainer(node) {
            reportRawExpressionText(node)
          },
        }
      },
    },
  },
}

export default defineConfig([
  globalIgnores(['dist', 'e2e/.artifacts']),
  {
    files: ['**/*.{ts,tsx}'],
    plugins: {
      typographyPolicy: typographyPolicyPlugin,
    },
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'typographyPolicy/use-typography-component': 'error',
    },
  },
  {
    files: ['playwright.config.ts', 'e2e/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    // shadcn registry output intentionally exports variants/helpers next to components.
    // Keep app-specific wrappers outside src/components/ui so regular lint rules still apply.
    files: [
      'src/components/ui/badge.tsx',
      'src/components/ui/button-group.tsx',
      'src/components/ui/button.tsx',
      'src/components/ui/carousel.tsx',
      'src/components/ui/combobox.tsx',
      'src/components/ui/direction.tsx',
      'src/components/ui/navigation-menu.tsx',
      'src/components/ui/sidebar.tsx',
      'src/components/ui/tabs.tsx',
      'src/components/ui/toggle.tsx',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/components/ui/carousel.tsx', 'src/hooks/use-mobile.ts'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
