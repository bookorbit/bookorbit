<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useDisplaySettings } from '@/composables/useDisplaySettings'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'
import { useBookRequestVisibility } from '@/features/book-requests/composables/useBookRequestVisibility'

const { t } = useI18n()

const { smartScopeFilterExpanded, openHighlightsInPeek } = useDisplaySettings()
const { prefs, setPreference } = useSeriesCollapsePreference()
const { showBookRequests, saving: savingBookRequestVisibility, setShowBookRequests } = useBookRequestVisibility()

const globalCollapseEnabled = computed(() => prefs.value?.global ?? false)

async function handleGlobalCollapseToggle(value: boolean) {
  await setPreference('global', value)
}

async function handleBookRequestVisibilityToggle(value: boolean) {
  if (!(await setShowBookRequests(value))) toast.error(t('settings.appearance.behavior.bookRequests.saveFailed'))
}
</script>

<template>
  <div>
    <p class="settings-group-label">
      {{ t('settings.appearance.behavior.title') }}
    </p>
    <div class="settings-card">
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">
            {{ t('settings.appearance.behavior.filterPreview.label') }}
          </p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            {{ t('settings.appearance.behavior.filterPreview.hint') }}
          </p>
        </div>
        <ToggleSwitch v-model="smartScopeFilterExpanded" />
      </div>
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">
            {{ t('settings.appearance.behavior.highlightPeek.label') }}
          </p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            {{ t('settings.appearance.behavior.highlightPeek.hint') }}
          </p>
        </div>
        <ToggleSwitch v-model="openHighlightsInPeek" :aria-label="t('settings.appearance.behavior.highlightPeek.label')" />
      </div>
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">
            {{ t('settings.appearance.behavior.collapseSeries.label') }}
          </p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Group books in the same series into a single card in library, collection, and Smart Scope views
          </p>
        </div>
        <ToggleSwitch :model-value="globalCollapseEnabled" @update:model-value="handleGlobalCollapseToggle" />
      </div>
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">{{ t('settings.appearance.behavior.bookRequests.label') }}</p>
          <p class="settings-hint">{{ t('settings.appearance.behavior.bookRequests.hint') }}</p>
        </div>
        <ToggleSwitch
          :model-value="showBookRequests"
          :disabled="savingBookRequestVisibility"
          :aria-label="t('settings.appearance.behavior.bookRequests.label')"
          @update:model-value="handleBookRequestVisibilityToggle"
        />
      </div>
    </div>
  </div>
</template>
