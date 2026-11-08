const { getDefaultConfig } = require('expo/metro-config');

// Expo detects pnpm workspaces and follows the shared package's existing exports.
// Keep package exports enabled; no source aliases, hoisting or resolver overrides.
module.exports = getDefaultConfig(__dirname);
