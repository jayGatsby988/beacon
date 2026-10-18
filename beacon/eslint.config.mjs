import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';

export default ts.config(
  { ignores: ['node_modules/**', 'tmp/**', 'dist/**', '.tooling/**', 'apps/mobile/ios/**', 'apps/mobile/android/**', 'apps/mobile/.expo/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.{js,cjs,mjs,ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
