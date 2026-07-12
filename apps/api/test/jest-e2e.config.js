// E2E/integration config — boots the real app against Postgres + Redis.
// Separate from the unit `jest.config.js` (which stays hermetic).
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '..',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.e2e-spec.ts'],
  testTimeout: 60000,
  moduleNameMapper: {
    '^@paykh/security$': '<rootDir>/../../packages/security/src/index.ts',
    '^@paykh/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
