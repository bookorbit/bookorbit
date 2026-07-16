<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FieldPreferenceOverrides } from '@bookorbit/types'
import { Info } from '@lucide/vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import GlobalPreferencePanel from './components/GlobalPreferencePanel.vue'
import LibraryPreferencePanel from './components/LibraryPreferencePanel.vue'
import { useProviderConfig } from './composables/useProviderConfig'
import { useMetadataPreferences } from './composables/useMetadataPreferences'

const { t } = useI18n()
const { statuses, fetchConfig } = useProviderConfig()
const {
  globalPrefs,
  libraryPrefs,
  savingGlobal,
  savingLibrary,
  fetchGlobal,
  saveGlobal,
  resetGlobal,
  clearAllProviders,
  fetchLibrary,
  saveLibraryDraft,
  resetLibrary,
} = useMetadataPreferences()
const { libraries, fetchLibraries } = useLibraries()

onMounted(() => {
  void Promise.all([fetchConfig(), fetchGlobal(), fetchLibraries()]).catch(() => undefined)
})

const fetchedLibraryIds = new Set<number>()

watch(
  libraries,
  async (libs) => {
    const newLibs = libs.filter((lib) => !fetchedLibraryIds.has(lib.id))
    newLibs.forEach((lib) => fetchedLibraryIds.add(lib.id))
    await Promise.all(newLibs.map((lib) => fetchLibrary(lib.id)))
  },
  { immediate: true },
)

async function onSaveLibrary(libraryId: number, overrides: FieldPreferenceOverrides) {
  await saveLibraryDraft(libraryId, overrides)
}

async function onResetLibrary(libraryId: number) {
  await resetLibrary(libraryId)
}
</script>

<template>
  <div class="space-y-6">
    <div class="p-4 rounded-lg bg-primary/5 border border-primary/10 max-w-6xl shadow-xs">
      <div class="flex items-start gap-3 mb-3">
        <Info :size="18" class="text-primary shrink-0 mt-0.5" />
        <p class="text-sm font-medium text-foreground">{{ t('settings.metadata.fieldRules.howItWorks.title') }}</p>
      </div>
      <div class="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-xs leading-relaxed text-muted-foreground ml-7">
        <div>
          <p class="font-semibold text-foreground mb-1">{{ t('settings.metadata.fieldRules.howItWorks.priorityOrder.title') }}</p>
          <p>{{ t('settings.metadata.fieldRules.howItWorks.priorityOrder.body') }}</p>
        </div>
        <div>
          <p class="font-semibold text-foreground mb-1">{{ t('settings.metadata.fieldRules.howItWorks.mergeStrategy.title') }}</p>
          <ul class="space-y-1">
            <li>
              <span class="text-foreground">{{ t('settings.metadata.fieldRules.howItWorks.mergeStrategy.fillMissingTerm') }}</span>
              {{ t('settings.metadata.fieldRules.howItWorks.mergeStrategy.fillMissingBody') }}
            </li>
            <li>
              <span class="text-foreground">{{ t('settings.metadata.fieldRules.howItWorks.mergeStrategy.overwriteTerm') }}</span>
              {{ t('settings.metadata.fieldRules.howItWorks.mergeStrategy.overwriteBody') }}
            </li>
          </ul>
        </div>
      </div>
    </div>

    <GlobalPreferencePanel
      :preferences="globalPrefs"
      :statuses="statuses"
      :saving="savingGlobal"
      @save="saveGlobal"
      @clear-all="clearAllProviders"
      @reset-to-default="resetGlobal"
    />

    <div v-if="libraries.length" class="space-y-4">
      <div class="px-1">
        <p class="text-sm font-medium text-foreground">{{ t('settings.metadata.fieldRules.libraryOverrides.title') }}</p>
        <p class="settings-hint">{{ t('settings.metadata.fieldRules.libraryOverrides.hint') }}</p>
      </div>
      <div class="space-y-3">
        <LibraryPreferencePanel
          v-for="lib in libraries"
          :key="lib.id"
          :library-name="lib.name"
          :library-primary-format="lib.formatPriority[0] ?? null"
          :library-prefs="libraryPrefs.get(lib.id) ?? null"
          :global-prefs="globalPrefs"
          :statuses="statuses"
          :saving="savingLibrary === lib.id"
          @save="onSaveLibrary"
          @reset="onResetLibrary"
        />
      </div>
    </div>
  </div>
</template>
