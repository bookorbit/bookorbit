<script setup lang="ts">
import { Button } from '@/components/ui/button'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, RotateCcw, Save, Settings, Trash2 } from '@lucide/vue'
import { MAX_METADATA_GENRE_COUNT } from '@bookorbit/types'
import type { FieldPreference, MetadataFetchPreferences, MetadataField, ProviderStatus } from '@bookorbit/types'
import FieldPreferenceTable from './FieldPreferenceTable.vue'

const { t } = useI18n()

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
        blocklist: prefs.options?.genres.blocklist ?? [],
        maxCount: prefs.options?.genres.maxCount ?? null,
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
  if (!draft.value || !isGenreMaxCountValid.value) return
  emit('save', draft.value)
}

function toggleGenreMerge() {
  if (!draft.value?.options) return
  draft.value.options.genres.mode = draft.value.options.genres.mode === 'merge' ? 'firstProvider' : 'merge'
}

function toggleSaveProviderIds() {
  if (!draft.value?.options) return
  draft.value.options.saveProviderIds = !draft.value.options.saveProviderIds
}

const genreMaxCount = computed(() => draft.value?.options?.genres.maxCount ?? null)
const isGenreMaxCountValid = computed(
  () =>
    genreMaxCount.value === null ||
    (Number.isInteger(genreMaxCount.value) && genreMaxCount.value >= 1 && genreMaxCount.value <= MAX_METADATA_GENRE_COUNT),
)
const genreMaxCountDescriptionIds = computed(() =>
  isGenreMaxCountValid.value ? 'genre-max-count-hint' : 'genre-max-count-hint genre-max-count-error',
)

function setGenreMaxCount(event: Event) {
  if (!draft.value?.options) return
  const value = (event.target as HTMLInputElement).valueAsNumber
  draft.value.options.genres.maxCount = Number.isNaN(value) ? null : value
}

function handleClearAll() {
  if (!draft.value) return
  if (!confirm(t('settings.metadata.fieldRules.global.clearAllConfirm'))) return
  emit('clearAll', draft.value)
}

