<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, CheckCheck, Download, ListMusic, ListX, Radio, Trash2, X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { PodcastEpisodeListItem, PodcastQueueItem } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import EmptyState from '@/components/EmptyState.vue'
import SelectionActionBar from '@/components/SelectionActionBar.vue'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import PodcastQueueList from './PodcastQueueList.vue'
import { runBoundedBatch, type PodcastBulkOutcome } from '../lib/podcast-bulk'
import { formatPodcastDuration } from '../lib/podcast-format'
import {
  applyDownloadQueuedFields,
  applyDownloadRemovedFields,
  applyFinishedFields,
  removeEpisodeDownload,
  requestEpisodeDownload,
  updateEpisodeState,
} from '../lib/podcast-episode-api'

const BULK_QUEUE_CONCURRENCY = 4

const props = defineProps<{
  items: PodcastQueueItem[]
  total: number
  durationSeconds: number
  refreshing: boolean
  hasSearchQuery: boolean
  canDownload: boolean
  selectionMode: boolean
  activeEpisodeId: number | null
  isPlaying: boolean
  downloadProgress: Map<number, { receivedBytes: number; totalBytes: number | null }>
  /** Owned by the caller because removing from the queue also moves its lane's totals. */
  removeFromQueue: (episode: PodcastEpisodeListItem) => Promise<void>
  reload: () => Promise<void>
}>()

const emit = defineEmits<{
  'update:selection-mode': [selectionMode: boolean]
  'clear-search': []
  'browse-episodes': []
  'browse-shows': []
}>()

const { t } = useI18n()
const selectedIds = ref<Set<number>>(new Set())
const bulkPending = ref(false)
const bulkOutcome = ref<PodcastBulkOutcome | null>(null)
/** Selected rows still in the lane: finishing an episode dequeues it, so an id can outlive its row. */
const selectedItems = computed(() => props.items.filter((item) => selectedIds.value.has(item.id)))

watch(
  () => props.selectionMode,
  (selectionMode) => {
    if (selectionMode) return
    selectedIds.value = new Set()
    bulkOutcome.value = null
  },
)

function setSelection(episodeId: number, selected: boolean) {
  const next = new Set(selectedIds.value)
  if (selected) next.add(episodeId)
  else next.delete(episodeId)
  selectedIds.value = next
}

function selectAllLoaded() {
  selectedIds.value = new Set(props.items.map((item) => item.id))
}

function exitSelectionMode() {
  emit('update:selection-mode', false)
}

function reportOutcome(outcome: PodcastBulkOutcome) {
  if (outcome.failed > 0) {
    toast.error(t('podcast.messages.bulkQueueActionFailed', { completed: formatNumber(outcome.completed), failed: formatNumber(outcome.failed) }))
    return
  }
  toast.success(t('podcast.messages.bulkQueueActionCompleted', { count: formatNumber(outcome.completed) }))
}

async function runBulkAction(action: (episode: PodcastEpisodeListItem) => Promise<boolean>) {
  bulkPending.value = true
  bulkOutcome.value = null
  try {
    const outcome = await runBoundedBatch(selectedItems.value, BULK_QUEUE_CONCURRENCY, action)
    bulkOutcome.value = outcome
    reportOutcome(outcome)
  } finally {
    bulkPending.value = false
  }
}

async function downloadSelected() {
  await runBulkAction(async (episode) => {
    if (episode.mediaStatus === 'local' || episode.mediaStatus === 'queued' || episode.mediaStatus === 'downloading') return false
    await requestEpisodeDownload(episode.id)
    applyDownloadQueuedFields(episode)
    return true
  })
}

async function removeSelectedDownloads() {
  await runBulkAction(async (episode) => {
    if (episode.mediaStatus !== 'local' || episode.origin === 'local') return false
    await removeEpisodeDownload(episode.id)
    applyDownloadRemovedFields(episode)
    return true
  })
}

async function markSelectedPlayed() {
  await runBulkAction(async (episode) => {
    if (episode.finished) return false
    await updateEpisodeState(episode.id, { finished: true })
    applyFinishedFields(episode, true)
    return true
  })
}

async function removeSelectedFromQueue() {
  await runBulkAction(async (episode) => {
    await props.removeFromQueue(episode)
    return true
  })
  selectedIds.value = new Set()
  await props.reload()
}

function clearSearch() {
  emit('clear-search')
}

function browseEpisodes() {
  emit('browse-episodes')
}

function browseShows() {
  emit('browse-shows')
}
</script>

