/**
 * Packages that must resolve to exactly one physical copy across the Metro
 * bundle graph, and why each one breaks if it doesn't:
 * - `expo`: owns the native module registry; a second copy double-registers native modules.
 * - `expo-constants`: caches `app.config` values in a module-level variable; a second copy reads stale/empty config.
 * - `expo-file-system`: tracks native file handles and download sessions in module state; a second copy can't see the first's handles.
 * - `expo-font`: caches loaded font handles at module scope; a second copy re-loads fonts and can flash unstyled text.
 * - `expo-glass-effect`: registers the native Liquid Glass view once; a second copy risks a duplicate-registration crash.
 * - `expo-linking`: holds the deep-link event emitter singleton; a listener added through one copy never fires from the other.
 * - `expo-symbols`: exports a view/context created at module scope; a second copy breaks `instanceof`/context identity.
 * - `@expo/dom-webview`: bridges DOM components to a single native webview host.
 * - `@expo/log-box`: shares in-app error/log state; entries logged through one copy are invisible to the other.
 * - `react`: hook and context identity require exactly one copy in the whole tree.
 * - `react-native`: the renderer and its native module registry must be a single instance.
 *
 * Bun's isolated linker (bunfig.toml: install.linker = "isolated") installs
 * one physical copy per unique peer-dependency context. `expo`, `expo-router`,
 * `expo-symbols` and `expo-glass-effect` all peer-depend on `expo` again (a
 * real cycle: expo -> @expo/cli -> expo-router -> expo), so some of these
 * packages get a second, separate install nested inside expo-router's own
 * node_modules. Metro's default resolver walks up node_modules from the
 * requesting file, so code reached through expo-router's own source picks up
 * that nested copy instead of the app's copy - see metro.config.js.
 */
const SINGLETON_PACKAGES = Object.freeze([
  'expo',
  'expo-constants',
  'expo-file-system',
  'expo-font',
  'expo-glass-effect',
  'expo-linking',
  'expo-symbols',
  '@expo/dom-webview',
  '@expo/log-box',
  'react',
  'react-native',
]);

const SINGLETON_PACKAGE_SET = new Set(SINGLETON_PACKAGES);

/**
 * Extracts the package name portion of a Metro module specifier: handles
 * scoped packages (`@scope/name`) and deep imports (`name/sub/path`).
 * Returns null for relative or absolute specifiers, which are never packages.
 */
function getPackageName(moduleName) {
  if (moduleName.startsWith('.') || moduleName.startsWith('/')) {
    return null;
  }

  const match = moduleName.match(/^((?:@[^/]+\/)?[^/]+)(?:\/.*)?$/);
  return match ? match[1] : null;
}

/** True when `moduleName` requests one of the singleton packages above. */
function isSingletonPackageRequest(moduleName) {
  const packageName = getPackageName(moduleName);
  return packageName !== null && SINGLETON_PACKAGE_SET.has(packageName);
}

module.exports = { SINGLETON_PACKAGES, getPackageName, isSingletonPackageRequest };