function handleResetToDefault() {
  if (!confirm(t('settings.metadata.fieldRules.global.resetConfirm'))) return
  emit('resetToDefault')
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card overflow-hidden shadow-xs">
    <div class="px-4 py-3.5 md:px-5 md:py-4 border-b border-border flex flex-col md:flex-row md:items-center justify-between gap-4 bg-muted/30">
      <div>
        <span class="text-xs font-bold text-muted-foreground uppercase tracking-widest">{{ t('settings.metadata.fieldRules.global.title') }}</span>
        <p class="settings-hint">{{ t('settings.metadata.fieldRules.global.hint') }}</p>
      </div>
      <div class="hidden md:flex items-center gap-2 flex-wrap">
        <Button type="button" variant="destructive-outline" size="sm" :disabled="saving || !draft" @click="handleClearAll">
          <Trash2 :size="13" />
          <span>{{ t('settings.metadata.fieldRules.clearAllProviders') }}</span>
        </Button>
        <Button type="button" variant="outline" size="sm" :disabled="saving" @click="handleResetToDefault">
          <RotateCcw :size="13" />
          <span>{{ t('settings.metadata.fieldRules.resetToDefault') }}</span>
        </Button>
        <Button size="sm" class="px-3" :disabled="saving || !draft || !isGenreMaxCountValid" @click="save" type="button">
          <Loader2 v-if="saving" :size="14" class="animate-spin" />
          <Save v-else :size="14" />
          <span>{{ t('settings.metadata.fieldRules.global.saveDefaults') }}</span>
        </Button>
      </div>
    </div>
    <div class="md:hidden sticky top-11 z-10 mb-0 px-3 py-2 border-b border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/75">
      <div class="flex items-center gap-2 flex-wrap">
        <Button type="button" variant="destructive-outline" size="sm" :disabled="saving || !draft" @click="handleClearAll">
          <Trash2 :size="13" />
          <span>{{ t('settings.metadata.fieldRules.clearAll') }}</span>
        </Button>
        <Button type="button" variant="outline" size="sm" :disabled="saving" @click="handleResetToDefault">
          <RotateCcw :size="13" />
          <span>{{ t('settings.metadata.fieldRules.reset') }}</span>
        </Button>
        <Button size="sm" class="px-3 ml-auto" :disabled="saving || !draft || !isGenreMaxCountValid" @click="save" type="button">
          <Loader2 v-if="saving" :size="14" class="animate-spin" />
          <Save v-else :size="14" />
          <span>{{ t('settings.metadata.fieldRules.global.saveDefaults') }}</span>
        </Button>
      </div>
    </div>

    <div v-if="draft">
      <FieldPreferenceTable :preferences="draft" :statuses="statuses" @change="onFieldChange" />

      <!-- Advanced settings -->
      <div class="border-t border-border px-6 py-6 bg-muted/5 space-y-5">
        <div class="flex items-center gap-2">
          <Settings :size="16" class="text-muted-foreground" />
          <h4 class="settings-group-label !mb-0">{{ t('settings.metadata.fieldRules.advanced.title') }}</h4>
        </div>

        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <div class="h-full rounded-lg border border-border bg-background/60 p-4 shadow-xs">
            <div class="flex items-start justify-between gap-4">
              <span id="combine-genres-label" class="text-sm font-medium leading-5 text-foreground">
                {{ t('settings.metadata.fieldRules.advanced.combineGenres.label') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="draft.options?.genres.mode === 'merge'"
                aria-labelledby="combine-genres-label"
                aria-describedby="combine-genres-hint"
                class="relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                :class="draft.options?.genres.mode === 'merge' ? 'bg-primary' : 'bg-muted border border-border'"
                @click="toggleGenreMerge"
              >
                <span
                  class="inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform"
                  :class="draft.options?.genres.mode === 'merge' ? 'translate-x-4.5' : 'translate-x-0.5'"
                />
              </button>
            </div>
            <p id="combine-genres-hint" class="mt-2 text-xs leading-relaxed text-muted-foreground">
              {{ t('settings.metadata.fieldRules.advanced.combineGenres.hint') }}
            </p>
          </div>

          <div class="h-full rounded-lg border border-border bg-background/60 p-4 shadow-xs">
            <div class="flex items-start justify-between gap-4">
              <label for="genre-max-count" class="text-sm font-medium leading-5 text-foreground">
                {{ t('settings.metadata.fieldRules.advanced.maxGenres.label') }}
              </label>
              <input
                id="genre-max-count"
                type="number"
                min="1"
                :max="MAX_METADATA_GENRE_COUNT"
                step="1"
                :value="draft.options?.genres.maxCount ?? ''"
                :placeholder="t('settings.metadata.fieldRules.advanced.maxGenres.unlimited')"
                :aria-invalid="!isGenreMaxCountValid"
                :aria-describedby="genreMaxCountDescriptionIds"
                class="h-8 w-24 shrink-0 rounded-md border border-input bg-background px-2 text-center text-sm tabular-nums outline-none transition-shadow focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                @input="setGenreMaxCount"
              />
            </div>
            <p id="genre-max-count-hint" class="mt-2 text-xs leading-relaxed text-muted-foreground">
              {{ t('settings.metadata.fieldRules.advanced.maxGenres.hint') }}
            </p>
            <p v-if="!isGenreMaxCountValid" id="genre-max-count-error" class="text-xs text-destructive">
              {{ t('settings.metadata.fieldRules.advanced.maxGenres.error', { max: MAX_METADATA_GENRE_COUNT }) }}
            </p>
          </div>

          <div class="h-full rounded-lg border border-border bg-background/60 p-4 shadow-xs">
            <div class="flex items-start justify-between gap-4">
              <span id="store-provider-ids-label" class="text-sm font-medium leading-5 text-foreground">
                {{ t('settings.metadata.fieldRules.advanced.storeProviderIds.label') }}
              </span>
              <button
                type="button"
                role="switch"
                :aria-checked="draft.options?.saveProviderIds"
                aria-labelledby="store-provider-ids-label"
                aria-describedby="store-provider-ids-hint"
                class="relative flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                :class="draft.options?.saveProviderIds ? 'bg-primary' : 'bg-muted border border-border'"
                @click="toggleSaveProviderIds"
              >
                <span
                  class="inline-block h-4 w-4 rounded-full bg-white shadow-xs transition-transform"
                  :class="draft.options?.saveProviderIds ? 'translate-x-4.5' : 'translate-x-0.5'"
                />
              </button>
            </div>
            <p id="store-provider-ids-hint" class="mt-2 text-xs leading-relaxed text-muted-foreground">
              {{ t('settings.metadata.fieldRules.advanced.storeProviderIds.hint') }}
            </p>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="px-6 py-12 flex items-center justify-center">
      <Loader2 :size="24" class="animate-spin text-muted-foreground" />
    </div>
  </div>
</template>