<template>
  <section class="pt-4" :aria-busy="refreshing">
    <p v-if="items.length > 0" class="mb-3 text-xs tabular-nums text-muted-foreground">
      {{ t('podcast.labels.episodeCount', { count: formatNumber(total) }) }}
      <span aria-hidden="true"> · </span>
      {{ t('podcast.library.queueDuration', { duration: formatPodcastDuration(durationSeconds) }) }}
    </p>
    <p
      v-if="bulkOutcome"
      class="mb-3 text-xs"
      :class="bulkOutcome.failed > 0 ? 'text-destructive' : 'text-muted-foreground'"
      data-testid="podcast-bulk-outcome"
    >
      {{
        bulkOutcome.failed > 0
          ? t('podcast.messages.bulkQueueActionFailed', {
              completed: formatNumber(bulkOutcome.completed),
              failed: formatNumber(bulkOutcome.failed),
            })
          : t('podcast.messages.bulkQueueActionCompleted', { count: formatNumber(bulkOutcome.completed) })
      }}
    </p>
    <p v-if="total > items.length" class="mb-3 text-xs text-muted-foreground">
      {{ t('podcast.library.reorderLoadedHint') }}
    </p>
    <PodcastQueueList
      :items="items"
      :can-download="canDownload"
      reorderable
      :selectable="selectionMode"
      :selected-ids="selectedIds"
      :active-episode-id="activeEpisodeId"
      :is-playing="isPlaying"
      :download-progress="downloadProgress"
      @toggle-select="setSelection"
    />
    <EmptyState
      v-if="items.length === 0"
      icon="ListMusic"
      :title="hasSearchQuery ? t('podcast.library.noMatchingQueueEpisodes') : t('podcast.library.emptyQueue')"
      :hint="hasSearchQuery ? t('podcast.library.tryDifferentSearch') : t('podcast.library.emptyQueueDescription')"
    >
      <template #actions>
        <Button v-if="hasSearchQuery" variant="outline" @click="clearSearch"> <X :size="14" /> {{ t('podcast.library.clearSearch') }} </Button>
        <template v-else>
          <Button @click="browseEpisodes"> <ListMusic :size="14" /> {{ t('podcast.library.browseEpisodes') }} </Button>
          <Button variant="outline" @click="browseShows"> <Radio :size="14" /> {{ t('podcast.library.browseShows') }} </Button>
        </template>
      </template>
    </EmptyState>

    <SelectionActionBar :visible="selectionMode && items.length > 0" :count="selectedItems.length" @exit="exitSelectionMode">
      <template #content>
        <span class="whitespace-nowrap rounded-full bg-primary/10 px-2.5 py-0.5 text-sm font-semibold tabular-nums text-primary">
          {{ formatNumber(selectedItems.length) }}
        </span>
        <div class="mx-1 h-5 w-px shrink-0 bg-border" />
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full text-foreground transition-colors hover:bg-primary hover:text-primary-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              :aria-label="t('podcast.library.selectAllLoaded')"
              @click="selectAllLoaded"
            >
              <CheckCheck :size="17" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{{ t('podcast.library.selectAllLoaded') }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="canDownload">
          <TooltipTrigger as-child>
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              :class="
                selectedIds.size > 0 && !bulkPending
                  ? 'text-foreground hover:bg-primary hover:text-primary-foreground'
                  : 'cursor-not-allowed text-muted-foreground'
              "
              :disabled="selectedIds.size === 0 || bulkPending"
              :aria-label="t('podcast.actions.downloadSelected')"
              data-testid="podcast-bulk-download"
              @click="downloadSelected"
            >
              <Download :size="17" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{{ t('podcast.actions.downloadSelected') }}</TooltipContent>
        </Tooltip>
        <Tooltip v-if="canDownload">
          <TooltipTrigger as-child>
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              :class="
                selectedIds.size > 0 && !bulkPending
                  ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
                  : 'cursor-not-allowed text-muted-foreground'
              "
              :disabled="selectedIds.size === 0 || bulkPending"
              :aria-label="t('podcast.actions.removeSelectedDownloads')"
              data-testid="podcast-bulk-remove-downloads"
              @click="removeSelectedDownloads"
            >
              <Trash2 :size="17" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{{ t('podcast.actions.removeSelectedDownloads') }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              :class="
                selectedIds.size > 0 && !bulkPending
                  ? 'text-foreground hover:bg-primary hover:text-primary-foreground'
                  : 'cursor-not-allowed text-muted-foreground'
              "
              :disabled="selectedIds.size === 0 || bulkPending"
              :aria-label="t('podcast.actions.markSelectedPlayed')"
              data-testid="podcast-bulk-mark-played"
              @click="markSelectedPlayed"
            >
              <Check :size="17" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{{ t('podcast.actions.markSelectedPlayed') }}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              :class="
                selectedIds.size > 0 && !bulkPending
                  ? 'text-destructive hover:bg-destructive hover:text-destructive-foreground'
                  : 'cursor-not-allowed text-muted-foreground'
              "
              :disabled="selectedIds.size === 0 || bulkPending"
              :aria-label="t('podcast.actions.removeSelectedFromQueue')"
              data-testid="podcast-bulk-remove-from-queue"
              @click="removeSelectedFromQueue"
            >
              <ListX :size="17" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{{ t('podcast.actions.removeSelectedFromQueue') }}</TooltipContent>
        </Tooltip>
        <div class="mx-1 h-5 w-px shrink-0 bg-border" />
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              class="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
              :aria-label="t('components.selectionActionBar.exitSelection')"
              @click="exitSelectionMode"
            >
              <X :size="17" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{{ t('components.selectionActionBar.exitSelection') }}</TooltipContent>
        </Tooltip>
      </template>
    </SelectionActionBar>
  </section>
</template>
