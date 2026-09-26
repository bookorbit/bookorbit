<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Headphones } from '@lucide/vue'
import { isReadAlongFormatKey } from '@bookorbit/types'

import { formatKeyCode, formatKeyName } from '../lib/book-formats'
import { formatChipStyle, type FormatChipVariant } from '../lib/format-colors'

const props = withDefaults(
  defineProps<{
    /** A format, or `epub:readalong`; see `bookFormatEntries`. */
    formatKey: string
    primary?: boolean
    variant?: FormatChipVariant
  }>(),
  { primary: false, variant: 'soft' },
)

const { t } = useI18n()

const readAlong = computed(() => isReadAlongFormatKey(props.formatKey))
const name = computed(() => formatKeyName(props.formatKey))
const style = computed(() => formatChipStyle(props.formatKey, props.variant))
</script>

<template>
  <span
    class="inline-flex items-center gap-1 border font-bold uppercase"
    :class="variant === 'solid' ? 'text-white' : undefined"
    :style="style"
    :title="name"
  >
    <span v-if="primary" class="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
    <span aria-hidden="true">{{ formatKeyCode(formatKey) }}</span>
    <Headphones v-if="readAlong" class="size-[1.1em] shrink-0" :stroke-width="2.5" aria-hidden="true" />
    <span class="sr-only">{{ name }}</span>
    <span v-if="primary" class="sr-only">{{ t('book.formats.primary') }}</span>
  </span>
</template>
