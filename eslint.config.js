import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

const CLASSNAME_COLOR_MESSAGE =
  'Hard-coded color in className (#hex / rgba()). Use a design token utility.'
const CLASSNAME_COLOR_RE = '/#[0-9a-fA-F]{3,8}(?![0-9a-zA-Z_-])|rgba?\\(/'
const CLASSNAME_COLOR_RULES = [
  {
    selector: `JSXAttribute[name.name='className'] Literal[value=${CLASSNAME_COLOR_RE}]`,
    message: CLASSNAME_COLOR_MESSAGE,
  },
  {
    selector: `JSXAttribute[name.name='className'] TemplateElement[value.raw=${CLASSNAME_COLOR_RE}]`,
    message: CLASSNAME_COLOR_MESSAGE,
  },
]

export default defineConfig([
  globalIgnores(['dist', 'dist-electron', 'release', 'node_modules', 'scratch_*']),
  // Renderer (React) code.
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['vite.config.ts', 'vitest.config.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // TEMPORARY: downgraded to 'warn' so `npm run lint` can gate on errors.
      // T-803 removes the remaining `any`s and turns this back into 'error'.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  // T-505 (UI-04): colors in `className` must come from design tokens
  // (bg-primary, bg-surface, text-fg-2, border-stroke, bg-[var(--kb-...)] ...),
  // never from hard-coded `#hex` / `rgb(a)(` values. Checks string and template
  // literals anywhere inside a JSX `className` attribute (incl. conditionals).
  {
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...CLASSNAME_COLOR_RULES],
    },
  },
  // Electron main process / preload / workers (CommonJS TypeScript, Node runtime).
  {
    files: ['electron/**/*.cts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      // `.cts` files compile to CommonJS; `require()` is the legitimate way to load
      // modules there (incl. optional/native deps loaded lazily), so allow it.
      '@typescript-eslint/no-require-imports': 'off',
      // TEMPORARY: see T-803 (same as the renderer block above).
      '@typescript-eslint/no-explicit-any': 'warn',
      // Positional params that must exist but are unused (e.g. IPC `_event`) are
      // prefixed with `_`, matching tsc's noUnusedParameters convention.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  // Node-run config / build scripts (all ESM).
  {
    files: ['*.config.js', 'kobar-build.js', 'vite.config.ts', 'vitest.config.ts'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  // T-217 packaging config / runner.
  {
    files: ['electron-builder.cjs', 'electron-builder.config.cjs', 'tools/builderConfig.cjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
  },
  {
    files: ['tools/dist.mjs', 'tools/build-electron.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node,
    },
  },
  // The TS config files need the TypeScript parser (plain espree chokes on annotations).
  {
    files: ['vite.config.ts', 'vitest.config.ts'],
    languageOptions: { parser: tseslint.parser },
  },
])
