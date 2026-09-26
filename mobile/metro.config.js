// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require('expo/metro-config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { isSingletonPackageRequest } = require('./scripts/metro-singleton-packages');

const config = getDefaultConfig(__dirname);

// Force every singleton package (see scripts/metro-singleton-packages.js for
// the full list and why each one must not be duplicated) to resolve from
// mobile's own node_modules, no matter which file requires it. Without this,
// a require reached through expo-router's own source resolves expo-router's
// nested copy of some of these packages instead of the app's copy, and two
// physical module instances end up in the same bundle.
const projectOriginModulePath = path.join(__dirname, 'package.json');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (isSingletonPackageRequest(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: projectOriginModulePath },
      moduleName,
      platform,
    );
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
