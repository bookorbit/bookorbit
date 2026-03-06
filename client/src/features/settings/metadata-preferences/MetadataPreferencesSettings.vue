<script setup lang="ts">
import { onMounted, watch } from 'vue'
import type { FieldPreference, MetadataField, ProviderConfigurations } from '@projectx/types'
import { useLibraries } from '@/features/library/composables/useLibraries'
import ProviderConfigPanel from './components/ProviderConfigPanel.vue'
import GlobalPreferencePanel from './components/GlobalPreferencePanel.vue'
import LibraryPreferencePanel from './components/LibraryPreferencePanel.vue'
import { useProviderConfig } from './composables/useProviderConfig'
import { useMetadataPreferences } from './composables/useMetadataPreferences'

const { config, statuses, saving: savingProviders, fetchConfig, saveConfig } = useProviderConfig()
const { globalPrefs, libraryPrefs, savingGlobal, savingField, fetchGlobal, saveGlobal, fetchLibrary, saveFieldOverride, resetLibrary } =
  useMetadataPreferences()
const { libraries, fetchLibraries } = useLibraries()

onMounted(async () => {
  await Promise.all([fetchConfig(), fetchGlobal(), fetchLibraries()])
})

const fetchedLibraryIds = new Set<number>()

watch(libraries, async (libs) => {
  const newLibs = libs.filter((lib) => !fetchedLibraryIds.has(lib.id))
  newLibs.forEach((lib) => fetchedLibraryIds.add(lib.id))
  await Promise.all(newLibs.map((lib) => fetchLibrary(lib.id)))
})

async function onFieldChange(libraryId: number, field: MetadataField, pref: FieldPreference | null) {
  await saveFieldOverride(libraryId, field, pref)
}

async function onResetLibrary(libraryId: number) {
  await resetLibrary(libraryId)
}
</script>

<template>
  <div class="space-y-8">
    <div>
      <h2 class="settings-title">Metadata Preferences</h2>
      <p class="settings-subtitle">Control provider priority, merge behavior, and advanced auto-refresh metadata behavior.</p>
    </div>

    <div>
      <p class="settings-group-label">Providers</p>
      <ProviderConfigPanel
        :config="config"
        :statuses="statuses"
        :saving="savingProviders"
        @save="saveConfig($event as Partial<ProviderConfigurations>)"
      />
    </div>

    <div>
      <p class="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Field Preferences</p>
      <p class="text-xs text-muted-foreground mb-3">
        For each metadata field, choose which providers to use and in what order (drag to reorder - lower number = higher priority). The merge
        strategy controls how a provider's value is applied: <span class="font-medium text-foreground">Fill missing</span> only writes when empty,
        <span class="font-medium text-foreground">Overwrite if provided</span> writes whenever the provider returns a value,
        <span class="font-medium text-foreground">Always overwrite</span> replaces the existing value unconditionally.
      </p>
      <div class="space-y-3">
        <GlobalPreferencePanel :preferences="globalPrefs" :statuses="statuses" :saving="savingGlobal" @save="saveGlobal" />

        <div v-if="libraries.length" class="space-y-2">
          <p class="text-xs text-muted-foreground px-1">
            Per-library overrides - expand a library to customize individual fields. Fields not overridden inherit global defaults.
          </p>
          <LibraryPreferencePanel
            v-for="lib in libraries"
            :key="lib.id"
            :library-name="lib.name"
            :library-prefs="libraryPrefs.get(lib.id) ?? null"
            :statuses="statuses"
            :saving-field="savingField"
            @field-change="onFieldChange"
            @reset="onResetLibrary"
          />
        </div>
      </div>
    </div>
  </div>
</template>
