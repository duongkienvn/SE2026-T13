module.exports = {
  preset: 'jest-expo',
  // The preset's broad RN subpath mapper bypasses this package export.
  moduleNameMapper: {
    '^react-native/unstable-internals-do-not-use$':
      require.resolve('react-native/unstable-internals-do-not-use'),
  },
  testMatch: ['<rootDir>/test/**/*.component.test.js'],
  modulePathIgnorePatterns: ['<rootDir>/apk/'],
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
  setupFilesAfterEnv: ['<rootDir>/test/component-setup.js'],
  testTimeout: 15000,
};
