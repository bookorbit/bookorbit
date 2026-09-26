import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', 'public/**', '**/dev-dist/**']),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    // Specs are colocated as `*.spec.ts`; `__tests__/` remains only in features not yet converted.
    files: ['src/**/__tests__/*', 'src/**/*.spec.ts', 'src/**/*.test.ts'],
  },

  // Named handlers only: an inline arrow in a template cannot be named, reused or tested, and the
  // podcast feature was swept clean of them. The rest of the app still carries several hundred, so
  // widening this is its own task rather than a side effect of one feature's refactor.
  {
    files: ['src/features/podcast/**/*.vue', 'src/components/FormSheet.vue', 'src/features/collection/components/CollectionMembershipList.vue'],
    rules: { 'vue/v-on-handler-style': ['error', ['method', 'inline']] },
  },

  {
    files: ['src/components/ui/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  {
    files: ['src/**/*.{vue,ts,mts,tsx}'],
    ignores: ['src/lib/clipboard.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "MemberExpression[property.name='clipboard'][object.name='navigator'], MemberExpression[property.value='clipboard'][object.name='navigator'], MemberExpression[property.name='clipboard'][object.property.name='navigator'], MemberExpression[property.value='clipboard'][object.property.name='navigator']",
          message: "Use copyToClipboard from '@/lib/clipboard' so copy actions work on HTTP/self-hosted origins.",
        },
        {
          selector:
            "CallExpression[callee.property.name='execCommand'][arguments.0.value='copy'], CallExpression[callee.property.value='execCommand'][arguments.0.value='copy']",
          message: "Use copyToClipboard from '@/lib/clipboard' instead of adding another copy fallback.",
        },
      ],
    },
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,
)
