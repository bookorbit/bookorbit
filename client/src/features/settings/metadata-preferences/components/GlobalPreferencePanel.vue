<script setup lang="ts">
import { ref, watch } from 'vue'
import { Loader2, Save } from 'lucide-vue-next'
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
  <div class="border border-border rounded-lg bg-card overflow-hidden">
    <div class="px-5 py-4 border-b border-border flex items-center justify-between">
      <div>
        <p class="text-sm font-semibold text-foreground">Global Defaults</p>
        <p class="settings-hint">Default rules applied to every library. Override per-library below.</p>
      </div>
      <button
        class="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        :disabled="saving || !draft"
        @click="save"
      >
        <Loader2 v-if="saving" :size="13" class="animate-spin" />
        <Save v-else :size="13" />
        Save
      </button>
    </div>

    <div v-if="draft">
      <FieldPreferenceTable :preferences="draft" :statuses="statuses" @change="onFieldChange" />
      <div class="border-t border-border px-5 py-4 space-y-3">
        <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Advanced Fetch Behavior</p>

        <label class="flex items-start gap-2.5">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 rounded border-input accent-primary mt-0.5 cursor-pointer"
            :checked="draft.options?.genres.mode === 'merge'"
            @change="setGenreMerge(($event.target as HTMLInputElement).checked)"
          />
          <span class="text-sm text-foreground leading-5">Merge genres across providers</span>
        </label>

        <fieldset class="pl-6 space-y-2" :disabled="draft.options?.genres.mode !== 'merge'">
          <label class="flex items-start gap-2.5">
            <input
              type="radio"
              name="genre-provider-scope"
              class="h-3.5 w-3.5 border-input accent-primary mt-0.5 cursor-pointer"
              :checked="draft.options?.genres.providerScope === 'selectedProviders'"
              :disabled="draft.options?.genres.mode !== 'merge'"
              @change="draft.options && (draft.options.genres.providerScope = 'selectedProviders')"
            />
            <span class="text-sm text-foreground leading-5">Use only selected providers from the Genres field</span>
          </label>
          <label class="flex items-start gap-2.5">
            <input
              type="radio"
              name="genre-provider-scope"
              class="h-3.5 w-3.5 border-input accent-primary mt-0.5 cursor-pointer"
              :checked="draft.options?.genres.providerScope === 'allConfiguredProviders'"
              :disabled="draft.options?.genres.mode !== 'merge'"
              @change="draft.options && (draft.options.genres.providerScope = 'allConfiguredProviders')"
            />
            <span class="text-sm text-foreground leading-5">Use all enabled and configured providers</span>
          </label>
        </fieldset>

        <label class="flex items-start gap-2.5">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 rounded border-input accent-primary mt-0.5 cursor-pointer"
            :checked="draft.options?.saveProviderIds ?? false"
            @change="draft.options && (draft.options.saveProviderIds = ($event.target as HTMLInputElement).checked)"
          />
          <span class="text-sm text-foreground leading-5">Save provider IDs during auto-refresh</span>
        </label>
      </div>
    </div>
    <div v-else class="px-5 py-6 text-sm text-muted-foreground">Loading...</div>
  </div>
</template>
