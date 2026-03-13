<script setup lang="ts">
import { onMounted, watch } from 'vue'
import type { FieldPreference, MetadataField, ProviderConfigurations } from '@projectx/types'
import { useLibraries } from '@/features/library/composables/useLibraries'
import ProviderConfigPanel from './components/ProviderConfigPanel.vue'
import GlobalPreferencePanel from './components/GlobalPreferencePanel.vue'
import LibraryPreferencePanel from './components/LibraryPreferencePanel.vue'
import { useProviderConfig } from './composables/useProviderConfig'
import { useMetadataPreferences } from './composables/useMetadataPreferences'
import { Info } from 'lucide-vue-next'
import SettingsPageHeader from '../SettingsPageHeader.vue'
import MetadataScoreWeightsSettings from '../MetadataScoreWeightsSettings.vue'

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
  <div class="space-y-10 pb-20">
    <SettingsPageHeader
      title="Metadata Preferences"
      subtitle="Configure how metadata is fetched and merged from different providers. Control priority, merge behavior, and library-specific overrides."
    />

    <!-- Provider Configuration -->
    <section class="space-y-4">
      <p class="settings-group-label">Metadata Providers</p>
      <ProviderConfigPanel
        :config="config"
        :statuses="statuses"
        :saving="savingProviders"
        @save="saveConfig($event as Partial<ProviderConfigurations>)"
      />
    </section>

    <!-- Field Preferences -->
    <section class="space-y-6">
      <div class="space-y-1">
        <p class="settings-group-label">Field Preferences</p>
        <div class="flex items-start gap-3 p-4 rounded-xl bg-primary/5 border border-primary/10 max-w-6xl">
          <Info :size="18" class="text-primary shrink-0 mt-0.5" />
          <p class="text-sm text-muted-foreground leading-relaxed">
            Choose which providers to use for each field and in what order (drag to reorder). The merge strategy controls how values are applied:
            <span class="font-semibold text-foreground">Fill missing</span> only writes when empty,
            <span class="font-semibold text-foreground">Overwrite if provided</span> writes whenever a provider returns a value, and
            <span class="font-semibold text-foreground">Always overwrite</span> replaces existing values unconditionally.
          </p>
        </div>
      </div>

      <div class="space-y-6">
        <GlobalPreferencePanel :preferences="globalPrefs" :statuses="statuses" :saving="savingGlobal" @save="saveGlobal" />

        <div v-if="libraries.length" class="space-y-4">
          <div class="px-1">
            <p class="text-sm font-medium text-foreground">Library Overrides</p>
            <p class="settings-hint">Expand a library to customize individual fields. Fields not overridden inherit global defaults.</p>
          </div>
          <div class="space-y-3">
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
    </section>

    <!-- Metadata Score Weights -->
    <section class="space-y-4 pt-4 border-t border-border">
      <MetadataScoreWeightsSettings />
    </section>
  </div>
</template>
