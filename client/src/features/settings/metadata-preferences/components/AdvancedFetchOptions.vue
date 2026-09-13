<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Settings } from '@lucide/vue'
import { MAX_METADATA_GENRE_COUNT } from '@bookorbit/types'
import type { MetadataFetchOptions } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const { t } = useI18n()

const props = defineProps<{ options: MetadataFetchOptions; disabled?: boolean }>()
const emit = defineEmits<{ change: [options: MetadataFetchOptions]; 'update:valid': [valid: boolean] }>()

const maxCount = computed(() => props.options.genres.maxCount)
const isMaxCountValid = computed(
  () => maxCount.value === null || (Number.isInteger(maxCount.value) && maxCount.value >= 1 && maxCount.value <= MAX_METADATA_GENRE_COUNT),
)
const maxCountDescribedBy = computed(() => (isMaxCountValid.value ? 'genre-max-count-hint' : 'genre-max-count-hint genre-max-count-error'))

// The page disables Save while this is false, so an out-of-range cap can never be sent.
watch(isMaxCountValid, (valid) => emit('update:valid', valid), { immediate: true })

function setGenreMode(merge: boolean) {
  emit('change', { ...props.options, genres: { ...props.options.genres, mode: merge ? 'merge' : 'firstProvider' } })
}

function setSaveProviderIds(value: boolean) {
  emit('change', { ...props.options, saveProviderIds: value })
}

function setExistingProviderIdsOnly(value: boolean) {
  emit('change', { ...props.options, providerIdMode: value ? 'existingOnly' : 'preferExisting' })
}

function setMaxCount(event: Event) {
  const value = (event.target as HTMLInputElement).valueAsNumber
  emit('change', { ...props.options, genres: { ...props.options.genres, maxCount: Number.isNaN(value) ? null : value } })
}
</script>

<template>
  <section class="border-t border-border bg-muted/10 px-4 py-5 md:px-6">
    <div class="mb-4 flex items-center gap-2">
      <Settings :size="16" class="text-muted-foreground" aria-hidden="true" />
      <h3 class="settings-group-label mb-0!">{{ t('settings.metadata.fieldRules.advanced.title') }}</h3>
    </div>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div class="h-full rounded-lg border border-border bg-background/60 p-4 shadow-xs">
        <div class="flex items-start justify-between gap-4">
          <span id="combine-genres-label" class="text-sm font-medium leading-5 text-foreground">
            {{ t('settings.metadata.fieldRules.advanced.combineGenres.label') }}
          </span>
          <ToggleSwitch
            :model-value="options.genres.mode === 'merge'"
            :disabled="disabled"
            aria-labelledby="combine-genres-label"
            aria-describedby="combine-genres-hint"
            @update:model-value="setGenreMode"
          />
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
            :value="options.genres.maxCount ?? ''"
            :placeholder="t('settings.metadata.fieldRules.advanced.maxGenres.unlimited')"
            :aria-invalid="!isMaxCountValid"
            :aria-describedby="maxCountDescribedBy"
            :disabled="disabled"
            class="h-8 w-24 shrink-0 rounded-md border border-input bg-background px-2 text-center text-sm tabular-nums outline-none transition-shadow placeholder:text-muted-foreground focus:ring-1 focus:ring-ring"
            @input="setMaxCount"
          />
        </div>
        <p id="genre-max-count-hint" class="mt-2 text-xs leading-relaxed text-muted-foreground">
          {{ t('settings.metadata.fieldRules.advanced.maxGenres.hint') }}
        </p>
        <p v-if="!isMaxCountValid" id="genre-max-count-error" class="mt-1 text-xs text-destructive" role="alert">
          {{ t('settings.metadata.fieldRules.advanced.maxGenres.error', { max: MAX_METADATA_GENRE_COUNT }) }}
        </p>
      </div>

      <div class="h-full rounded-lg border border-border bg-background/60 p-4 shadow-xs">
        <div class="flex items-start justify-between gap-4">
          <span id="store-provider-ids-label" class="text-sm font-medium leading-5 text-foreground">
            {{ t('settings.metadata.fieldRules.advanced.storeProviderIds.label') }}
          </span>
          <ToggleSwitch
            :model-value="options.saveProviderIds"
            :disabled="disabled"
            aria-labelledby="store-provider-ids-label"
            aria-describedby="store-provider-ids-hint"
            @update:model-value="setSaveProviderIds"
          />
        </div>
        <p id="store-provider-ids-hint" class="mt-2 text-xs leading-relaxed text-muted-foreground">
          {{ t('settings.metadata.fieldRules.advanced.storeProviderIds.hint') }}
        </p>
      </div>

      <div class="h-full rounded-lg border border-border bg-background/60 p-4 shadow-xs">
        <div class="flex items-start justify-between gap-4">
          <span id="existing-provider-ids-only-label" class="text-sm font-medium leading-5 text-foreground">
            {{ t('settings.metadata.fieldRules.advanced.existingProviderIdsOnly.label') }}
          </span>
          <ToggleSwitch
            :model-value="options.providerIdMode === 'existingOnly'"
            :disabled="disabled"
            aria-labelledby="existing-provider-ids-only-label"
            aria-describedby="existing-provider-ids-only-hint"
            @update:model-value="setExistingProviderIdsOnly"
          />
        </div>
        <p id="existing-provider-ids-only-hint" class="mt-2 text-xs leading-relaxed text-muted-foreground">
          {{ t('settings.metadata.fieldRules.advanced.existingProviderIdsOnly.hint') }}
        </p>
      </div>
    </div>
  </section>
</template>
