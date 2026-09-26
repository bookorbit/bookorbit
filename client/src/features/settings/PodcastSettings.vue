<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { PODCAST_OPML_OMITTED_HEADER } from '@bookorbit/types'
import { formatBytes } from '@/lib/formatting'
import { formatNumber } from '@/i18n/formatters'
import { usePodcastSettings } from '@/features/podcast/composables/usePodcastSettings'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import SettingsPageHeader from './SettingsPageHeader.vue'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const settings = usePodcastSettings()
const volumePercent = computed(() => formatNumber(settings.playback.value.volume, { style: 'percent' }))

async function loadSettings() {
  try {
    const requestedLibraryId = Number(route.query.libraryId)
    await settings.load(Number.isInteger(requestedLibraryId) && requestedLibraryId > 0 ? requestedLibraryId : undefined)
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.loadSettings'))
  }
}

async function handleLibraryChange(event: Event) {
  const libraryId = Number((event.currentTarget as HTMLSelectElement).value)
  try {
    await settings.selectLibrary(libraryId)
    await router.replace({ query: { ...route.query, libraryId: String(libraryId) } })
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.loadSettings'))
  }
}

async function exportOpml() {
  const libraryId = settings.selectedLibraryId.value
  if (!libraryId) return
  try {
    const response = await api(`/api/v1/podcast-libraries/${libraryId}/opml/export`)
    if (!response.ok) throw new Error(t('podcast.errors.opmlExport'))
    const url = URL.createObjectURL(await response.blob())
    try {
      const link = document.createElement('a')
      link.href = url
      link.download = 'podcasts.opml'
      link.click()
    } finally {
      URL.revokeObjectURL(url)
    }
    // OPML has no way to name a show without a feed, so local shows are left out of the file and
    // the count of them travels back in a header rather than the export just being short.
    const omitted = Number(response.headers.get(PODCAST_OPML_OMITTED_HEADER) ?? 0)
    if (omitted > 0) toast.info(t('podcast.messages.opmlOmittedLocalShows', { count: omitted }))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.opmlExport'))
  }
}

async function savePlaybackSettings() {
  try {
    await settings.savePlayback()
    toast.success(t('podcast.settingsPage.playbackSaved'))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.settingsPage.playbackSaveFailed'))
  }
}

async function saveLibrarySettings() {
  try {
    await settings.saveLibrary()
    toast.success(t('podcast.messages.settingsSaved'))
  } catch (reason) {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.saveSettings'))
  }
}

onMounted(loadSettings)
</script>

