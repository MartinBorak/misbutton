// @ts-check
import eslintConfigPrettier from 'eslint-config-prettier'
import perfectionist from 'eslint-plugin-perfectionist'

import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // Your custom configs here
  eslintConfigPrettier,
  {
    plugins: { perfectionist },
    rules: {
      // <script setup> before <template>, then <style>.
      'vue/block-order': ['error', { order: ['script', 'template', 'style'] }],
      /**
       * Named functions read as `function foo() {}`, not `const foo = () => {}`.
       * Arrow functions stay for actual inline callbacks (.map(), computed(), etc.)
       * since those aren't bound to a name via a variable declarator.
       */
      'func-style': ['error', 'declaration'],
      // Always require { } around if/else/for/while bodies, even single-statement ones.
      curly: ['error', 'all'],
      // Blank line between every pair of sibling tags in a template, for visual separation.
      'vue/padding-line-between-tags': ['error', [{ blankLine: 'always', prev: '*', next: '*' }]],
      // A comment spanning multiple lines must be a /** */ block, not stacked // lines.
      'multiline-comment-style': ['error', 'starred-block'],
      /**
       * Group imports (packages, then ~/~~ aliases, then relative), alphabetical
       * within each group, blank line between groups. `type` imports sort
       * alongside their value counterparts rather than in a separate block.
       */
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [['builtin', 'external'], 'internal', ['parent', 'sibling', 'index'], 'unknown'],
          internalPattern: ['^~~?/.+'],
          newlinesBetween: 1,
        },
      ],
    },
  },
)
