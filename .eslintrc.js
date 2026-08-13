module.exports = {
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  parserOptions: {
    ecmaVersion: 2018,
    sourceType: 'module',
    project: ['./tsconfig.json', './homebridge-ui/tsconfig.json'],
  },
  plugins: [
    '@typescript-eslint',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': 'off',
    'semi': ['error', 'always'],
    'quotes': ['error', 'single', { avoidEscape: true }],
  },
  ignorePatterns: [
    'dist',
    'node_modules',
    'coverage',
    'homebridge-ui/public/**',
    'scripts/**',
    '**/*.js',
    '**/*.d.ts',
  ],
  overrides: [
    {
      files: ['homebridge-ui/server.ts'],
      rules: {
        // Loads sibling dist modules at runtime (compiled plugin output).
        '@typescript-eslint/no-var-requires': 'off',
      },
    },
  ],
  env: {
    node: true,
    es6: true,
  },
};
