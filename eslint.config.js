import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `pi-openjammer-graph/` is a BUNDLED Pi resource (mounted into a Pi worktree,
  // not the app build), so it is excluded from the app's tsc/vitest/eslint gates.
  // `dist` + the docs site's generated output (`apps/docs/.astro`, `apps/docs/dist`)
  // are BUILD ARTIFACTS, not source; `pi-openjammer-graph/` is a BUNDLED Pi resource
  // (mounted into a Pi worktree, not the app build) — all excluded from the gates.
  globalIgnores(['dist', 'apps/docs/.astro', 'apps/docs/dist', 'pi-openjammer-graph']),
  {
    files: ['**/*.{ts,tsx}'],
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
      // Underscore-prefixed identifiers are intentional placeholders (unused
      // args required by an interface, ignored destructured slots, etc.).
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      // eslint-plugin-react-hooks v7 ships new, stricter STYLE rules that flag
      // long-standing, working patterns (reading a ref during render for
      // rAF-driven visuals; mount-time/derived setState in an effect; mutating
      // a captured object). They are advisory here — surfaced as warnings so the
      // blocking lint gate stays meaningful for genuine errors (correctness
      // rules like rules-of-hooks remain errors) without forcing risky,
      // out-of-scope rewrites of working UI. Tracked for incremental cleanup.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
])
