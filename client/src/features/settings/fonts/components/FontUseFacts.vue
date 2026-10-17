<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { BookMarked, BookOpen, EyeOff } from '@lucide/vue'
import type { FamilyUse } from '../composables/useFontLibrary'

/**
 * How a family is used, exceptions only: nothing is drawn for a family nobody has touched. `server`
 * counts every reader, for an administrator; `own` speaks for the signed-in reader alone.
 */
const props = defineProps<{ use: FamilyUse; perspective: 'server' | 'own' }>()

const { t } = useI18n()

const fact = 'inline-flex items-center gap-1.5 text-[12.5px]'

function booksTitle(): string | undefined {
  return props.perspective === 'server'
    ? t('settings.admin.serverFonts.facts.booksDetail', { books: props.use.books, readers: props.use.readers })
    : undefined
}
</script>

<template>
  <span v-if="use.books > 0" :class="fact" class="text-foreground" :title="booksTitle()">
    <BookOpen :size="14" class="text-muted-foreground" aria-hidden="true" />
    {{ t('settings.admin.serverFonts.facts.books', { count: use.books }) }}
  </span>
  <span v-if="use.defaults > 0" :class="fact" class="text-foreground">
    <BookMarked :size="14" class="text-muted-foreground" aria-hidden="true" />
    {{
      perspective === 'server'
        ? t('settings.admin.serverFonts.facts.defaults', { count: use.defaults })
        : t('settings.reader.fonts.library.yourDefault')
    }}
  </span>
  <span v-if="perspective === 'server' && use.hidden > 0" :class="fact" class="text-muted-foreground">
    <EyeOff :size="14" aria-hidden="true" />
    {{ t('settings.admin.serverFonts.facts.hidden', { count: use.hidden }) }}
  </span>
</template>
