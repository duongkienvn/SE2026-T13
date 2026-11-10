module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/test/**/*.component.test.js'],
  cacheDirectory: '<rootDir>/node_modules/.cache/jest',
  setupFilesAfterEnv: ['<rootDir>/test/component-setup.js'],
};
