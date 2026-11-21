import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import vue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/*.tsbuildinfo'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...vue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // NFR-MAINT-01: no `any` in the domain package.
    files: ['packages/domain/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
  {
    // TR-05: no hard-coded UI strings in templates – everything goes through i18n.
    files: ['apps/frontend/src/**/*.vue'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'vue/no-bare-strings-in-template': 'error',
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    // Edit reactive state objects owned by a composable (useCustomerForm, useInvoiceEditor) on purpose.
    files: [
      'apps/frontend/src/components/CustomerFields.vue',
      'apps/frontend/src/components/PositionCard.vue',
    ],
    rules: { 'vue/no-mutating-props': 'off' },
  },
  prettier,
);
