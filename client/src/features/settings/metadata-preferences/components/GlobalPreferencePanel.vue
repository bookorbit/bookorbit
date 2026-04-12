<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, RotateCcw, Save, Settings, Trash2 } from 'lucide-vue-next'
import type { FieldPreference, MetadataFetchPreferences, MetadataField, ProviderStatus } from '@projectx/types'
import FieldPreferenceTable from './FieldPreferenceTable.vue'

const props = defineProps<{
  preferences: MetadataFetchPreferences | null
  statuses: ProviderStatus[]
  saving: boolean
}>()

const emit = defineEmits<{
  save: [prefs: MetadataFetchPreferences]
  clearAll: [prefs: MetadataFetchPreferences]
  resetToDefault: []
}>()

const draft = ref<MetadataFetchPreferences | null>(null)

function withDefaultOptions(prefs: MetadataFetchPreferences): MetadataFetchPreferences {
  return {
    ...prefs,
    options: {
      genres: {
        mode: prefs.options?.genres.mode ?? 'merge',
      },
      saveProviderIds: prefs.options?.saveProviderIds ?? true,
    },
  }
}

watch(
  () => props.preferences,
  (p) => {
    if (p) draft.value = JSON.parse(JSON.stringify(withDefaultOptions(p)))
  },
  { immediate: true },
)

function onFieldChange(field: MetadataField, pref: FieldPreference) {
  if (!draft.value) return
  draft.value = { ...draft.value, fields: { ...draft.value.fields, [field]: pref } }
}

function save() {
  if (!draft.value) return
  emit('save', draft.value)
}

function setGenreMerge(enabled: boolean) {
  if (!draft.value?.options) return
  draft.value.options.genres.mode = enabled ? 'merge' : 'firstProvider'
}

function toggleSaveProviderIds() {
  if (!draft.value?.options) return
  draft.value.options.saveProviderIds = !draft.value.options.saveProviderIds
}

function handleClearAll() {
  if (!draft.value) return
  if (!confirm('Remove all active providers from every field? This will be saved immediately and cannot be undone.')) return
  emit('clearAll', draft.value)
}

function handleResetToDefault() {
  if (!confirm('Reset all global field rules to system defaults? This will overwrite your current configuration.')) return
  emit('resetToDefault')
}
</script>

<template>
  <div class="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
    <div class="px-4 py-3.5 md:px-5 md:py-4 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/30">
      <div>
        <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">Global Defaults</span>
        <p class="settings-hint">Default rules applied to every library. Override per-library below.</p>
      </div>
      <div class="hidden md:flex items-center gap-2 flex-wrap">
        <button
          class="settings-btn h-8 px-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md hover:text-destructive hover:border-destructive/50 hover:bg-destructive/5 transition-colors disabled:opacity-40"
          :disabled="saving || !draft"
          @click="handleClearAll"
        >
          <Trash2 :size="13" />
          <span>Clear All Providers</span>
        </button>
        <button
          class="settings-btn h-8 px-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-border/80 hover:bg-muted/50 transition-colors disabled:opacity-40"
          :disabled="saving"
          @click="handleResetToDefault"
        >
          <RotateCcw :size="13" />
          <span>Reset to Default</span>
        </button>
        <button class="settings-btn-primary h-8 px-3" :disabled="saving || !draft" @click="save">
          <Loader2 v-if="saving" :size="14" class="animate-spin" />
          <Save v-else :size="14" />
          <span>Save Defaults</span>
        </button>
      </div>
    </div>
    <div
      class="md:hidden sticky top-[5.25rem] z-10 mb-0 px-3 py-2 border-b border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75"
    >
      <div class="flex items-center gap-2 flex-wrap">
        <button
          class="settings-btn h-8 px-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md hover:text-destructive hover:border-destructive/50 hover:bg-destructive/5 transition-colors disabled:opacity-40"
          :disabled="saving || !draft"
          @click="handleClearAll"
        >
          <Trash2 :size="13" />
          <span>Clear All</span>
        </button>
        <button
          class="settings-btn h-8 px-3 flex items-center gap-1.5 text-xs font-medium text-muted-foreground border border-border rounded-md hover:text-foreground hover:border-border/80 hover:bg-muted/50 transition-colors disabled:opacity-40"
          :disabled="saving"
          @click="handleResetToDefault"
        >
          <RotateCcw :size="13" />
          <span>Reset</span>
        </button>
        <button class="settings-btn-primary h-8 px-3 justify-center ml-auto" :disabled="saving || !draft" @click="save">
          <Loader2 v-if="saving" :size="14" class="animate-spin" />
          <Save v-else :size="14" />
          <span>Save Defaults</span>
        </button>
      </div>
    </div>

    <div v-if="draft">
      <FieldPreferenceTable :preferences="draft" :statuses="statuses" @change="onFieldChange" />

      <!-- Advanced settings -->
      <div class="border-t border-border px-6 py-6 bg-muted/5 space-y-5">
        <div class="flex items-center gap-2">
          <Settings :size="16" class="text-muted-foreground" />
          <h4 class="settings-group-label !mb-0">Advanced Fetch Behavior</h4>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
          <!-- Genre Behavior -->
          <div class="space-y-4">
            <label class="flex items-start gap-3 group cursor-pointer">
              <div
                class="relative flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-0.5"
                :class="draft.options?.genres.mode === 'merge' ? 'bg-primary' : 'bg-muted border border-border'"
                @click.prevent="setGenreMerge(draft.options?.genres.mode !== 'merge')"
              >
                <span
                  class="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="draft.options?.genres.mode === 'merge' ? 'translate-x-4.5' : 'translate-x-0.5'"
                />
              </div>
              <div class="space-y-1">
                <span class="text-sm font-medium text-foreground">Combine genres from all selected providers</span>
                <p class="text-xs text-muted-foreground">
                  Collect and deduplicate genres from every provider assigned to the Genres field, rather than stopping at the first result.
                </p>
              </div>
            </label>
          </div>

          <!-- IDs Behavior -->
          <div class="space-y-4">
            <label class="flex items-start gap-3 group cursor-pointer">
              <div
                class="relative flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-0.5"
                :class="draft.options?.saveProviderIds ? 'bg-primary' : 'bg-muted border border-border'"
                @click.prevent="toggleSaveProviderIds"
              >
                <span
                  class="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="draft.options?.saveProviderIds ? 'translate-x-4.5' : 'translate-x-0.5'"
                />
              </div>
              <div class="space-y-1">
                <span class="text-sm font-medium text-foreground">Store provider IDs on books</span>
                <p class="text-xs text-muted-foreground">
                  When fetching metadata, save the returned provider IDs (ISBN, ASIN, Goodreads ID, etc.) on the book record for more accurate future
                  lookups.
                </p>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="px-6 py-12 flex items-center justify-center">
      <Loader2 :size="24" class="animate-spin text-muted-foreground" />
    </div>
  </div>
</template>
