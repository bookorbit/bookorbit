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
    <!-- Provider Configuration -->
    <section class="space-y-4">
      <p class="settings-group-label">External Connections</p>
      <ProviderConfigPanel
        :config="config"
        :statuses="statuses"
        :saving="savingProviders"
        @save="saveConfig($event as Partial<ProviderConfigurations>)"
      />
    </section>

    <!-- Field Preferences -->
    <section class="space-y-6">
      <div class="space-y-3">
        <p class="settings-group-label">Field-Level Rules</p>
        <div class="p-4 rounded-xl bg-primary/5 border border-primary/10 max-w-5xl">
          <div class="flex items-start gap-3 mb-3">
            <Info :size="18" class="text-primary shrink-0 mt-0.5" />
            <p class="text-sm font-medium text-foreground">How Field Rules Work</p>
          </div>
          <div class="grid sm:grid-cols-2 gap-x-8 gap-y-4 text-xs leading-relaxed text-muted-foreground ml-7">
            <div>
              <p class="font-semibold text-foreground mb-1">Priority Order</p>
              <p>
                Drag providers in the list to reorder them. The top-most provider that returns a result will be the primary source for that field.
              </p>
            </div>
            <div>
              <p class="font-semibold text-foreground mb-1">Merge Strategy</p>
              <ul class="space-y-1">
                <li><span class="text-foreground">Fill missing:</span> Only write if current value is empty.</li>
                <li><span class="text-foreground">Overwrite:</span> Replace whenever a provider has data.</li>
              </ul>
            </div>
          </div>
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
  </div>
</template>
