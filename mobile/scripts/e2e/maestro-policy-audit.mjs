import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const scriptDir = fileURLToPath(new URL('.', import.meta.url))
const mobileRoot = resolve(scriptDir, '../..')
const flowPath = resolve(mobileRoot, '.maestro/flows/auth-smoke.yaml')
const envExamplePath = resolve(mobileRoot, '.maestro/.env.example')
const appPath = resolve(mobileRoot, 'src/features/auth/screens/AuthScreen.tsx')
const authComponentsPath = resolve(
  mobileRoot,
  'src/features/auth/components/auth-components.tsx',
)
const screenShellPath = resolve(mobileRoot, 'src/components/dashboard/ScreenShell.tsx')
// capability:billing:start
const paywallPath = resolve(mobileRoot, 'src/features/billing/screens/PaywallScreen.tsx')
const paywallComponentsPath = resolve(
  mobileRoot,
  'src/features/billing/components/paywall-components.tsx',
)
// capability:billing:end

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

function functionDeclaration(sourceFile, name) {
  return sourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  )
}

function jsxAttribute(sourceFile, node, name) {
  return node.attributes.properties
    .filter(ts.isJsxAttribute)
    .find((attribute) => attribute.name.getText(sourceFile) === name)
}

function jsxBooleanAttributeIsEnabled(attribute) {
  if (!attribute) return false
  if (!attribute.initializer) return true
  if (!ts.isJsxExpression(attribute.initializer)) return false

  return attribute.initializer.expression?.kind === ts.SyntaxKind.TrueKeyword
}

export function authScreenUsesKeyboardAwareShell(source) {
  const sourceFile = ts.createSourceFile(
    appPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const authScreen = functionDeclaration(sourceFile, 'AuthScreen')
  let usesKeyboardAwareShell = false

  function visit(node) {
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      (ts.isJsxElement(node)
        ? node.openingElement.tagName.getText(sourceFile)
        : node.tagName.getText(sourceFile)) === 'ScreenShell'
    ) {
      const openingElement = ts.isJsxElement(node) ? node.openingElement : node
      usesKeyboardAwareShell ||= jsxBooleanAttributeIsEnabled(
        jsxAttribute(sourceFile, openingElement, 'keyboardAware'),
      )
    }

    ts.forEachChild(node, visit)
  }

  if (authScreen?.body) visit(authScreen.body)
  return usesKeyboardAwareShell
}

// capability:billing:start
export function nativePaywallLogoutHasTestId(screenSource, componentsSource) {
  const screenFile = ts.createSourceFile(
    paywallPath,
    screenSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const componentsFile = ts.createSourceFile(
    paywallComponentsPath,
    componentsSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  )
  const paywallScreen = functionDeclaration(screenFile, 'PaywallScreen')
  const accountActions = functionDeclaration(componentsFile, 'PaywallAccountActions')
  const nativeReturn = paywallScreen?.body?.statements.find(ts.isReturnStatement)
  let screenWiresLogout = false
  let componentExposesTestId = false

  function visitScreen(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(screenFile) === 'PaywallAccountActions'
    ) {
      const onLogout = jsxAttribute(screenFile, node, 'onLogout')
      screenWiresLogout ||= Boolean(
        onLogout?.initializer?.getText(screenFile).includes('auth.logout'),
      )
    }

    ts.forEachChild(node, visitScreen)
  }

  function visitComponent(node) {
    if (
      ts.isJsxElement(node) &&
      node.openingElement.tagName.getText(componentsFile) === 'Button'
    ) {
      const onPress = jsxAttribute(componentsFile, node.openingElement, 'onPress')
      const testId = jsxAttribute(componentsFile, node.openingElement, 'testID')

      if (
        onPress?.initializer?.getText(componentsFile) === '{onLogout}' &&
        testId?.initializer?.getText(componentsFile) ===
          '{TEST_IDS.auth.logoutButton}'
      ) {
        componentExposesTestId = true
      }
    }

    ts.forEachChild(node, visitComponent)
  }

  if (nativeReturn?.expression) visitScreen(nativeReturn.expression)
  if (accountActions?.body) visitComponent(accountActions.body)

  return screenWiresLogout && componentExposesTestId
}
// capability:billing:end

export function runMaestroPolicyAudit() {
  const flow = readRequiredFile(flowPath)
  const app = readRequiredFile(appPath)
  const authComponents = readRequiredFile(authComponentsPath)
  const screenShell = readRequiredFile(screenShellPath)
  // capability:billing:start
  const paywall = readRequiredFile(paywallPath)
  const paywallComponents = readRequiredFile(paywallComponentsPath)
  // capability:billing:end
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
    flow.includes('id: ${DASHBOARD_ID}'),
    'auth-smoke.yaml must assert the signed-in dashboard after registration and restore',
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
    flow.includes('- assertVisible: Show password') &&
      flow.includes('id: ${PASSWORD_VISIBILITY_BUTTON_ID}') &&
      flow.includes('- assertVisible: Hide password'),
    'auth-smoke.yaml must reveal the password through the same visibility control users receive',
  )
  assert(
    app.includes('const [isPasswordVisible, setIsPasswordVisible] = useState(false)') &&
      app.includes('setIsPasswordVisible(false);') &&
      app.includes('isVisible={isPasswordVisible}') &&
      app.includes(
        'onToggleVisibility={() => setIsPasswordVisible((visible) => !visible)}',
      ) &&
      app.includes('visibilityButtonTestID={TEST_IDS.auth.passwordVisibilityButton}') &&
      authComponents.includes('secureTextEntry={!isVisible}') &&
      !app.includes('secureTextEntry={!isE2eMode}'),
    'password field must start secure and be controlled only by the user-facing visibility toggle',
  )
  assert(
    authScreenUsesKeyboardAwareShell(app) &&
      screenShell.includes("keyboardDismissMode: keyboardAware ? 'on-drag' : undefined") &&
      screenShell.includes('keyboardAvoiding={keyboardAware}'),
    'auth form must use the keyboard-aware ScreenShell with on-drag dismissal for iOS Maestro stability',
  )
  // capability:billing:start
  assert(
    nativePaywallLogoutHasTestId(paywall, paywallComponents),
    'native PaywallScreen logout action must expose TEST_IDS.auth.logoutButton through PaywallAccountActions',
  )
  // capability:billing:end
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMaestroPolicyAudit()
  process.stdout.write('[maestro-policy-audit] ok\n')
}
