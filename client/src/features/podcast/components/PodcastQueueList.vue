<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { GripVertical, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { VueDraggable } from 'vue-draggable-plus'
import type { PodcastEpisodeListItem, PodcastQueueItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { useDraggableOrder } from '@/composables/useDraggableOrder'
import { PODCAST_EPISODE_ACTIONS } from '../composables/usePodcastEpisodeListActions'
import PodcastEpisodeRow from './PodcastEpisodeRow.vue'
import { usePodcastQueue } from '../composables/usePodcastQueue'
import { formatPodcastDuration } from '../lib/podcast-format'

type QueueOrderItem = PodcastQueueItem & { displayOrder: number }

const props = withDefaults(
  defineProps<{
    items: PodcastQueueItem[]
    /** `full` renders episode rows for the library tab; `compact` renders the dense up-next list the players use. */
    density?: 'full' | 'compact'
    canDownload?: boolean
    reorderable?: boolean
    selectable?: boolean
    selectedIds?: ReadonlySet<number>
    activeEpisodeId?: number | null
    isPlaying?: boolean
    downloadProgress?: Map<number, { receivedBytes: number; totalBytes: number | null }>
    showPosition?: boolean
    nextPosition?: number | null
  }>(),
  {
    density: 'full',
    canDownload: false,
    reorderable: false,
    selectable: false,
    selectedIds: undefined,
    activeEpisodeId: null,
    isPlaying: false,
    downloadProgress: undefined,
    showPosition: false,
    nextPosition: null,
  },
)

const emit = defineEmits<{
  toggleSelect: [episodeId: number, selected: boolean]
}>()

const actions = inject(PODCAST_EPISODE_ACTIONS)
const { t } = useI18n()

function handlePlay(episode: PodcastEpisodeListItem) {
  void actions?.play(episode)
}

function handleRemove(episode: PodcastEpisodeListItem) {
  void actions?.unqueue(episode)
}
const podcastQueue = usePodcastQueue()

const orderSource = computed<QueueOrderItem[]>(() => props.items.map((item, index) => ({ ...item, displayOrder: item.queuePosition ?? index })))
const {
  localItems: orderedItems,
  liftedId,
  status: reorderStatus,
  onDragStart,
  onDragEnd,
  handleGripKeydown,
  handleGripBlur,
} = useDraggableOrder({
  source: orderSource,
  persist: persistOrder,
  onPersistError: (reason, order) => {
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.reorderQueue'), {
      action: { label: t('common.retry'), onClick: () => void persistOrder(order) },
    })
  },
})

const visibleItems = computed<QueueOrderItem[]>(() => (props.reorderable ? orderedItems.value : orderSource.value))
const dragDisabled = computed(() => !props.reorderable)
const reorderAnnouncement = computed(() => {
  const status = reorderStatus.value
  if (!status) return ''
  return t(`podcast.queueReorder.${status.kind}`, { title: status.item.title, position: status.position, total: status.total })
})

async function persistOrder(order: { id: number }[]) {
  await podcastQueue.reorder(order.map((item) => item.id))
}

function isActive(episode: PodcastEpisodeListItem) {
  return props.activeEpisodeId === episode.id
}

function handleSelectionChange(event: Event, episodeId: number) {
  emit('toggleSelect', episodeId, (event.currentTarget as HTMLInputElement).checked)
}

/** Local move plus a single persist, so the shortcut costs one request rather than one per position. */
async function moveToTop(episode: PodcastEpisodeListItem) {
  const index = orderedItems.value.findIndex((item) => item.id === episode.id)
  if (index <= 0) return
  const previous = [...orderedItems.value]
  const next = [...orderedItems.value]
  const [moved] = next.splice(index, 1)
  if (!moved) return
  next.unshift(moved)
  orderedItems.value = next
  try {
    await persistOrder(next)
  } catch (reason) {
    orderedItems.value = previous
    toast.error(reason instanceof Error ? reason.message : t('podcast.errors.reorderQueue'))
  }
}
</script>

<template>
  <div v-if="visibleItems.length > 0" :class="density === 'compact' ? 'space-y-0.5' : ''">
    <VueDraggable
      v-if="density === 'full'"
      v-model="orderedItems"
      handle=".podcast-queue-drag-handle"
      :disabled="dragDisabled"
      :delay="200"
      :delay-on-touch-only="true"
      @start="onDragStart"
      @end="onDragEnd"
    >
      <!-- The number is where the row sits right now, read off the render order. Writing it back onto
           each item is what a self-retriggering deep watch used to do, once per row per mutation. -->
      <div v-for="(episode, index) in visibleItems" :key="episode.id" class="flex items-center gap-2 pb-2.5">
        <span class="w-6 shrink-0 text-right text-xs tabular-nums text-muted-foreground" data-testid="podcast-queue-position" aria-hidden="true">
          {{ index + 1 }}
        </span>
        <div v-if="reorderable || selectable" class="flex shrink-0 flex-col items-center gap-1">
          <button
            v-if="reorderable"
            type="button"
            class="podcast-queue-drag-handle flex h-8 w-8 cursor-grab items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
            :class="liftedId === episode.id ? 'bg-primary/10 text-primary' : ''"
            :aria-label="t('podcast.actions.reorderEpisode', { title: episode.title })"
            :aria-pressed="liftedId === episode.id"
            @keydown="handleGripKeydown($event, episode.id)"
            @blur="handleGripBlur(episode.id)"
          >
            <GripVertical :size="15" />
          </button>
          <label v-if="selectable" class="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-muted">
            <span class="sr-only">{{ t('podcast.actions.selectEpisode', { title: episode.title }) }}</span>
            <input
              type="checkbox"
              class="h-4 w-4 accent-primary"
              :checked="selectedIds?.has(episode.id) ?? false"
              @change="handleSelectionChange($event, episode.id)"
            />
          </label>
        </div>
        <PodcastEpisodeRow
          class="min-w-0 flex-1"
          :episode="episode"
          :can-download="canDownload"
          :download-progress="downloadProgress?.get(episode.id)"
          :is-active="isActive(episode)"
          :is-playing="isPlaying && isActive(episode)"
          :queue-controls="reorderable"
          @move-top="moveToTop"
        />
      </div>
    </VueDraggable>

    <template v-else>
      <div
        v-for="episode in visibleItems"
        :key="episode.id"
        class="group flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted"
        :class="isActive(episode) ? 'bg-muted' : ''"
      >
        <span
          v-if="showPosition"
          class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium tabular-nums text-muted-foreground"
          aria-hidden="true"
        >
          {{ episode.queuePosition + 1 }}
        </span>
        <button
          type="button"
          class="min-w-0 flex-1 rounded-md px-1 py-1 text-left outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          @click="handlePlay(episode)"
        >
          <span
            v-if="nextPosition !== null && episode.queuePosition === nextPosition"
            class="mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.12em] text-primary"
          >
            {{ t('common.next') }}
          </span>
          <span class="line-clamp-2 text-[13px] font-medium leading-5">{{ episode.title }}</span>
          <span class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
            <span class="truncate">{{ episode.podcastTitle }}</span>
            <span v-if="episode.durationSeconds !== null" class="shrink-0 tabular-nums">
              {{ formatPodcastDuration(episode.durationSeconds) }}
            </span>
          </span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          :aria-label="t('podcast.fullPlayer.removeNamedFromQueue', { title: episode.title })"
          @click="handleRemove(episode)"
        >
          <Trash2 :size="15" />
        </Button>
      </div>
    </template>

    <p v-if="reorderable" class="sr-only" aria-live="polite">{{ reorderAnnouncement }}</p>
  </div>
</template>
