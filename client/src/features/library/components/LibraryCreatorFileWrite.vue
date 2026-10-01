<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileCode, FilePenLine } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { formatNumber } from '@/i18n/formatters'

type FamilyKey = 'epub' | 'fb2' | 'pdf' | 'cbx' | 'kindle' | 'audio'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    fileRenameEnabled: boolean
    fileWriteEnabled: boolean
    fileWriteWriteCover: boolean
    fileWriteEpubEnabled: boolean
    fileWriteEpubMaxFileSizeMb: number
    fileWriteFb2Enabled: boolean
    fileWriteFb2MaxFileSizeMb: number
    fileWritePdfEnabled: boolean
    fileWritePdfMaxFileSizeMb: number
    fileWriteCbxEnabled: boolean
    fileWriteCbxMaxFileSizeMb: number
    fileWriteKindleEnabled: boolean
    fileWriteKindleMaxFileSizeMb: number
    fileWriteAudioEnabled: boolean
    fileWriteAudioMaxFileSizeMb: number
    formatCounts?: Record<string, number> | null
  }>(),
  { formatCounts: null },
)

const emit = defineEmits<{
  'update:fileRenameEnabled': [value: boolean]
  'update:fileWriteEnabled': [value: boolean]
  'update:fileWriteWriteCover': [value: boolean]
  'update:fileWriteEpubEnabled': [value: boolean]
  'update:fileWriteEpubMaxFileSizeMb': [value: number]
  'update:fileWriteFb2Enabled': [value: boolean]
  'update:fileWriteFb2MaxFileSizeMb': [value: number]
  'update:fileWritePdfEnabled': [value: boolean]
  'update:fileWritePdfMaxFileSizeMb': [value: number]
  'update:fileWriteCbxEnabled': [value: boolean]
  'update:fileWriteCbxMaxFileSizeMb': [value: number]
  'update:fileWriteKindleEnabled': [value: boolean]
  'update:fileWriteKindleMaxFileSizeMb': [value: number]
  'update:fileWriteAudioEnabled': [value: boolean]
  'update:fileWriteAudioMaxFileSizeMb': [value: number]
}>()

/** The formats each writer handles, as its hint describes them, so the count matches what gets written. */
const FAMILY_FORMATS: Record<FamilyKey, string[]> = {
  epub: ['epub'],
  fb2: ['fb2'],
  pdf: ['pdf'],
  cbx: ['cbz', 'cb7'],
  kindle: ['mobi', 'azw3', 'azw'],
  audio: ['m4b', 'm4a', 'mp3', 'flac'],
}

interface FamilyRow {
  key: FamilyKey
  enabled: boolean
  size: number
  blocked: boolean
  count: number | null
}

const rows = computed<FamilyRow[]>(() => {
  const state: Record<FamilyKey, [boolean, number]> = {
    epub: [props.fileWriteEpubEnabled, props.fileWriteEpubMaxFileSizeMb],
    fb2: [props.fileWriteFb2Enabled, props.fileWriteFb2MaxFileSizeMb],
    pdf: [props.fileWritePdfEnabled, props.fileWritePdfMaxFileSizeMb],
    cbx: [props.fileWriteCbxEnabled, props.fileWriteCbxMaxFileSizeMb],
    kindle: [props.fileWriteKindleEnabled, props.fileWriteKindleMaxFileSizeMb],
    audio: [props.fileWriteAudioEnabled, props.fileWriteAudioMaxFileSizeMb],
  }
  return (Object.keys(FAMILY_FORMATS) as FamilyKey[]).map((key) => {
    const blocked = key === 'audio' && !props.fileWriteWriteCover
    return {
      key,
      enabled: state[key][0] && !blocked,
      size: state[key][1],
      blocked,
      count: props.formatCounts ? FAMILY_FORMATS[key].reduce((sum, format) => sum + (props.formatCounts?.[format] ?? 0), 0) : null,
    }
  })
})

const writtenCount = computed(() => rows.value.filter((row) => row.enabled).length)

function emitEnabled(key: FamilyKey, value: boolean) {
  if (key === 'epub') emit('update:fileWriteEpubEnabled', value)
  else if (key === 'fb2') emit('update:fileWriteFb2Enabled', value)
  else if (key === 'pdf') emit('update:fileWritePdfEnabled', value)
  else if (key === 'cbx') emit('update:fileWriteCbxEnabled', value)
  else if (key === 'kindle') emit('update:fileWriteKindleEnabled', value)
  else emit('update:fileWriteAudioEnabled', value)
}

function emitSize(key: FamilyKey, value: number) {
  if (key === 'epub') emit('update:fileWriteEpubMaxFileSizeMb', value)
  else if (key === 'fb2') emit('update:fileWriteFb2MaxFileSizeMb', value)
  else if (key === 'pdf') emit('update:fileWritePdfMaxFileSizeMb', value)
  else if (key === 'cbx') emit('update:fileWriteCbxMaxFileSizeMb', value)
  else if (key === 'kindle') emit('update:fileWriteKindleMaxFileSizeMb', value)
  else emit('update:fileWriteAudioMaxFileSizeMb', value)
}

