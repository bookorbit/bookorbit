<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BookOpen, BookText } from '@lucide/vue'
import { LOCALE_LABELS, SUPPORTED_LOCALES, type Locale } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { useDisplaySettings, type BookThumbnailClickAction } from '@/composables/useDisplaySettings'
import { useSeriesCollapsePreference } from '@/features/book/composables/useSeriesCollapsePreference'
import { useLocaleStore } from '@/stores/locale'

const { t } = useI18n()
const localeStore = useLocaleStore()

const LANGUAGE_OPTIONS: { id: Locale; label: string }[] = SUPPORTED_LOCALES.map((id) => ({ id, label: LOCALE_LABELS[id] }))

async function setLanguage(next: Locale) {
  await localeStore.setLocale(next)
}

const { smartScopeFilterExpanded, thumbnailClickAction } = useDisplaySettings()
const { prefs, setPreference } = useSeriesCollapsePreference()

const globalCollapseEnabled = computed(() => prefs.value?.global ?? false)

const THUMBNAIL_CLICK_OPTIONS: { id: BookThumbnailClickAction; label: string; hint: string; icon: typeof BookOpen }[] = [
  { id: 'reader', label: 'Read first', hint: 'Open the reader when a readable file exists', icon: BookOpen },
  { id: 'details', label: 'Open details', hint: 'Go to the book details page from grid and list thumbnails', icon: BookText },
]

async function handleGlobalCollapseToggle(value: boolean) {
  await setPreference('global', value)
}

function setThumbnailClickAction(action: BookThumbnailClickAction) {
  thumbnailClickAction.value = action
}
</script>

<template>
  <div>
    <p class="settings-group-label">{{ t('settings.appearance.language.title') }}</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs mb-6">
      <div class="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:px-5 md:py-4 bg-card">
        <div class="min-w-0">
          <p class="settings-label">{{ t('settings.appearance.language.label') }}</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            {{ t('settings.appearance.language.description') }}
          </p>
        </div>
        <div
          class="grid w-full gap-1 rounded-lg border border-border bg-muted/50 p-1 sm:w-auto"
          :style="{ gridTemplateColumns: `repeat(${LANGUAGE_OPTIONS.length}, minmax(0, 1fr))` }"
          data-testid="language-control"
        >
          <button
            v-for="opt in LANGUAGE_OPTIONS"
            :key="opt.id"
            class="min-w-0 rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors"
            :class="localeStore.locale === opt.id ? 'bg-background shadow-xs text-foreground' : 'text-muted-foreground hover:text-foreground'"
            :data-testid="`language-option-${opt.id}`"
            @click="setLanguage(opt.id)"
          >
            <span class="block truncate">{{ opt.label }}</span>
          </button>
        </div>
      </div>
    </div>

    <p class="settings-group-label">Library Behavior</p>
    <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
      <div class="flex flex-col gap-3 px-4 py-3.5 md:flex-row md:items-center md:justify-between md:px-5 md:py-4 bg-card">
        <div class="min-w-0">
          <p class="settings-label">Thumbnail clicks</p>
          <p class="settings-hint overflow-hidden text-ellipsis whitespace-nowrap md:whitespace-normal md:overflow-visible">
            Choose what happens when opening a book from grid and list views
          </p>
        </div>
        <div
          class="grid w-full gap-1 rounded-lg border border-border bg-muted/50 p-1 sm:w-auto sm:grid-cols-2"
          data-testid="thumbnail-click-action-control"
        >
          <button
            v-for="opt in THUMBNAIL_CLICK_OPTIONS"
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
