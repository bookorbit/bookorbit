<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from '@lucide/vue'
import type { MetadataField } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { AUDIO_ONLY_FIELDS, EVERY_BOOK_FIELDS } from '../lib/auto-fetch-rules'

const props = defineProps<{
  selected: MetadataField[]
  /** Books in scope lacking each field; null until the first count arrives. */
  counts: Record<MetadataField, number> | null
  withAudio: number | null
  disabled?: boolean
}>()
const emit = defineEmits<{ toggle: [field: MetadataField] }>()

const { t } = useI18n()

const groups = computed(() => [
  { key: 'every', fields: EVERY_BOOK_FIELDS, heading: null as string | null, hint: null as string | null },
  {
    key: 'audio',
    fields: AUDIO_ONLY_FIELDS,
    heading: t('settings.metadata.autoFetch.columns.audioGroup'),
    hint: props.withAudio === null ? null : t('settings.metadata.autoFetch.columns.audioHint', { count: props.withAudio }),
  },
])

function isOn(field: MetadataField): boolean {
  return props.selected.includes(field)
}

function countOf(field: MetadataField): string {
  return props.counts ? formatNumber(props.counts[field] ?? 0) : '-'
}

function chipLabel(field: MetadataField): string {
  const name = t(`settings.metadata.fields.${field}`)
  return props.counts ? t('settings.metadata.autoFetch.columns.fieldCount', { field: name, count: props.counts[field] ?? 0 }) : name
}

function toggle(field: MetadataField) {
  emit('toggle', field)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="group in groups" :key="group.key">
      <p v-if="group.heading" class="mb-[7px] flex flex-wrap items-baseline gap-x-2 text-xs">
        <span class="font-semibold text-foreground">{{ group.heading }}</span>
        <span v-if="group.hint" class="text-muted-foreground">{{ group.hint }}</span>
      </p>
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="field in group.fields"
          :key="field"
          type="button"
          class="inline-flex h-[26px] items-center gap-1.5 rounded-full border text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            isOn(field)
              ? 'border-primary bg-primary ps-2 pe-[9px] text-primary-foreground'
              : 'border-border bg-transparent ps-2.5 pe-[9px] text-foreground hover:border-primary/50'
          "
          :aria-pressed="isOn(field)"
          :aria-label="chipLabel(field)"
          :disabled="disabled"
          :data-field="field"
          @click="toggle(field)"
        >
          <Check v-if="isOn(field)" :size="12" :stroke-width="2.5" class="-me-0.5" aria-hidden="true" />
          <span>{{ t(`settings.metadata.fields.${field}`) }}</span>
          <span
            class="border-s ps-[7px] leading-[14px] tabular-nums"
            :class="isOn(field) ? 'border-primary-foreground/35 font-semibold text-primary-foreground' : 'border-border text-muted-foreground'"
            aria-hidden="true"
          >
            {{ countOf(field) }}
          </span>
        </button>
      </div>
    </div>
  </div>
</template>
