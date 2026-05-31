<script setup lang="ts">
import { computed } from 'vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'

const { smartScopeFilterExpanded } = useDisplaySettings()
const { prefs, setPreference } = useSeriesCollapsePreference()

const globalCollapseEnabled = computed(() => prefs.value?.global ?? false)

async function handleGlobalCollapseToggle(value: boolean) {
  await setPreference('global', value)
}
</script>

<template>
  <div>
    <p class="settings-group-label">Library Behavior</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">Show filter preview by default</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Expand the active filter and sort summary when opening a smartScope
          </p>
        </div>
        <ToggleSwitch v-model="smartScopeFilterExpanded" />
      </div>
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">Collapse series by default</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Group books in the same series into a single card in library and collection views
          </p>
        </div>
        <ToggleSwitch :model-value="globalCollapseEnabled" @update:model-value="handleGlobalCollapseToggle" />
      </div>
    </div>
  </div>
</template>