<template>
  <SettingsPageHeader :title="t('podcast.settingsPage.title')" :subtitle="t('podcast.settingsPage.subtitle')" />

  <div v-if="settings.loading.value" class="text-sm text-muted-foreground" role="status" aria-live="polite">
    {{ t('podcast.settingsPage.loading') }}
  </div>
  <div v-else class="space-y-6">
    <form class="rounded-xl border border-border bg-card p-5" @submit.prevent="savePlaybackSettings">
      <h2 class="font-serif text-lg font-semibold">{{ t('podcast.settingsPage.playbackTitle') }}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('podcast.settingsPage.playbackDescription') }}</p>
      <div class="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label class="settings-label">
          {{ t('podcast.settingsPage.defaultPlaybackRate') }}
          <input
            v-model.number="settings.playback.value.defaultPlaybackRate"
            type="number"
            min="0.5"
            max="3"
            step="0.1"
            class="input-field mt-1 w-full"
          />
        </label>
        <label class="settings-label">
          <span class="flex items-center justify-between gap-3">
            <span>{{ t('podcast.settingsPage.defaultVolume') }}</span>
            <span class="settings-value">{{ volumePercent }}</span>
          </span>
          <input
            v-model.number="settings.playback.value.volume"
            type="range"
            min="0"
            max="1"
            step="0.01"
            class="mt-2 w-full cursor-pointer accent-primary"
          />
        </label>
        <label class="settings-label">
          {{ t('podcast.settingsPage.skipBackwardSeconds') }}
          <input v-model.number="settings.playback.value.skipBackwardSeconds" type="number" min="5" max="120" class="input-field mt-1 w-full" />
        </label>
        <label class="settings-label">
          {{ t('podcast.settingsPage.skipForwardSeconds') }}
          <input v-model.number="settings.playback.value.skipForwardSeconds" type="number" min="5" max="120" class="input-field mt-1 w-full" />
        </label>
      </div>
      <div class="mt-4 flex justify-end">
        <Button type="submit" :disabled="settings.savingPlayback.value">
          {{ settings.savingPlayback.value ? t('podcast.settingsPage.saving') : t('podcast.actions.save') }}
        </Button>
      </div>
    </form>

    <form class="rounded-xl border border-border bg-card p-5" @submit.prevent="saveLibrarySettings">
      <h2 class="font-serif text-lg font-semibold">{{ t('podcast.settingsPage.libraryTitle') }}</h2>
      <p class="mt-1 text-sm text-muted-foreground">{{ t('podcast.settingsPage.libraryDescription') }}</p>

      <div
        v-if="settings.podcastLibraries.value.length === 0"
        class="mt-4 rounded-lg border border-border bg-background p-4 text-sm text-muted-foreground"
      >
        {{ t('podcast.settingsPage.noLibraries') }}
      </div>
      <template v-else>
        <label class="settings-label mt-4 block">
          {{ t('podcast.settingsPage.library') }}
          <select :value="settings.selectedLibraryId.value ?? ''" class="select-field mt-1 w-full sm:max-w-md" @change="handleLibraryChange">
            <option v-for="library in settings.podcastLibraries.value" :key="library.id" :value="library.id">{{ library.name }}</option>
          </select>
        </label>

        <div v-if="settings.loadingLibrary.value" class="mt-4 text-sm text-muted-foreground" role="status" aria-live="polite">
          {{ t('podcast.settingsPage.loadingLibrary') }}
        </div>
        <div v-else-if="settings.librarySettings.value" class="mt-4">
          <p class="text-xs text-muted-foreground">
            {{ t('podcast.library.currentlyUsing', { size: formatBytes(settings.librarySettings.value.usedStorageBytes) }) }}
          </p>
          <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="settings-label">
              {{ t('podcast.library.libraryQuotaGb') }}
              <span class="relative mt-1 block">
                <input
                  v-model="settings.quotaGb.value"
                  type="number"
                  min="0"
                  step="0.1"
                  :disabled="!settings.canEditLibrary.value"
                  class="input-field w-full pe-11"
                />
                <span class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground" aria-hidden="true">
                  {{ t('podcast.settingsPage.gigabytesUnit') }}
                </span>
              </span>
            </label>
            <label class="settings-label">
              {{ t('podcast.library.freeSpaceReserveGb') }}
              <span class="relative mt-1 block">
                <input
                  v-model="settings.freeSpaceGb.value"
                  type="number"
                  min="0"
                  step="0.1"
                  :disabled="!settings.canEditLibrary.value"
                  class="input-field w-full pe-11"
                />
                <span class="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted-foreground" aria-hidden="true">
                  {{ t('podcast.settingsPage.gigabytesUnit') }}
                </span>
              </span>
            </label>
            <label class="settings-label">
              {{ t('podcast.library.defaultRefreshMinutes') }}
              <input
                v-model.number="settings.refreshMinutes.value"
                type="number"
                min="5"
                max="10080"
                :disabled="!settings.canEditLibrary.value"
                class="input-field mt-1 w-full"
              />
            </label>
            <label class="settings-label">
              {{ t('podcast.library.finishRemainingSeconds') }}
              <input
                v-model.number="settings.completionSeconds.value"
                type="number"
                min="0"
                max="3600"
                :disabled="!settings.canEditLibrary.value"
                class="input-field mt-1 w-full"
              />
            </label>
          </div>
          <p v-if="!settings.canEditLibrary.value" class="mt-3 text-xs text-muted-foreground">{{ t('podcast.settingsPage.readOnlyLibrary') }}</p>
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <Button v-if="settings.canExportLibrary.value" type="button" variant="outline" @click="exportOpml">
              {{ t('podcast.library.exportOpml') }}
            </Button>
            <Button v-if="settings.canEditLibrary.value" type="submit" :disabled="settings.savingLibrary.value">
              {{ settings.savingLibrary.value ? t('podcast.settingsPage.saving') : t('podcast.actions.save') }}
            </Button>
          </div>
        </div>
      </template>
    </form>

    <p class="text-sm text-muted-foreground">{{ t('podcast.settingsPage.showSettingsHint') }}</p>
  </div>
</template>
