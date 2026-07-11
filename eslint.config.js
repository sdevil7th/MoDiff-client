import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'artifacts', 'playwright-report', 'test-results'] },
  {
    files: ['playwright.config.ts', 'tests/e2e/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/theme/**/*', 'src/ui/**/*'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'JSXOpeningElement[name.name=/^[a-z]/] > JSXAttribute[name.name="style"]',
          message: 'Avoid DOM inline styles in feature code. Use theme tokens, MUI sx, or src/ui primitives.',
        },
      ],
    },
  },
  {
    files: [
      'src/components/NodeContent.tsx',
      'src/fields/AutocompleteField.tsx',
      'src/stores/useFlowStore.ts',
      'src/stores/useNodeStore.ts',
      'src/stores/useWebsocketStore.ts',
      'src/utils/fieldAction.ts',
    ],
    rules: {
      // These files sit on the backend-defined graph schema boundary. MoDiff
      // nodes, params, websocket payloads, and custom fields are intentionally
      // dynamic until the backend exposes a generated TypeScript schema.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
