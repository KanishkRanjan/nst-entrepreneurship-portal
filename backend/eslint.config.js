import js from '@eslint/js'
import globals from 'globals'
import json from '@eslint/json'
import markdown from '@eslint/markdown'
import css from '@eslint/css'
import prettierPlugin from 'eslint-plugin-prettier'

import { defineConfig } from 'eslint/config'

export default defineConfig([
  // GLOBAL IGNORES
  {
    ignores: ['node_modules/', 'dist/', 'build/'],
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    plugins: {
      js,
      prettier: prettierPlugin,
    },
    extends: ['js/recommended'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2024,
      },
    },
    rules: {
      'prettier/prettier': [
        'error',
        {
          printWidth: 80,
          tabWidth: 2,
          useTabs: false,
          semi: false,
          singleQuote: true,
          trailingComma: 'es5',
          bracketSpacing: true,
          arrowParens: 'avoid',
        },
      ],

      // ERROR PREVENTION
      'no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ], // No dead code/variables allowed unless prefixed with an underscore (_)
      'no-undef': 'error', // Catch typos: variables must be declared before use
      'no-unreachable': 'error', // Blocks useless code hidden after a 'return' statement
      'no-async-promise-executor': 'error', // Blocks syntax bugs inside asynchronous Promises
      'no-promise-executor-return': 'error', // Blocks invalid return attempts inside Promise objects
      'require-atomic-updates': 'error', // Prevents race conditions when reading/writing Mongoose model data

      // STANDARDS
      eqeqeq: ['error', 'always'], // Enforces strict typing (=== and !==). The loose == is completely banned.
      curly: ['error', 'all'], // All code blocks (if, else, loops) MUST use curly braces {}
      'no-var': 'error', // Banned: 'var'. You must use modern, block-scoped 'let' or 'const'.
      'prefer-const': 'error', // If a variable is never reassigned, the student MUST use 'const'.
      'consistent-return': 'error', // Express routes/functions must explicitly handle all returns to prevent API hangs

      // COMPLEXITY GUARDS
      complexity: ['error', { max: 10 }], // Rejects overly complicated logic / huge nested conditions
      'max-depth': ['error', { max: 4 }], // Blocks nested callback hell (max 4 layers of deep nesting)
    },
  },
  {
    files: ['**/*.json'],
    plugins: { json },
    language: 'json/json',
    extends: ['json/recommended'],
  },
  {
    files: ['**/*.md'],
    plugins: { markdown },
    language: 'markdown/gfm',
    extends: ['markdown/recommended'],
  },
  {
    files: ['**/*.css'],
    plugins: { css },
    language: 'css/css',
    extends: ['css/recommended'],
  },
])
