<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { PODCAST_DIRECTORY_SEARCH_MAX_QUERY, type PodcastDirectoryResult } from '@bookorbit/types'
import { FolderSearch, Upload } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import FormSheet from '@/components/FormSheet.vue'
import PodcastAcquisitionField from './PodcastAcquisitionField.vue'
import PodcastArtwork from './PodcastArtwork.vue'
import { usePodcastFeedAdd } from '../composables/usePodcastFeedAdd'

const props = defineProps<{ open: boolean; libraryId: number }>()
const emit = defineEmits<{
  'update:open': [open: boolean]
  added: []
  'open-show': [podcastId: number]
  'import-opml': []
  'import-local': []
}>()

const { t } = useI18n()
const addFeed = usePodcastFeedAdd(toRef(props, 'libraryId'))
const {
  feedUrl,
  preview,
  previewError,
  previewing,
  previewedFeedUrl,
  previewMetadata,
  directoryQuery,
  directoryResults,
  directorySearching,
  directoryError,
  directorySearched,
  acquisitionPolicy,
  autoDownloadLimit,
  autoDownloadWindowDays,
  saving,
} = addFeed

const canAdd = computed(() => Boolean(preview.value && previewedFeedUrl.value === feedUrl.value.trim()))
const submitLabel = computed(() => (saving.value ? t('podcast.library.addingPodcast') : t('podcast.library.addPodcast')))
const directoryEmpty = computed(() => directorySearched.value && !directoryError.value && !directorySearching.value)

function handleOpened() {
  addFeed.reset()
}

function handleOpenUpdate(open: boolean) {
  emit('update:open', open)
}

function close() {
  emit('update:open', false)
}

function previewFeed() {
  void addFeed.previewFeed()
}

function selectDirectoryResult(result: PodcastDirectoryResult) {
  const existingPodcastId = addFeed.selectDirectoryResult(result)
  if (existingPodcastId === null) return
  close()
  emit('open-show', existingPodcastId)
}

async function handleAdd() {
  if (!(await addFeed.addFeed())) return
  close()
  emit('added')
}

function startOpmlImport() {
  close()
  emit('import-opml')
}

function startLocalImport() {
  close()
  emit('import-local')
}
</script>

<template>
  <FormSheet
    :open="open"
    :title="t('podcast.library.addPodcastFeed')"
    :description="t('podcast.library.addFeedDescription')"
    content-class="sm:max-w-lg"
    :busy="saving"
    :submit-label="submitLabel"
    :submit-disabled="!canAdd"
    @update:open="handleOpenUpdate"
    @opened="handleOpened"
    @submit="handleAdd"
  >
    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <div class="mb-5 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" class="gap-1.5" data-testid="podcast-open-opml-import" @click="startOpmlImport">
          <Upload :size="14" /> {{ t('podcast.library.importOpml') }}
        </Button>
        <Button variant="outline" size="sm" class="gap-1.5" data-testid="podcast-open-local-import" @click="startLocalImport">
          <FolderSearch :size="14" /> {{ t('podcast.import.title') }}
        </Button>
      </div>

      <label for="podcast-directory-search" class="block text-xs font-medium">{{ t('podcast.library.searchDirectory') }}</label>
      <Input
        id="podcast-directory-search"
        v-model="directoryQuery"
        type="search"
        class="mt-2"
        :maxlength="PODCAST_DIRECTORY_SEARCH_MAX_QUERY"
        :placeholder="t('podcast.library.searchDirectoryPlaceholder')"
        :aria-busy="directorySearching"
      />
      <p class="mt-2 text-xs text-muted-foreground">{{ t('podcast.library.searchDirectoryHint') }}</p>
      <p v-if="directoryError" class="mt-2 text-sm text-destructive" role="alert">{{ directoryError }}</p>
      <ul v-if="directoryResults.length" class="mt-3 space-y-1">
        <li v-for="result in directoryResults" :key="result.feedUrl">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-accent focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
            :aria-label="addFeed.directoryResultLabel(result)"
            @click="selectDirectoryResult(result)"
          >
            <PodcastArtwork :src="result.artworkUrl" :reset-key="result.feedUrl" class="h-10 w-10 shrink-0 rounded" icon-class="size-4" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ result.title }}</span>
              <span class="block truncate text-xs text-muted-foreground">{{ result.author || t('podcast.labels.unknownPublisher') }}</span>
            </span>
            <span
              v-if="result.existingPodcastId !== null"
              class="shrink-0 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
              data-testid="podcast-directory-in-library"
            >
              {{ t('podcast.library.inLibrary') }}
            </span>
          </button>
        </li>
      </ul>
      <p v-else-if="directoryEmpty" class="mt-3 text-sm text-muted-foreground">{{ t('podcast.library.searchDirectoryEmpty') }}</p>

      <label for="podcast-rss-url" class="mt-5 block text-xs font-medium">{{ t('podcast.library.pasteFeedUrl') }}</label>
      <div class="mt-2 flex gap-2">
        <Input id="podcast-rss-url" v-model="feedUrl" type="url" class="flex-1" placeholder="https://example.com/feed.xml" />
        <Button variant="outline" :disabled="previewing || !feedUrl.trim()" :aria-busy="previewing" @click="previewFeed">
          {{ previewing ? t('podcast.library.previewing') : t('podcast.library.preview') }}
        </Button>
      </div>
      <p v-if="previewError" class="mt-2 text-sm text-destructive" role="alert">{{ previewError }}</p>
      <div v-if="preview" class="mt-4 rounded-lg border border-border p-3">
        <div class="flex items-start gap-3">
          <PodcastArtwork :src="preview.imageUrl" :reset-key="previewedFeedUrl" class="h-16 w-16 shrink-0 rounded-lg" icon-class="size-5" />
          <div class="min-w-0">
            <p class="font-medium">{{ preview.title }}</p>
            <p class="text-xs text-muted-foreground">
              {{ preview.author || t('podcast.labels.unknownPublisher') }} ·
              {{ t('podcast.labels.episodeCount', { count: preview.episodeCount }) }}
            </p>
            <p v-if="previewMetadata" class="mt-1 text-xs text-muted-foreground">{{ previewMetadata }}</p>
          </div>
        </div>
      </div>
      <PodcastAcquisitionField
        v-model:policy="acquisitionPolicy"
        v-model:limit="autoDownloadLimit"
        v-model:window-days="autoDownloadWindowDays"
        class="mt-4"
      />
    </div>
  </FormSheet>
</template>
