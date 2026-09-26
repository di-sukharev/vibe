import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

/**
 * Product text styling goes through <Typography>. The rule reports only what it can see for
 * certain: raw semantic text elements, literal text inside DOM elements, and literal typography
 * utilities in `className`, `cn()`, and `cva()` strings. It does not guess whether an expression
 * such as `{icon}`, `{label}`, or `{renderValue()}` renders text; code review covers those.
 */
const lineHeightShorthandPattern =
  String.raw`(?:\/(?:none|tight|snug|normal|relaxed|loose|\d+|\[[^\]]+\]))?`
const typographyUtilityPatterns = [
  new RegExp(
    String.raw`^text-(xs|sm|base|lg|xl|[2-9]xl|[1-9]\d+xl)${lineHeightShorthandPattern}$`
  ),
  new RegExp(
    String.raw`^text-\[(?:length:)?(?:-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|ch|ex|vw|vh|vmin|vmax|svw|svh|lvw|lvh|dvw|dvh|cqw|cqh|cqi|cqb|cqmin|cqmax|%|pt|pc|in|cm|mm)|(?:calc|clamp|min|max)\(.+\))\]${lineHeightShorthandPattern}$`
  ),
  /^font-(heading|sans|mono|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[[^\]]+\])$/,
  /^leading-(none|tight|snug|normal|relaxed|loose|\d+|\[[^\]]+\])$/,
  /^tracking-(tighter|tight|normal|wide|wider|widest|\[[^\]]+\])$/,
]

const typographyElementNames = new Set([
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'small', 'strong', 'em', 'blockquote', 'figcaption', 'caption', 'code', 'kbd',
])
const technicalTextElementNames = new Set([
  'option', 'script', 'style', 'template', 'textarea', 'title',
])
const classStringCallNames = new Set(['cn', 'cva'])

function jsxNameToString(name) {
  if (!name) return ''
  if (name.type === 'JSXIdentifier') return name.name
  if (name.type === 'JSXMemberExpression') {
    return `${jsxNameToString(name.object)}.${jsxNameToString(name.property)}`
  }
  return ''
}

function calleeName(callee) {
  if (callee?.type === 'Identifier') return callee.name
  if (callee?.type === 'MemberExpression') return calleeName(callee.property)
  return ''
}

// `<Typography asChild><span>…</span></Typography>`: the child renders Typography's own styles.
function isTypographySlotElement(openingElement) {
  const parent = openingElement?.parent?.parent?.openingElement
  if (jsxNameToString(parent?.name) !== 'Typography') return false

  const asChild = parent.attributes.find(
    (attribute) =>
      attribute.type === 'JSXAttribute' && jsxNameToString(attribute.name) === 'asChild'
  )
  if (!asChild) return false
  if (!asChild.value) return true
  const expression = asChild.value.expression
  return expression?.type === 'Literal' && expression.value === true
}

// Text that is not product copy: form values, document metadata, and anything inside an <svg>.
function isTechnicalTextElement(openingElement) {
  if (technicalTextElementNames.has(jsxNameToString(openingElement?.name))) return true

  for (let current = openingElement?.parent; current; current = current.parent) {
    if (current.type === 'JSXElement' && jsxNameToString(current.openingElement.name) === 'svg') {
      return true
    }
  }
  return false
}

// `md:text-sm!` → `text-sm`: drops variant prefixes outside brackets and the important marker.
function utilityName(token) {
  let bracketDepth = 0
  let utilityStart = 0

  for (let index = 0; index < token.length; index += 1) {
    if (token[index] === '[') bracketDepth += 1
    else if (token[index] === ']') bracketDepth = Math.max(0, bracketDepth - 1)
    else if (token[index] === ':' && bracketDepth === 0) utilityStart = index + 1
  }

  return token.slice(utilityStart).replace(/^!/, '').replace(/!$/, '')
}

function typographyUtilities(value) {
  return value
    .split(/\s+/)
    .map(utilityName)
    .filter((token) => typographyUtilityPatterns.some((pattern) => pattern.test(token)))
}

function isClassStringContext(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (current.type === 'JSXAttribute') return jsxNameToString(current.name) === 'className'
    if (
      current.type === 'CallExpression' &&
      classStringCallNames.has(calleeName(current.callee))
    ) {
      return true
    }
  }
  return false
}

function staticText(expression) {
  if (expression?.type === 'Literal' && typeof expression.value === 'string') {
    return expression.value
  }
  if (expression?.type === 'TemplateLiteral' && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? ''
  }
  return ''
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
        if (filename.endsWith('/src/components/typography.tsx')) return {}

        function reportUtilities(node, value) {
          if (!isClassStringContext(node)) return
          for (const name of typographyUtilities(value)) {
            context.report({ node, messageId: 'rawUtility', data: { name } })
          }
        }

        // Literal text directly inside a DOM element. Components own their text styling.
        function reportLiteralText(node, text) {
          if (!text.trim()) return

          const parent = node.parent?.openingElement
          const name = jsxNameToString(parent?.name)
          if (!/^[a-z]/.test(name)) return
          if (isTechnicalTextElement(parent) || isTypographySlotElement(parent)) return

          context.report({ node, messageId: 'rawText', data: { name } })
        }

        return {
          Literal(node) {
            if (typeof node.value === 'string') reportUtilities(node, node.value)
          },
          TemplateElement(node) {
            reportUtilities(node, node.value.cooked ?? '')
          },
          JSXText(node) {
            reportLiteralText(node, node.value)
          },
          JSXExpressionContainer(node) {
            reportLiteralText(node, staticText(node.expression))
          },
          JSXOpeningElement(node) {
            const name = jsxNameToString(node.name)
            if (typographyElementNames.has(name) && !isTypographySlotElement(node)) {
              context.report({ node, messageId: 'rawElement', data: { name } })
            }
          },
        }
      },
    },
  },
}

export default defineConfig([
  globalIgnores(['dist', 'storybook-static', 'e2e/.artifacts']),
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
    // Official shadcn registry output is regenerated as a unit. Product-specific
    // composition and typography policy stay outside this directory.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'typographyPolicy/use-typography-component': 'off',
    },
  },
  {
    // Stories deliberately use plain elements to demonstrate the UI primitives
    // themselves instead of depending on product-level typography composition.
    files: ['src/stories/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'typographyPolicy/use-typography-component': 'off',
    },
  },
  {
    files: ['src/components/ui/carousel.tsx', 'src/hooks/use-mobile.ts'],
    rules: {
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
