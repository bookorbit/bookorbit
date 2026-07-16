<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Library } from '@bookorbit/types'

const { t } = useI18n()

const props = defineProps<{ modelValue: number[]; libraries: Library[] }>()
const emit = defineEmits<{ 'update:modelValue': [number[]] }>()

const selectedCount = computed(() => props.modelValue.length)
const allSelected = computed(() => props.libraries.length > 0 && props.modelValue.length === props.libraries.length)

function isSelected(libraryId: number): boolean {
  return props.modelValue.includes(libraryId)
}

function toggleLibrary(libraryId: number) {
  const next = isSelected(libraryId) ? props.modelValue.filter((id) => id !== libraryId) : [...props.modelValue, libraryId]
  emit('update:modelValue', next)
}

function selectAll() {
  emit(
    'update:modelValue',
    props.libraries.map((library) => library.id),
  )
}

function clearAll() {
  emit('update:modelValue', [])
}

function toggleAll() {
  if (allSelected.value) clearAll()
  else selectAll()
}
</script>

<template>
  <div class="space-y-2">
    <div class="flex items-center justify-between gap-3">
      <p class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.metadata.customFields.enabledLibraries') }}</p>
      <div v-if="libraries.length > 0" class="flex items-center gap-2 text-xs">
        <span class="text-muted-foreground tabular-nums">{{
          t('settings.metadata.customFields.countOf', { selected: selectedCount, total: libraries.length })
        }}</span>
        <button type="button" class="text-primary hover:underline disabled:opacity-40" :disabled="allSelected" @click="selectAll">
          {{ t('settings.metadata.customFields.selectAll') }}
        </button>
        <span class="text-border">|</span>
        <button type="button" class="text-primary hover:underline disabled:opacity-40" :disabled="selectedCount === 0" @click="clearAll">
          {{ t('settings.metadata.customFields.clear') }}
        </button>
      </div>
    </div>
    <p v-if="libraries.length === 0" class="text-xs text-muted-foreground italic">{{ t('settings.metadata.customFields.noLibraries') }}</p>
    <div v-else class="flex flex-wrap gap-2">
      <button
        type="button"
        class="px-2.5 py-1 rounded-md text-xs font-semibold border transition-colors"
        :aria-pressed="allSelected"
        :class="
          allSelected
            ? 'bg-primary/15 text-primary border-primary/40'
            : 'bg-background text-muted-foreground border-dashed border-border hover:bg-muted hover:text-foreground'
        "
        @click="toggleAll"
      >
        {{ t('settings.metadata.customFields.allLibraries') }}
      </button>
      <button
        v-for="library in libraries"
        :key="library.id"
        type="button"
        class="px-2.5 py-1 rounded-md text-xs font-medium border transition-colors"
        :aria-pressed="isSelected(library.id)"
        :class="
          isSelected(library.id)
            ? 'bg-primary/10 text-primary border-primary/30'
            : 'bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground'
        "
        @click="toggleLibrary(library.id)"
      >
        {{ library.name }}
      </button>
    </div>
  </div>
</template>
