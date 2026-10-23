<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { EyeOff, TriangleAlert } from '@lucide/vue'
import type { CustomMetadataFieldDefinition, Library } from '@bookorbit/types'
import AppIcon from '@/components/AppIcon.vue'
import { Button } from '@/components/ui/button'
import { formatList, formatNumber } from '@/i18n/formatters'
import { librariesHidingValues } from '../lib/custom-field-coverage'

const props = defineProps<{
  modelValue: number[]
  libraries: Library[]
  /** The saved field, for per-library counts. Absent while creating. */
  field?: CustomMetadataFieldDefinition | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number[]] }>()

const { t } = useI18n()
const labelId = useId()

const allSelected = computed(() => props.libraries.length > 0 && props.libraries.every((library) => props.modelValue.includes(library.id)))
const hiding = computed(() => (props.field ? librariesHidingValues(props.field, props.libraries, props.modelValue) : []))
const hidingCount = computed(() => hiding.value.reduce((total, entry) => total + entry.count, 0))
const hidingNames = computed(() => formatList(hiding.value.map((entry) => entry.library.name)))

function isOn(libraryId: number): boolean {
  return props.modelValue.includes(libraryId)
}

function toggle(libraryId: number) {
  emit('update:modelValue', isOn(libraryId) ? props.modelValue.filter((id) => id !== libraryId) : [...props.modelValue, libraryId])
}

function toggleAll() {
  emit('update:modelValue', allSelected.value ? [] : props.libraries.map((library) => library.id))
}

function valuesIn(libraryId: number): number {
  return props.field?.usageByLibrary?.[libraryId] ?? 0
}

function books(library: Library): string {
  return t('settings.metadata.customFields.sheet.books', { count: library.bookCount ?? 0 })
}

function filledOf(library: Library): string {
  return t('settings.metadata.customFields.sheet.filledOfBooks', { filled: formatNumber(valuesIn(library.id)), total: library.bookCount ?? 0 })
}
</script>

<template>
  <div class="space-y-2" role="group" :aria-labelledby="labelId">
    <div class="flex items-center justify-between gap-3">
      <span :id="labelId" class="settings-label">{{ t('settings.metadata.customFields.sheet.libraries') }}</span>
      <span v-if="libraries.length > 0" class="flex items-center gap-3 text-xs whitespace-nowrap">
        <span class="tabular-nums text-muted-foreground">{{
          t('settings.metadata.customFields.countOf', { selected: modelValue.length, total: libraries.length })
        }}</span>
        <Button variant="link" size="sm" type="button" class="h-auto p-0 text-xs" @click="toggleAll">
          {{ allSelected ? t('settings.metadata.customFields.clear') : t('settings.metadata.customFields.selectAll') }}
        </Button>
      </span>
    </div>

    <p v-if="libraries.length === 0" class="text-xs text-muted-foreground">{{ t('settings.metadata.customFields.noLibraries') }}</p>
    <div v-else class="divide-y divide-foreground/7 overflow-hidden rounded-lg border border-border bg-card">
      <label
        v-for="library in libraries"
        :key="library.id"
        class="grid min-h-[38px] cursor-pointer grid-cols-[16px_16px_minmax(0,1fr)_auto] items-center gap-2.5 px-3 transition-colors hover:bg-foreground/3"
      >
        <input type="checkbox" class="size-4 rounded-xs border-input accent-primary" :checked="isOn(library.id)" @change="toggle(library.id)" />
        <AppIcon :icon="library.icon" fallback="Library" :size="15" class="text-muted-foreground" aria-hidden="true" />
        <span class="truncate text-sm text-foreground">{{ library.name }}</span>
        <span v-if="field && !isOn(library.id) && valuesIn(library.id) > 0" class="inline-flex items-center gap-1 text-xs text-[var(--pill-warning)]">
          <EyeOff :size="12" aria-hidden="true" />
          {{ t('settings.metadata.customFields.sheet.hiddenCount', { count: formatNumber(valuesIn(library.id)) }) }}
        </span>
        <span v-else class="text-xs tabular-nums text-muted-foreground">
          {{ field && isOn(library.id) && valuesIn(library.id) > 0 ? filledOf(library) : books(library) }}
        </span>
      </label>
    </div>

    <p v-if="hiding.length > 0" class="flex items-start gap-2 text-xs text-muted-foreground" role="status">
      <EyeOff :size="13" class="mt-px shrink-0 text-[var(--pill-warning)]" aria-hidden="true" />
      <span>{{ t('settings.metadata.customFields.sheet.leavingNote', { count: hidingCount, libraries: hidingNames }) }}</span>
    </p>
    <p v-if="libraries.length > 0 && modelValue.length === 0" class="flex items-start gap-2 text-xs text-[var(--pill-warning)]" role="status">
      <TriangleAlert :size="13" class="mt-px shrink-0" aria-hidden="true" />
      <span>{{ t('settings.metadata.customFields.sheet.noLibraryWarning') }}</span>
    </p>
  </div>
</template>
