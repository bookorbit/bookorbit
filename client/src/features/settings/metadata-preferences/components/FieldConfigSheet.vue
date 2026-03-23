<script setup lang="ts">
import { computed } from 'vue'
import { X, ChevronUp, ChevronDown } from 'lucide-vue-next'
import type { FieldPreference, MetadataField, MetadataProviderKey, ProviderStatus } from '@projectx/types'
import MergeStrategyPicker from './MergeStrategyPicker.vue'
import { providerChipStyle, PROVIDER_SHORT_LABELS } from '@/lib/provider-colors'

const FIELD_LABELS: Record<MetadataField, string> = {
  title: 'Title',
  subtitle: 'Subtitle',
  description: 'Description',
  cover: 'Cover',
  authors: 'Authors',
  publisher: 'Publisher',
  publishedYear: 'Published year',
  language: 'Language',
  pageCount: 'Page count',
  seriesName: 'Series name',
  seriesIndex: 'Series index',
  genres: 'Genres',
  narrators: 'Narrators',
  duration: 'Duration',
  abridged: 'Abridged',
}

const props = defineProps<{
  field: MetadataField
  preference: FieldPreference
  statuses: ProviderStatus[]
}>()

const emit = defineEmits<{
  change: [pref: FieldPreference]
  close: []
}>()

function isAssigned(key: MetadataProviderKey) {
  return props.preference.providers.includes(key)
}

function isUsable(status: ProviderStatus) {
  return status.enabled && status.configured
}

function toggleProvider(key: MetadataProviderKey) {
  const providers = [...props.preference.providers]
  const idx = providers.indexOf(key)
  if (idx >= 0) {
    providers.splice(idx, 1)
  } else {
    providers.push(key)
  }
  emit('change', { ...props.preference, providers })
}

function moveUp(key: MetadataProviderKey) {
  const providers = [...props.preference.providers]
  const idx = providers.indexOf(key)
  if (idx <= 0) return
  ;[providers[idx - 1], providers[idx]] = [providers[idx]!, providers[idx - 1]!]
  emit('change', { ...props.preference, providers })
}

function moveDown(key: MetadataProviderKey) {
  const providers = [...props.preference.providers]
  const idx = providers.indexOf(key)
  if (idx < 0 || idx >= providers.length - 1) return
  ;[providers[idx], providers[idx + 1]] = [providers[idx + 1]!, providers[idx]!]
  emit('change', { ...props.preference, providers })
}

// Assigned providers in order first, then unassigned
const sortedStatuses = computed(() => {
  const assigned = props.preference.providers.map((k) => props.statuses.find((s) => s.key === k)).filter(Boolean) as ProviderStatus[]
  const unassigned = props.statuses.filter((s) => !props.preference.providers.includes(s.key as MetadataProviderKey))
  return [...assigned, ...unassigned]
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex flex-col justify-end">
      <div class="absolute inset-0 bg-black/50" @click="$emit('close')" />
      <div class="relative bg-card border-t border-border rounded-t-2xl max-h-[85vh] flex flex-col z-10">
        <div class="flex items-center justify-between px-4 py-3.5 border-b border-border shrink-0">
          <div>
            <p class="text-sm font-semibold text-foreground">{{ FIELD_LABELS[field] }}</p>
            <p class="text-xs text-muted-foreground mt-0.5">Tap providers to assign, use arrows to reorder</p>
          </div>
          <button class="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted transition-colors" @click="$emit('close')">
            <X :size="16" />
          </button>
        </div>

        <div class="overflow-y-auto flex-1 px-4 py-4 space-y-5">
          <label class="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              :checked="preference.enabled"
              class="h-4 w-4 rounded border-input accent-primary"
              @change="$emit('change', { ...preference, enabled: ($event.target as HTMLInputElement).checked })"
            />
            <span class="text-sm text-foreground">Enable this field during refresh</span>
          </label>

          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Providers</p>
            <div class="space-y-1.5">
              <div
                v-for="status in sortedStatuses"
                :key="status.key"
                class="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors"
                :class="isAssigned(status.key as MetadataProviderKey) ? 'border-border bg-muted/40' : 'border-transparent'"
              >
                <input
                  type="checkbox"
                  :checked="isAssigned(status.key as MetadataProviderKey)"
                  :disabled="!isUsable(status) || !preference.enabled"
                  class="h-4 w-4 rounded border-input accent-primary shrink-0"
                  @change="toggleProvider(status.key as MetadataProviderKey)"
                />
                <div class="flex-1 flex items-center gap-2" :class="!isUsable(status) ? 'opacity-50' : ''">
                  <span class="text-xs font-medium px-2 py-0.5 rounded" :style="providerChipStyle(status.key, !isUsable(status))">
                    {{ PROVIDER_SHORT_LABELS[status.key] ?? status.key }}
                  </span>
                  <span v-if="!status.enabled" class="text-xs text-muted-foreground">disabled</span>
                  <span v-else-if="!status.configured" class="text-xs text-muted-foreground">not configured</span>
                </div>
                <div v-if="isAssigned(status.key as MetadataProviderKey)" class="flex items-center gap-1 shrink-0">
                  <span class="text-xs tabular-nums text-muted-foreground w-4 text-center">
                    {{ preference.providers.indexOf(status.key as MetadataProviderKey) + 1 }}
                  </span>
                  <button
                    :disabled="preference.providers.indexOf(status.key as MetadataProviderKey) === 0"
                    class="h-7 w-7 flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 transition-colors"
                    @click="moveUp(status.key as MetadataProviderKey)"
                  >
                    <ChevronUp :size="15" />
                  </button>
                  <button
                    :disabled="preference.providers.indexOf(status.key as MetadataProviderKey) === preference.providers.length - 1"
                    class="h-7 w-7 flex items-center justify-center rounded hover:bg-muted disabled:opacity-30 transition-colors"
                    @click="moveDown(status.key as MetadataProviderKey)"
                  >
                    <ChevronDown :size="15" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div>
            <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Merge Strategy</p>
            <MergeStrategyPicker
              :model-value="preference.mergeStrategy"
              :disabled="!preference.enabled"
              class="w-full"
              @update:model-value="$emit('change', { ...preference, mergeStrategy: $event })"
            />
          </div>
        </div>

        <div class="px-4 pb-6 pt-2 shrink-0">
          <button
            class="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
            @click="$emit('close')"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
