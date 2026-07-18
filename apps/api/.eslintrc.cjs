/**
 * Lean, high-signal ESLint for the API. Non-type-checked (fast, low-noise): it
 * catches real mistakes — unused vars, unreachable code, bad regex, accidental
 * shadowing — without drowning the money code in stylistic churn. `any` and
 * non-null assertions are deliberately allowed; they are used judiciously here
 * (Prisma mocks, validated DTOs) and banning them would be noise, not safety.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { sourceType: 'module', ecmaVersion: 2022 },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { node: true, es2022: true, jest: true },
  ignorePatterns: ['dist', 'node_modules', 'prisma', '*.js', '*.cjs', '*.mjs'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/ban-ts-comment': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
    'no-empty': ['warn', { allowEmptyCatch: true }],
  },
  overrides: [
    {
      // Tests legitimately use dynamic require() (re-import after env changes,
      // isolate-module checks) and throwaway locals.
      files: ['*.spec.ts', 'test/**/*.ts'],
      rules: { '@typescript-eslint/no-unused-vars': 'off', '@typescript-eslint/no-var-requires': 'off' },
    },
  ],
};