function handleRenameToggle(value: boolean) {
  emit('update:fileRenameEnabled', value)
}

function handleWriteToggle(value: boolean) {
  emit('update:fileWriteEnabled', value)
}

function handleCoverChange(event: Event) {
  const next = (event.target as HTMLInputElement).checked
  emit('update:fileWriteWriteCover', next)
  if (!next && props.fileWriteAudioEnabled) emit('update:fileWriteAudioEnabled', false)
}

function toggleFamily(row: FamilyRow, event: Event) {
  emitEnabled(row.key, (event.target as HTMLInputElement).checked)
}

function updateSize(row: FamilyRow, event: Event) {
  emitSize(row.key, Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <section class="divide-y divide-border rounded-xl border border-border bg-card">
    <div class="flex items-start gap-3.5 px-4 py-3.5">
      <FilePenLine :size="17" class="mt-0.5 shrink-0 text-foreground" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-foreground">{{ t('library.creator.fileWrite.rename.title') }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ t('library.creator.fileWrite.rename.hint') }}</p>
      </div>
      <ToggleSwitch
        :model-value="fileRenameEnabled"
        :aria-label="t('library.creator.fileWrite.rename.title')"
        @update:model-value="handleRenameToggle"
      />
    </div>

    <div class="flex items-start gap-3.5 px-4 py-3.5">
      <FileCode :size="17" class="mt-0.5 shrink-0 text-foreground" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-foreground">{{ t('library.creator.fileWrite.write.title') }}</p>
        <p class="mt-0.5 text-xs text-muted-foreground">{{ t('library.creator.fileWrite.write.hint') }}</p>
      </div>
      <ToggleSwitch
        :model-value="fileWriteEnabled"
        :aria-label="t('library.creator.fileWrite.write.title')"
        @update:model-value="handleWriteToggle"
      />
    </div>

    <div v-if="fileWriteEnabled" class="px-4 pb-4 pt-3.5">
      <label class="mb-3 flex cursor-pointer items-start gap-2.5">
        <input type="checkbox" class="mt-0.5 size-4 shrink-0 accent-primary" :checked="fileWriteWriteCover" @change="handleCoverChange" />
        <span class="min-w-0">
          <span class="block text-[13px] font-medium text-foreground">{{ t('library.creator.fileWrite.cover.title') }}</span>
          <span class="block text-xs text-muted-foreground">{{ t('library.creator.fileWrite.coverAudioHint') }}</span>
        </span>
      </label>

      <div class="overflow-hidden rounded-lg border border-border bg-background">
        <div
          class="flex items-center gap-3 border-b border-border px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground"
        >
          <span class="flex-1">{{ t('library.creator.fileWrite.table.format') }}</span>
          <span v-if="formatCounts" class="hidden w-16 text-end @lg:block">{{ t('library.creator.fileWrite.table.inLibrary') }}</span>
          <span class="w-28 text-end">{{ t('library.creator.fileWrite.table.sizeLimit') }}</span>
        </div>
        <ul class="divide-y divide-border">
          <li v-for="row in rows" :key="row.key" class="flex items-center gap-3 px-3 py-2.5" :class="row.blocked ? 'text-muted-foreground' : ''">
            <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5" :class="row.blocked ? 'cursor-not-allowed' : ''">
              <input
                type="checkbox"
                class="mt-0.5 size-4 shrink-0 accent-primary disabled:opacity-50"
                :checked="row.enabled"
                :disabled="row.blocked"
                :aria-label="t(`library.creator.fileWrite.${row.key}.toggleAria`)"
                @change="toggleFamily(row, $event)"
              />
              <span class="min-w-0">
                <span class="block text-[13px] font-medium" :class="row.blocked ? 'text-muted-foreground' : 'text-foreground'">
                  {{ t(`library.creator.fileWrite.${row.key}.title`) }}
                </span>
                <span class="block text-xs text-muted-foreground">
                  {{ row.blocked ? t('library.creator.fileWrite.audioNeedsCover') : t(`library.creator.fileWrite.${row.key}.hint`) }}
                </span>
              </span>
            </label>
            <span
              v-if="formatCounts"
              class="hidden w-16 text-end text-xs tabular-nums @lg:block"
              :class="row.count ? 'text-foreground' : 'text-muted-foreground'"
            >
              {{ row.count ? formatNumber(row.count) : '–' }}
            </span>
            <span class="relative w-28 shrink-0">
              <input
                :id="`${row.key}-max-size`"
                type="number"
                min="1"
                max="10000"
                step="1"
                :value="row.size"
                :disabled="!row.enabled"
                :aria-label="t('library.creator.fileWrite.sizeLimitAria', { format: t(`library.creator.fileWrite.${row.key}.title`) })"
                class="h-8 w-full rounded-md border border-input bg-background pe-10 ps-2.5 text-end text-[13px] tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                @input="updateSize(row, $event)"
              />
              <span class="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground" aria-hidden="true">
                {{ t('library.creator.fileWrite.mb') }}
              </span>
            </span>
          </li>
        </ul>
      </div>
      <p class="mt-2 text-xs text-muted-foreground">{{ t('library.creator.fileWrite.summary', { count: writtenCount }) }}</p>
    </div>
  </section>
</template>
