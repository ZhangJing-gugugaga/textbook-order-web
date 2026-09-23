import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'logs/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      // 由 unplugin-auto-import / unplugin-vue-components 生成，不参与 lint
      'src/types/auto-imports.d.ts',
      'src/types/components.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: { parser: tseslint.parser, ecmaVersion: 'latest', sourceType: 'module' },
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['tests/**/*.ts', 'e2e/**/*.ts'],
    rules: {
      'vue/one-component-per-file': 'off',
    },
  },
  {
    files: ['e2e/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['*.config.ts', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
      'vue/attributes-order': 'off',
      'vue/require-default-prop': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // TS 已覆盖未定义标识符检查；且 Element Plus 程序式 API 由 unplugin-auto-import 注入
      'no-undef': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // 联调/契约/全链路脚本是 Node CLI：需要 node 全局与 stdout 输出。
    // **必须放在上面那条全局规则之后**——flat config 里后匹配的块覆盖先匹配的块，
    // 该块若放在前面，其 `no-console: off` 会被全局的 `['warn', …]` 静默覆盖
    // （表现为脚本里的 console.log 被报 warn，而 `--max-warnings 0` 直接判失败）。
    files: ['scripts/**/*.mjs', 'scripts/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
  prettier,
)
