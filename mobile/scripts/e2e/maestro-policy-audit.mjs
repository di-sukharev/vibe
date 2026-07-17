import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const mobileRoot = resolve(scriptDir, '../..')
const flowPath = resolve(mobileRoot, '.maestro/flows/auth-smoke.yaml')
const envExamplePath = resolve(mobileRoot, '.maestro/.env.example')
const appPath = resolve(mobileRoot, 'src/features/auth/screens/AuthScreen.tsx')
const paywallPath = resolve(mobileRoot, 'src/features/billing/screens/PaywallScreen.tsx')

const requiredEnvKeys = [
  'APP_ID',
  'MAESTRO_DEV_SERVER_URL',
  'MAESTRO_DEV_CLIENT_SCHEME',
  'MAESTRO_DEVICE',
  'MAESTRO_MIN_VERSION',
  'E2E_API_HEALTH_URL',
  'EXPO_PUBLIC_E2E',
  'E2E_DISPLAY_NAME',
  'E2E_EMAIL',
  'E2E_PASSWORD',
  'MAESTRO_SKIP_API_PREFLIGHT',
  'MAESTRO_SKIP_METRO_PREFLIGHT',
  'MAESTRO_SKIP_E2E_ENV_PREFLIGHT',
  'MAESTRO_DRY_RUN',
]

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function readRequiredFile(filePath) {
  assert(existsSync(filePath), `Missing required file: ${filePath}`)
  return readFileSync(filePath, 'utf8')
}

function declaredEnvKeys(fileContents) {
  return new Set(
    fileContents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.split('=')[0].trim()),
  )
}

function nativePaywallLogoutHasTestId(source) {
  const sourceFile = ts.createSourceFile(paywallPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const paywallScreen = sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'PaywallScreen',
  )
  const nativeReturn = paywallScreen?.body?.statements.find(ts.isReturnStatement)

  if (!nativeReturn?.expression) {
    return false
  }

  let nativeLogoutHasTestId = false

  function visit(node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sourceFile) === 'Button') {
      const attributes = node.openingElement.attributes.properties.filter(ts.isJsxAttribute)
      const onPress = attributes.find((attribute) => attribute.name.getText(sourceFile) === 'onPress')
      const testId = attributes.find((attribute) => attribute.name.getText(sourceFile) === 'testID')

      if (
        onPress?.initializer?.getText(sourceFile).includes('auth.logout') &&
        testId?.initializer?.getText(sourceFile) === '{TEST_IDS.auth.logoutButton}'
      ) {
        nativeLogoutHasTestId = true
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(nativeReturn.expression)
  return nativeLogoutHasTestId
}

export function runMaestroPolicyAudit() {
  const flow = readRequiredFile(flowPath)
  const app = readRequiredFile(appPath)
  const paywall = readRequiredFile(paywallPath)
  const envKeys = declaredEnvKeys(readRequiredFile(envExamplePath))
  const missingEnvKeys = requiredEnvKeys.filter((key) => !envKeys.has(key))

  assert(
    missingEnvKeys.length === 0,
    `.maestro/.env.example must document public Maestro runner inputs: missing ${missingEnvKeys.join(
      ', ',
    )}`,
  )
  assert(
    flow.includes('clearState: true') && flow.includes('clearKeychain: true'),
    'auth-smoke.yaml must clear app state and keychain at the start of the flow',
  )
  assert(
    flow.includes('link: ${DEV_CLIENT_URL}'),
    'auth-smoke.yaml must open the Expo dev-client bundle through DEV_CLIENT_URL',
  )
  assert(
    (flow.match(/link: \$\{DEV_CLIENT_URL\}/g) ?? []).length >= 2,
    'auth-smoke.yaml must reopen DEV_CLIENT_URL after stopApp to avoid landing on the simulator home screen',
  )
  assert(
    flow.includes('id: ${PAYWALL_SCREEN_ID}'),
    'auth-smoke.yaml must assert the inactive subscriber paywall after registration and restore',
  )
  assert(!flow.includes('hideKeyboard'), 'auth-smoke.yaml must not use flaky hideKeyboard')
  assert(
    flow.includes('centerElement: true') && flow.includes('visibilityPercentage: 100'),
    'auth-smoke.yaml must center important CTA targets before tapping',
  )
  assert(
    !/point:\s*\{/.test(flow) && !/point:\s*\n/.test(flow),
    'auth-smoke.yaml must not use coordinate taps',
  )
  assert(
    app.includes("process.env.EXPO_PUBLIC_E2E === '1'") &&
      app.includes('secureTextEntry={!isE2eMode}'),
    'password field must stay secure in production and become automatable only under EXPO_PUBLIC_E2E=1',
  )
  assert(
    app.includes('keyboardDismissMode="on-drag"') || app.includes("keyboardDismissMode: 'on-drag'"),
    'auth form ScrollView must use keyboardDismissMode="on-drag" for iOS Maestro stability',
  )
  assert(
    nativePaywallLogoutHasTestId(paywall),
    'native PaywallScreen logout button must expose TEST_IDS.auth.logoutButton for Maestro',
  )
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMaestroPolicyAudit()
  process.stdout.write('[maestro-policy-audit] ok\n')
}
