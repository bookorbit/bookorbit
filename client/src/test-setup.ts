import { config } from '@vue/test-utils'
import { i18n } from '@/i18n'

// Install vue-i18n globally for all component tests so useI18n()/t() resolve real
// English messages (matching existing English text assertions) instead of throwing.
config.global.plugins = [...(config.global.plugins ?? []), i18n]
