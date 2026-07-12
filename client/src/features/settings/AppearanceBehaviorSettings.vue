<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, BookText } from '@lucide/vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useDisplaySettings, type BookThumbnailClickAction } from '@/composables/useDisplaySettings'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'

const { t } = useI18n()

const { smartScopeFilterExpanded, thumbnailClickAction } = useDisplaySettings()
const { prefs, setPreference } = useSeriesCollapsePreference()

const globalCollapseEnabled = computed(() => prefs.value?.global ?? false)

const thumbnailClickOptions = computed<{ id: BookThumbnailClickAction; label: string; hint: string; icon: typeof BookOpen }[]>(() => [
  {
    id: 'reader',
    label: t('settings.appearance.behavior.thumbnailClicks.readFirst'),
    hint: t('settings.appearance.behavior.thumbnailClicks.readFirstHint'),
    icon: BookOpen,
  },
  {
    id: 'details',
    label: t('settings.appearance.behavior.thumbnailClicks.openDetails'),
    hint: t('settings.appearance.behavior.thumbnailClicks.openDetailsHint'),
    icon: BookText,
  },
])

async function handleGlobalCollapseToggle(value: boolean) {
  await setPreference('global', value)
}

function setThumbnailClickAction(action: BookThumbnailClickAction) {
  thumbnailClickAction.value = action
}
</script>

<template>
  <div>
    <p class="settings-group-label">{{ t('settings.appearance.behavior.title') }}</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <div class="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:px-5 md:py-4 bg-card">
        <div class="min-w-0">
          <p class="settings-label">{{ t('settings.appearance.behavior.thumbnailClicks.label') }}</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            {{ t('settings.appearance.behavior.thumbnailClicks.hint') }}
          </p>
        </div>
        <div
          class="grid w-full gap-1 rounded-lg border border-border bg-muted/50 p-1 sm:w-auto sm:grid-cols-2"
          data-testid="thumbnail-click-action-control"
        >
          <button
            v-for="opt in thumbnailClickOptions"
            :key="opt.id"
            class="flex min-w-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-xs font-medium transition-colors"
            :class="thumbnailClickAction === opt.id ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="setThumbnailClickAction(opt.id)"
          >
            <component :is="opt.icon" class="size-3.5 shrink-0" />
            <span class="min-w-0">
              <span class="block truncate">{{ opt.label }}</span>
              <span class="block truncate text-[10px] font-normal opacity-75">{{ opt.hint }}</span>
            </span>
          </button>
        </div>
      </div>
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">{{ t('settings.appearance.behavior.filterPreview.label') }}</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            {{ t('settings.appearance.behavior.filterPreview.hint') }}
          </p>
        </div>
        <ToggleSwitch v-model="smartScopeFilterExpanded" />
      </div>
      <div class="flex items-center justify-between gap-3 px-4 py-3 md:px-5 md:py-3.5 bg-card">
        <div class="min-w-0">
          <p class="settings-label">{{ t('settings.appearance.behavior.collapseSeries.label') }}</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Group books in the same series into a single card in library, collection, and Smart Scope views
          </p>
        </div>
        <ToggleSwitch :model-value="globalCollapseEnabled" @update:model-value="handleGlobalCollapseToggle" />
      </div>
    </div>
  </div>
</template>
