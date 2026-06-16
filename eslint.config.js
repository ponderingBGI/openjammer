import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
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
  // Console ratchet (L4 sweep governance, docs/plans/02-logging-and-observability.md).
  // The repo-wide `console.*` -> `src/utils/log.ts` facade sweep lands incrementally,
  // per-lane. Each fully-swept lane gets `no-console: error` here so it stays routed
  // through the structured DevLog sink and cannot regress. The native audio executor
  // lane (engine bridge: native + wasm + capability handles) is swept; its failure
  // logs now flow into the searchable on-device DevLog. `__tests__` are excluded (a
  // `*.ts` glob matches only the lane's direct children, not the test subdir), and
  // the facade itself (`src/utils/log.ts`) legitimately calls `console.*`.
  {
    files: ['src/audio/executor/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },
])
