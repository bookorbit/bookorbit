<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { MissingBookEntry } from '@bookorbit/types'

import { formatList } from '@/i18n/formatters'

const props = defineProps<{ entry: MissingBookEntry; selected: boolean; disabled: boolean }>()
const emit = defineEmits<{ toggle: [id: number] }>()

const { t } = useI18n()

const title = computed(() => props.entry.title ?? t('tools.missingResources.untitled'))

function handleToggle(): void {
  emit('toggle', props.entry.id)
}
</script>

<template>
  <li class="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
    <input
      type="checkbox"
      class="mt-0.5 shrink-0 rounded accent-primary"
      :checked="selected"
      :disabled="disabled"
      :aria-label="title"
      @change="handleToggle"
    />
    <div class="min-w-0 flex-1">
      <p class="truncate text-sm font-medium text-foreground">{{ title }}</p>
      <p v-if="entry.authors.length > 0" class="truncate text-xs text-muted-foreground">{{ formatList(entry.authors) }}</p>
      <p class="truncate text-xs text-muted-foreground" :title="entry.folderPath">{{ entry.folderPath }}</p>
    </div>
    <div class="hidden shrink-0 items-center gap-2 sm:flex">
      <span v-for="format in entry.formats" :key="format" class="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground uppercase">
        {{ format }}
      </span>
      <span class="text-xs text-muted-foreground">{{ entry.libraryName }}</span>
    </div>
  </li>
</template>
