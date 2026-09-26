import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Turns the structured answer in `theme.json` into the shadcn theme tokens in
// `webapp/src/index.css` and `website/src/styles/global.css`, plus the font import lines. See
// "Visual style" in docs/UI.md. Brand colors are adjusted in OKLCH lightness only, enough to meet
// WCAG 2 AA contrast; hue and chroma come straight from the brand color. `brand: null` reproduces
// the template's neutral theme. `bun run theme` writes; `bun run theme -- --check` only verifies.

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const INDENT = '    '

const TOKENS_START = '/* THEME_TOKENS_START */'
const TOKENS_END = '/* THEME_TOKENS_END */'
const FONT_START = '/* THEME_FONT_START */'
const FONT_END = '/* THEME_FONT_END */'
const FONT_IMPORT_START_CSS = '/* THEME_FONT_IMPORT_START */'
const FONT_IMPORT_END_CSS = '/* THEME_FONT_IMPORT_END */'
const FONT_IMPORT_START_JS = '// THEME_FONT_IMPORT_START'
const FONT_IMPORT_END_JS = '// THEME_FONT_IMPORT_END'

/* -------------------------------------------------------------------------------------------- */
/* Color math: hex -> OKLCH, sRGB gamut clamp, WCAG 2 relative luminance and contrast.            */
/* -------------------------------------------------------------------------------------------- */

export function clamp01(value) {
  return Math.min(1, Math.max(0, value))
}

function srgbChannelToLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

export function hexToLinearSrgb(hex) {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex)
  if (!match) throw new Error(`Not a 6-digit hex color: ${JSON.stringify(hex)}`)
  const int = Number.parseInt(match[1], 16)
  const r = ((int >> 16) & 255) / 255
  const g = ((int >> 8) & 255) / 255
  const b = (int & 255) / 255
  return [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)]
}

// https://bottosson.github.io/posts/oklab/
export function linearSrgbToOklab([r, g, b]) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const l_ = Math.cbrt(l)
  const m_ = Math.cbrt(m)
  const s_ = Math.cbrt(s)
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ]
}

