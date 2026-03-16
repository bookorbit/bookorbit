<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, Save, Settings } from 'lucide-vue-next'
import type { FieldPreference, MetadataFetchPreferences, MetadataField, ProviderStatus } from '@projectx/types'
import FieldPreferenceTable from './FieldPreferenceTable.vue'

const props = defineProps<{
  preferences: MetadataFetchPreferences | null
  statuses: ProviderStatus[]
  saving: boolean
}>()

const emit = defineEmits<{ save: [prefs: MetadataFetchPreferences] }>()

const draft = ref<MetadataFetchPreferences | null>(null)

function withDefaultOptions(prefs: MetadataFetchPreferences): MetadataFetchPreferences {
  return {
    ...prefs,
    options: {
      genres: {
        mode: prefs.options?.genres.mode ?? 'firstProvider',
        providerScope: prefs.options?.genres.providerScope ?? 'selectedProviders',
      },
      saveProviderIds: prefs.options?.saveProviderIds ?? false,
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
</script>

<template>
  <div class="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
    <div class="px-5 py-4 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/30">
      <div>
        <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">Global Defaults</span>
        <p class="settings-hint">Default rules applied to every library. Override per-library below.</p>
      </div>
      <button class="settings-btn-primary h-8 px-3" :disabled="saving || !draft" @click="save">
        <Loader2 v-if="saving" :size="14" class="animate-spin" />
        <Save v-else :size="14" />
        <span>Save Defaults</span>
      </button>
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
                <span class="text-sm font-medium text-foreground">Merge genres across providers</span>
                <p class="text-xs text-muted-foreground">Instead of taking genres from a single provider, combine them from multiple sources.</p>
              </div>
            </label>

            <fieldset class="pl-12 space-y-3" :class="draft.options?.genres.mode !== 'merge' ? 'opacity-40 pointer-events-none' : ''">
              <label class="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="genre-provider-scope"
                  class="h-4 w-4 border-input accent-primary cursor-pointer"
                  :checked="draft.options?.genres.providerScope === 'selectedProviders'"
                  @change="draft.options && (draft.options.genres.providerScope = 'selectedProviders')"
                />
                <span class="text-sm text-foreground group-hover:text-primary transition-colors">Use only providers selected for Genres field</span>
              </label>
              <label class="flex items-center gap-2.5 cursor-pointer group">
                <input
                  type="radio"
                  name="genre-provider-scope"
                  class="h-4 w-4 border-input accent-primary cursor-pointer"
                  :checked="draft.options?.genres.providerScope === 'allConfiguredProviders'"
                  @change="draft.options && (draft.options.genres.providerScope = 'allConfiguredProviders')"
                />
                <span class="text-sm text-foreground group-hover:text-primary transition-colors">Use all enabled and configured providers</span>
              </label>
            </fieldset>
          </div>

          <!-- IDs Behavior -->
          <div class="space-y-4">
            <label class="flex items-start gap-3 group cursor-pointer">
              <div
                class="relative flex h-5 w-9 shrink-0 items-center rounded-full transition-colors mt-0.5"
                :class="draft.options?.saveProviderIds ? 'bg-primary' : 'bg-muted border border-border'"
                @click.prevent="draft.options && (draft.options.saveProviderIds = !draft.options.saveProviderIds)"
              >
                <span
                  class="inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform"
                  :class="draft.options?.saveProviderIds ? 'translate-x-4.5' : 'translate-x-0.5'"
                />
              </div>
              <div class="space-y-1">
                <span class="text-sm font-medium text-foreground">Save provider IDs</span>
                <p class="text-xs text-muted-foreground">
                  Persist IDs (ISBN, ASIN, Goodreads ID, etc.) back to the book records during auto-refresh.
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
