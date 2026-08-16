import { config } from '@vue/test-utils'
import { i18n } from '@/i18n'

// Fails loudly if `--no-experimental-webstorage` ever stops reaching the workers (see the execArgv
// note in vitest.config.ts). Node's own Web Storage globals shadow jsdom's, and the resulting
// `localStorage` reads as undefined, which otherwise surfaces as hundreds of unrelated "Cannot read
// properties of undefined" failures rather than as the configuration problem it is.
if (typeof window !== 'undefined' && !globalThis.localStorage) {
  throw new Error('jsdom localStorage is missing: Node built-in web storage is shadowing it. Check test.execArgv in vitest.config.ts.')
}

// Install vue-i18n globally for all component tests so useI18n()/t() resolve real
// English messages (matching existing English text assertions) instead of throwing.
config.global.plugins = [...(config.global.plugins ?? []), i18n]
