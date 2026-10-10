// ESLint configuration: TypeScript rules everywhere, React hooks rules in the
// renderer, and import rules that keep each layer to what it may depend on
// (see CONTRIBUTING.md, "Code layout").
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** An import rule that forbids the given module patterns, with the reason shown in the error. */
const forbid = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: [{ group: patterns, message }] }],
})

export default defineConfig(
  { ignores: ['out/', 'release/', 'node_modules/', 'data/', 'media/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Types are imported as types, so a module's runtime imports are exactly its dependencies.
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
    },
  },
  {
    files: ['src/main/**', 'src/preload/**', 'src/core/**', 'scripts/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/renderer/**'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat.recommended],
    rules: {
      // Effects that load from the main process or follow a prop set state on purpose; each is
      // to become derived state or a keyed component as its file is next worked on, so they
      // stay visible as warnings rather than failing the build.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    files: ['src/shared/**'],
    rules: forbid(
      ['**/core/**', '**/main/**', '**/renderer/**', 'node:*', 'electron'],
      'src/shared is the bottom layer: types and pure helpers only.',
    ),
  },
  {
    files: ['src/core/**'],
    rules: forbid(['**/main/**', '**/renderer/**', 'electron'], 'src/core is plain libraries: no Electron, no UI.'),
  },
  {
    files: ['src/main/**'],
    rules: forbid(['**/renderer/**'], 'The main process never imports the UI.'),
  },
  {
    files: ['src/preload/**'],
    rules: forbid(
      ['**/core/**', '**/main/**', '**/renderer/**'],
      'The preload only passes calls on: no logic of its own.',
    ),
  },
  {
    files: ['src/renderer/**'],
    rules: forbid(
      ['**/core/**', '**/main/**', 'node:*', 'electron'],
      'The renderer reaches the main process only through src/shared/api.ts.',
    ),
  },
)
