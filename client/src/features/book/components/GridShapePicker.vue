<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import { normalizeCoverAspectRatio, type CoverAspectRatio } from '@bookorbit/types'

defineProps<{
  /** The radio group name, unique on the page so two pickers never share a selection. */
  name: string
}>()

const model = defineModel<CoverAspectRatio>({ required: true })
const { t } = useI18n()

const options = computed<{ value: CoverAspectRatio; title: string; hint: string; tiles: string[] }[]>(() => [
  {
    value: '2/3',
    title: t('book.gridShape.tallTitle'),
    hint: t('book.gridShape.tallHint'),
    tiles: ['var(--format-ebook)', 'var(--format-document)', 'var(--format-audio)'],
  },
  {
    value: '1/1',
    title: t('book.gridShape.squareTitle'),
    hint: t('book.gridShape.squareHint'),
    tiles: ['var(--format-kindle)', 'var(--format-comic)', 'var(--format-audio)'],
  },
])

function handleChange(event: Event) {
  model.value = normalizeCoverAspectRatio((event.target as HTMLInputElement).value)
}
</script>

<template>
  <fieldset class="grid min-w-0 gap-2.5">
    <label
      v-for="option in options"
      :key="option.value"
      class="flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors focus-within:ring-2 focus-within:ring-ring"
      :class="model === option.value ? 'border-primary bg-primary/8 ring-1 ring-primary' : 'border-border bg-card hover:bg-muted'"
    >
      <input type="radio" :name="name" :value="option.value" :checked="model === option.value" class="sr-only" @change="handleChange" />
      <span class="flex h-8 shrink-0 items-end gap-1" aria-hidden="true">
        <span
          v-for="tile in option.tiles"
          :key="tile"
          class="rounded-[3px] shadow-xs"
          :class="option.value === '2/3' ? 'h-8 w-5' : 'size-7'"
          :style="{ backgroundColor: tile }"
        />
      </span>
      <span class="min-w-0">
        <span class="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          {{ option.title }}
          <Check v-if="model === option.value" :size="14" class="text-primary" aria-hidden="true" />
        </span>
        <span class="block text-xs text-muted-foreground">{{ option.hint }}</span>
      </span>
    </label>
  </fieldset>
</template>