export function oklabToLinearSrgb([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b
  const s_ = L - 0.0894841775 * a - 1.291485548 * b
  const l = l_ ** 3
  const m = m_ ** 3
  const s = s_ ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

export function oklabToOklch([l, a, b]) {
  const c = Math.sqrt(a * a + b * b)
  if (c < 1e-6) return { l, c: 0, h: 0 }
  let h = (Math.atan2(b, a) * 180) / Math.PI
  if (h < 0) h += 360
  return { l, c, h }
}

export function oklchToOklab({ l, c, h }) {
  const radians = (h * Math.PI) / 180
  return [l, c * Math.cos(radians), c * Math.sin(radians)]
}

export function hexToOklch(hex) {
  return oklabToOklch(linearSrgbToOklab(hexToLinearSrgb(hex)))
}

const GAMUT_EPSILON = 1e-4

// Whether an OKLCH color converts to a linear sRGB triple inside [0, 1] (with a small tolerance
// for floating-point error at the boundary).
export function isInGamut(oklch) {
  const [r, g, b] = oklabToLinearSrgb(oklchToOklab(oklch))
  return (
    r >= -GAMUT_EPSILON &&
    r <= 1 + GAMUT_EPSILON &&
    g >= -GAMUT_EPSILON &&
    g <= 1 + GAMUT_EPSILON &&
    b >= -GAMUT_EPSILON &&
    b <= 1 + GAMUT_EPSILON
  )
}

// Reduces chroma at fixed lightness and hue until the color is representable in sRGB. Lightness
// and hue never change, so this only ever desaturates a color, never darkens or shifts it.
export function clampChromaToGamut({ l, c, h }) {
  if (c <= 0 || isInGamut({ l, c, h })) return { l, c, h }
  let lo = 0
  let hi = c
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2
    if (isInGamut({ l, c: mid, h })) lo = mid
    else hi = mid
  }
  return { l, c: lo, h }
}

export function oklchToLinearSrgb(oklch) {
  const [r, g, b] = oklabToLinearSrgb(oklchToOklab(clampChromaToGamut(oklch)))
  return [clamp01(r), clamp01(g), clamp01(b)]
}

// WCAG 2 relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance).
export function relativeLuminance(oklch) {
  const [r, g, b] = oklchToLinearSrgb(oklch)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// WCAG 2 contrast ratio (https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio). Symmetric: order does
// not matter.
export function contrastRatio(a, b) {
  const lighter = Math.max(relativeLuminance(a), relativeLuminance(b))
  const darker = Math.min(relativeLuminance(a), relativeLuminance(b))
  return (lighter + 0.05) / (darker + 0.05)
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return Object.is(rounded, -0) ? 0 : rounded
}

export function formatOklch(oklch) {
  // Round lightness and hue first, then clamp chroma at those *rounded* values, so the printed
  // triple is itself in gamut. Chroma is rounded down, not to the nearest value: rounding a
  // boundary chroma up, even by half a unit in the last decimal, can print a color that is
  // fractionally outside sRGB again.
  const l = round(oklch.l)
  const h = oklch.c < 1e-6 ? 0 : round(oklch.h)
  const clamped = clampChromaToGamut({ l, c: oklch.c, h })
  const c = clamped.c < 1e-6 ? 0 : Math.floor(clamped.c * 1000) / 1000
  return `oklch(${l} ${c} ${h})`
}

// Reads the first three numbers out of a literal `oklch(...)` string. Any alpha suffix
// (`/ 10%`) is ignored: it never carries brand color and contrast math does not need it here.
export function parseOklch(value) {
  const match = /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value)
  if (!match) throw new Error(`Not an oklch(...) color: ${JSON.stringify(value)}`)
  return { l: Number(match[1]), c: Number(match[2]), h: Number(match[3]) }
}

/* -------------------------------------------------------------------------------------------- */
/* Palette: which tokens follow the brand color, and the fixed neutral scale for each app/mode.   */
/* -------------------------------------------------------------------------------------------- */

// How far, in OKLCH lightness, one search step moves while looking for a brand shade that meets
// its contrast target. Small enough that the result stays close to the brand's own lightness
// whenever the brand color already reads fine; coarse enough that ~250 steps cover the [0, 1]
// range.
const LIGHTNESS_STEP = 0.004
// Required contrast ratios, plus a small safety margin so the value still clears the real
// threshold after rounding to 3 decimals for output.
const CONTRAST_MARGIN = 0.03
const TEXT_CONTRAST = 4.5 + CONTRAST_MARGIN
const UI_CONTRAST = 3.0 + CONTRAST_MARGIN

// Searches for the OKLCH lightness (same hue and chroma as the brand, gamut-clamped), moving from
// `fromL` toward `towardL` (0 or 1), closest to `fromL`, that meets every contrast constraint.
// `towardL` is always a hard 0 or 1, so the search always converges: at that extreme, gamut
// clamping forces chroma toward 0 and the color approaches black or white, which clears any
// realistic AA target against the other tokens in this file.
function solveLightness({ hue, chroma, fromL, towardL, constraints }) {
  const direction = Math.sign(towardL - fromL) || 1
  const steps = Math.ceil(Math.abs(towardL - fromL) / LIGHTNESS_STEP)
  for (let i = 0; i <= steps; i++) {
    const l = clamp01(fromL + direction * i * LIGHTNESS_STEP)
    const candidate = { l, c: chroma, h: hue }
    if (constraints.every((constraint) => contrastRatio(candidate, constraint.against) >= constraint.minContrast)) {
      return candidate
    }
  }
  return { l: towardL, c: chroma, h: hue }
}

// Webapp: classic shadcn light and dark themes. Website: a single dark theme, `:root` and `.dark`
// share one rule (docs/UI.md: "The site is dark only"), plus `--brand`/`--brand-foreground`.
const APP_CONFIGS = {
  webapp: {
    cssPath: 'webapp/src/index.css',
    packageJsonPath: 'webapp/package.json',
    hasBrandAlias: false,
    // Unchanged across brand colors: shadcn's default 5-step chart ramp.
    chartLightnessSteps: [0.87, 0.556, 0.439, 0.371, 0.269],
    modes: {
      light: {
        direction: 'darken',
        includesRadius: true,
        neutrals: {
          background: 'oklch(1 0 0)',
          foreground: 'oklch(0.145 0 0)',
          card: 'oklch(1 0 0)',
          'card-foreground': 'oklch(0.145 0 0)',
          popover: 'oklch(1 0 0)',
          'popover-foreground': 'oklch(0.145 0 0)',
          secondary: 'oklch(0.97 0 0)',
          'secondary-foreground': 'oklch(0.205 0 0)',
          muted: 'oklch(0.97 0 0)',
          'muted-foreground': 'oklch(0.556 0 0)',
          accent: 'oklch(0.97 0 0)',
          'accent-foreground': 'oklch(0.205 0 0)',
          destructive: 'oklch(0.505 0.213 27.518)',
          border: 'oklch(0.922 0 0)',
          input: 'oklch(0.922 0 0)',
          sidebar: 'oklch(0.985 0 0)',
          'sidebar-foreground': 'oklch(0.145 0 0)',
          'sidebar-accent': 'oklch(0.97 0 0)',
          'sidebar-accent-foreground': 'oklch(0.205 0 0)',
          'sidebar-border': 'oklch(0.922 0 0)',
        },
        neutralBrandDefaults: {
          primary: 'oklch(0.205 0 0)',
          'primary-foreground': 'oklch(0.985 0 0)',
          ring: 'oklch(0.708 0 0)',
          'sidebar-primary': 'oklch(0.205 0 0)',
          'sidebar-primary-foreground': 'oklch(0.985 0 0)',
          'sidebar-ring': 'oklch(0.708 0 0)',
          'chart-1': 'oklch(0.87 0 0)',
          'chart-2': 'oklch(0.556 0 0)',
          'chart-3': 'oklch(0.439 0 0)',
          'chart-4': 'oklch(0.371 0 0)',
          'chart-5': 'oklch(0.269 0 0)',
        },
        tokenOrder: [
          'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
          'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
          'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
          'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'radius',
          'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
          'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
        ],
      },
      dark: {
        direction: 'lighten',
        includesRadius: false,
        neutrals: {
          background: 'oklch(0.145 0 0)',
          foreground: 'oklch(0.985 0 0)',
          card: 'oklch(0.205 0 0)',
          'card-foreground': 'oklch(0.985 0 0)',
          popover: 'oklch(0.205 0 0)',
          'popover-foreground': 'oklch(0.985 0 0)',
          secondary: 'oklch(0.269 0 0)',
          'secondary-foreground': 'oklch(0.985 0 0)',
          muted: 'oklch(0.269 0 0)',
          'muted-foreground': 'oklch(0.708 0 0)',
          accent: 'oklch(0.269 0 0)',
          'accent-foreground': 'oklch(0.985 0 0)',
          destructive: 'oklch(0.704 0.191 22.216)',
          border: 'oklch(1 0 0 / 10%)',
          input: 'oklch(1 0 0 / 15%)',
          sidebar: 'oklch(0.205 0 0)',
          'sidebar-foreground': 'oklch(0.985 0 0)',
          'sidebar-accent': 'oklch(0.269 0 0)',
          'sidebar-accent-foreground': 'oklch(0.985 0 0)',
          'sidebar-border': 'oklch(1 0 0 / 10%)',
        },
        neutralBrandDefaults: {
          primary: 'oklch(0.922 0 0)',
          'primary-foreground': 'oklch(0.205 0 0)',
          ring: 'oklch(0.556 0 0)',
          // The template shipped a stray chromatic value here (oklch(0.488 0.243 264.376)) that
          // did not match `primary`, unlike every other neutral pair in this file. Brand null
          // means "neutral theme", so this now mirrors `primary`/`primary-foreground` like the
          // light block already does.
          'sidebar-primary': 'oklch(0.922 0 0)',
          'sidebar-primary-foreground': 'oklch(0.205 0 0)',
          'sidebar-ring': 'oklch(0.556 0 0)',
          'chart-1': 'oklch(0.87 0 0)',
          'chart-2': 'oklch(0.556 0 0)',
          'chart-3': 'oklch(0.439 0 0)',
          'chart-4': 'oklch(0.371 0 0)',
          'chart-5': 'oklch(0.269 0 0)',
        },
        tokenOrder: [
          'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
          'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
          'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
          'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5',
          'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
          'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
        ],
      },
    },
  },
  website: {
    cssPath: 'website/src/styles/global.css',
    packageJsonPath: 'website/package.json',
    fontImportPath: 'website/src/layouts/BaseLayout.astro',
    hasBrandAlias: true,
    chartLightnessSteps: [0.97, 0.8, 0.63, 0.46, 0.3],
    modes: {
      dark: {
        direction: 'lighten',
        includesRadius: true,
        // Preserved verbatim inside the generated block: it explains why `destructive` alone
        // keeps chroma in an otherwise achromatic theme.
        tokenComments: {
          destructive:
            `${INDENT}/* Error signalling stays chromatic on purpose: it must not read as ordinary\n` +
            `       text in a palette where every other token is neutral. */`,
        },
        neutrals: {
          background: 'oklch(0.06 0 0)',
          foreground: 'oklch(1 0 0)',
          card: 'oklch(0.11 0 0)',
          'card-foreground': 'oklch(1 0 0)',
          popover: 'oklch(0.11 0 0)',
          'popover-foreground': 'oklch(1 0 0)',
          secondary: 'oklch(0.18 0 0)',
          'secondary-foreground': 'oklch(1 0 0)',
          muted: 'oklch(0.16 0 0)',
          'muted-foreground': 'oklch(0.74 0 0)',
          accent: 'oklch(0.21 0 0)',
          'accent-foreground': 'oklch(1 0 0)',
          destructive: 'oklch(0.704 0.191 22.216)',
          border: 'oklch(1 0 0 / 12%)',
          input: 'oklch(1 0 0 / 16%)',
          sidebar: 'oklch(0.09 0 0)',
          'sidebar-foreground': 'oklch(1 0 0)',
          'sidebar-accent': 'oklch(0.18 0 0)',
          'sidebar-accent-foreground': 'oklch(1 0 0)',
          'sidebar-border': 'oklch(1 0 0 / 12%)',
        },
        neutralBrandDefaults: {
          primary: 'oklch(1 0 0)',
          'primary-foreground': 'oklch(0.06 0 0)',
          ring: 'oklch(0.85 0 0)',
          'sidebar-primary': 'oklch(1 0 0)',
          'sidebar-primary-foreground': 'oklch(0.06 0 0)',
          'sidebar-ring': 'oklch(0.85 0 0)',
          'chart-1': 'oklch(0.97 0 0)',
          'chart-2': 'oklch(0.8 0 0)',
          'chart-3': 'oklch(0.63 0 0)',
          'chart-4': 'oklch(0.46 0 0)',
          'chart-5': 'oklch(0.3 0 0)',
          brand: 'oklch(1 0 0)',
          'brand-foreground': 'oklch(0.06 0 0)',
        },
        tokenOrder: [
          'brand', 'brand-foreground',
          'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
          'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
          'accent', 'accent-foreground', 'destructive', 'border', 'input', 'ring',
          'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'radius',
          'sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
          'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring',
        ],
      },
    },
  },
}

// Brand-driven tokens for one app/mode: `primary` and `sidebar-primary` (with their foregrounds),
// `ring` and `sidebar-ring`, the chart ramp, and (website) `brand`. Everything else in the file
// comes from `neutrals`, untouched by the brand color.
export function computeBrandTokens(appKey, mode, brandHex) {
  const appConfig = APP_CONFIGS[appKey]
  const modeConfig = appConfig.modes[mode]
  if (brandHex === null) return { ...modeConfig.neutralBrandDefaults }

  const brand = hexToOklch(brandHex)
  const towardL = modeConfig.direction === 'darken' ? 0 : 1
  const textOnPrimary = parseOklch(modeConfig.neutralBrandDefaults['primary-foreground'])
  const background = parseOklch(modeConfig.neutrals.background)

  const primary = solveLightness({
    hue: brand.h,
    chroma: brand.c,
    fromL: brand.l,
    towardL,
    constraints: [
      { against: textOnPrimary, minContrast: TEXT_CONTRAST },
      { against: background, minContrast: UI_CONTRAST },
    ],
  })
  const ring = solveLightness({
    hue: brand.h,
    chroma: brand.c,
    fromL: brand.l,
    towardL,
    constraints: [{ against: background, minContrast: UI_CONTRAST }],
  })

  const tokens = {
    primary: formatOklch(primary),
    'primary-foreground': formatOklch(textOnPrimary),
    ring: formatOklch(ring),
    'sidebar-primary': formatOklch(primary),
    'sidebar-primary-foreground': formatOklch(textOnPrimary),
    'sidebar-ring': formatOklch(ring),
  }
  for (const [index, l] of appConfig.chartLightnessSteps.entries()) {
    tokens[`chart-${index + 1}`] = formatOklch({ l, c: brand.c, h: brand.h })
  }
  if (appConfig.hasBrandAlias) {
    tokens.brand = tokens.primary
    tokens['brand-foreground'] = tokens['primary-foreground']
  }
  return tokens
}

export function computeAppTokens(appKey, mode, brandHex) {
  const modeConfig = APP_CONFIGS[appKey].modes[mode]
  return { ...modeConfig.neutrals, ...computeBrandTokens(appKey, mode, brandHex) }
}

function renderTokensBlock(appKey, mode, themeConfig) {
  const modeConfig = APP_CONFIGS[appKey].modes[mode]
  const app = themeConfig[appKey]
  const tokens = computeAppTokens(appKey, mode, app.brand)
  if (modeConfig.includesRadius) tokens.radius = `${round(app.radius, 4)}rem`
  const lines = []
  for (const name of modeConfig.tokenOrder) {
    const comment = modeConfig.tokenComments?.[name]
    if (comment) lines.push(comment)
    lines.push(`${INDENT}--${name}: ${tokens[name]};`)
  }
  return lines.join('\n')
}

/* -------------------------------------------------------------------------------------------- */
/* Marker-delimited file rendering.                                                              */
/* -------------------------------------------------------------------------------------------- */

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Replaces the content between each occurrence of a start/end marker pair, in order. Leading
// same-line indentation before either marker is treated as part of the match and reproduced from
// `indent`, so both the markers and the generated lines stay uniformly indented.
function replaceMarkerBlock(source, startMarker, endMarker, contents, indent = INDENT) {
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(startMarker)}[\\s\\S]*?[ \\t]*${escapeRegExp(endMarker)}`,
    'g',
  )
  const matches = source.match(pattern) ?? []
  if (matches.length !== contents.length) {
    throw new Error(
      `Expected ${contents.length} "${startMarker}" marker block(s) in the file, found ${matches.length}.`,
    )
  }
  let i = 0
  return source.replace(pattern, () => {
    const body = contents[i]
    i += 1
    return `${indent}${startMarker}\n${body}\n${indent}${endMarker}`
  })
}

export function renderWebappCss(source, themeConfig) {
  let next = replaceMarkerBlock(source, TOKENS_START, TOKENS_END, [
    renderTokensBlock('webapp', 'light', themeConfig),
    renderTokensBlock('webapp', 'dark', themeConfig),
  ])
  next = replaceMarkerBlock(
    next,
    FONT_IMPORT_START_CSS,
    FONT_IMPORT_END_CSS,
    [`@import "${themeConfig.webapp.font.package}";`],
    '',
  )
  next = replaceMarkerBlock(next, FONT_START, FONT_END, [
    `${INDENT}--font-sans: ${themeConfig.webapp.font.family}, sans-serif;`,
  ])
  return next
}

export function renderWebsiteCss(source, themeConfig) {
  let next = replaceMarkerBlock(source, TOKENS_START, TOKENS_END, [
    renderTokensBlock('website', 'dark', themeConfig),
  ])
  next = replaceMarkerBlock(next, FONT_START, FONT_END, [
    `${INDENT}--font-sans: ${themeConfig.website.font.family}, sans-serif;`,
  ])
  return next
}

export function renderWebsiteFontImport(source, themeConfig) {
  return replaceMarkerBlock(
    source,
    FONT_IMPORT_START_JS,
    FONT_IMPORT_END_JS,
    [`import '${themeConfig.website.font.package}'`],
    '',
  )
}

const RENDER_TARGETS = [
  { path: 'webapp/src/index.css', render: renderWebappCss },
  { path: 'website/src/styles/global.css', render: renderWebsiteCss },
  { path: 'website/src/layouts/BaseLayout.astro', render: renderWebsiteFontImport },
]

/* -------------------------------------------------------------------------------------------- */
/* theme.json validation.                                                                        */
/* -------------------------------------------------------------------------------------------- */

const APP_KEYS = ['webapp', 'website']
const APP_SCHEMA_KEYS = ['brand', 'radius', 'font']
const FONT_SCHEMA_KEYS = ['family', 'package']
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
const FONTSOURCE_PACKAGE_PATTERN = /^@fontsource(-variable)?\/[a-z0-9][a-z0-9-]*$/

// Strict: every key must be recognized, and every value must have the right shape. Returns a list
// of human-readable errors; an empty list means the config is valid.
export function validateThemeConfig(config) {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return ['theme.json must be a JSON object with "webapp" and "website" keys.']
  }

  const errors = []
  for (const key of Object.keys(config)) {
    if (!APP_KEYS.includes(key)) {
      errors.push(`theme.json has an unexpected top-level key "${key}"; only ${APP_KEYS.join(', ')} are allowed.`)
    }
  }

  for (const appKey of APP_KEYS) {
    const app = config[appKey]
    if (app === undefined) {
      errors.push(`theme.json is missing "${appKey}".`)
      continue
    }
    if (typeof app !== 'object' || app === null || Array.isArray(app)) {
      errors.push(`theme.json "${appKey}" must be an object.`)
      continue
    }
    for (const key of Object.keys(app)) {
      if (!APP_SCHEMA_KEYS.includes(key)) {
        errors.push(
          `theme.json "${appKey}" has an unexpected key "${key}"; only ${APP_SCHEMA_KEYS.join(', ')} are allowed.`,
        )
      }
    }

    const { brand, radius, font } = app
    if (brand !== null && typeof brand !== 'string') {
      errors.push(`theme.json "${appKey}.brand" must be a hex color string like "#4f46e5", or null.`)
    } else if (typeof brand === 'string' && !HEX_COLOR_PATTERN.test(brand)) {
      errors.push(`theme.json "${appKey}.brand" must be a 6-digit hex color like "#4f46e5"; got ${JSON.stringify(brand)}.`)
    }

    if (typeof radius !== 'number' || !Number.isFinite(radius) || radius <= 0 || radius > 4) {
      errors.push(
        `theme.json "${appKey}.radius" must be a number of rem units greater than 0 and at most 4; got ${JSON.stringify(radius)}.`,
      )
    }

    if (typeof font !== 'object' || font === null || Array.isArray(font)) {
      errors.push(`theme.json "${appKey}.font" must be an object with "family" and "package".`)
      continue
    }
    for (const key of Object.keys(font)) {
      if (!FONT_SCHEMA_KEYS.includes(key)) {
        errors.push(
          `theme.json "${appKey}.font" has an unexpected key "${key}"; only ${FONT_SCHEMA_KEYS.join(', ')} are allowed.`,
        )
      }
    }
    if (typeof font.family !== 'string' || font.family.trim() === '') {
      errors.push(
        `theme.json "${appKey}.font.family" must be a non-empty CSS font-family value, for example "'Figtree Variable'".`,
      )
    }
    if (typeof font.package !== 'string' || !FONTSOURCE_PACKAGE_PATTERN.test(font.package)) {
      errors.push(
        `theme.json "${appKey}.font.package" must be a "@fontsource/<name>" or "@fontsource-variable/<name>" package; got ${JSON.stringify(font.package)}.`,
      )
    }
  }

  return errors
}

// Whether `fontPackage` is absent from a package.json's dependencies and devDependencies. The
// generator never installs anything (AGENTS.md: "A new dependency needs the user's approval");
// naming the package in theme.json is that approval, but it still has to actually be installed
// first.
export function missingFontDependency(packageJson, fontPackage) {
  const dependencies = { ...(packageJson.dependencies ?? {}), ...(packageJson.devDependencies ?? {}) }
  return !(fontPackage in dependencies)
}

/* -------------------------------------------------------------------------------------------- */
/* CLI.                                                                                          */
/* -------------------------------------------------------------------------------------------- */

function checkFontDependencies(root, config) {
  const errors = []
  for (const appKey of APP_KEYS) {
    const packageJsonPath = path.join(root, APP_CONFIGS[appKey].packageJsonPath)
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
    const fontPackage = config[appKey].font.package
    if (missingFontDependency(packageJson, fontPackage)) {
      errors.push(
        `${appKey}: package.json has no "${fontPackage}". Run "bun add ${fontPackage} --cwd ${appKey}", then re-run "bun run theme".`,
      )
    }
  }
  return errors
}

// Renders every target before it writes any, so a target that cannot be rendered (a lost marker)
// leaves all of them untouched. Returns the process exit code.
export function runTheme({
  root = repositoryRoot,
  check = false,
  log = (message) => console.log(message),
  error = (message) => console.error(`[theme] ${message}`),
} = {}) {
  let config
  try {
    config = JSON.parse(readFileSync(path.join(root, 'theme.json'), 'utf8'))
  } catch (parseError) {
    error(`theme.json is not valid JSON: ${parseError.message}`)
    return 1
  }

  const errors = validateThemeConfig(config)
  if (errors.length === 0) errors.push(...checkFontDependencies(root, config))
  if (errors.length > 0) {
    for (const message of errors) error(message)
    return 1
  }

  const drifted = []
  for (const target of RENDER_TARGETS) {
    const absolutePath = path.join(root, target.path)
    const current = readFileSync(absolutePath, 'utf8')
    let next
    try {
      next = target.render(current, config)
    } catch (renderError) {
      error(`${target.path}: ${renderError.message} Restore the marker comments (docs/UI.md), then re-run. Nothing was written.`)
      return 1
    }
    if (next !== current) drifted.push({ absolutePath, next, path: target.path })
  }

  const driftedPaths = drifted.map((target) => target.path).join(', ')
  if (check) {
    if (drifted.length > 0) {
      error(`Generated tokens are out of date in: ${driftedPaths}. Run "bun run theme".`)
      return 1
    }
    log('Theme tokens are up to date.')
    return 0
  }

  for (const target of drifted) writeFileSync(target.absolutePath, target.next)
  log(drifted.length > 0 ? `Theme tokens written to: ${driftedPaths}.` : 'Theme tokens already up to date; nothing written.')
  return 0
}

if (import.meta.main) process.exitCode = runTheme({ check: process.argv.includes('--check') })
