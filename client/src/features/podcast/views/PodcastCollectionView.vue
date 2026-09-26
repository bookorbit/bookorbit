<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { X } from '@lucide/vue'
import { toast } from 'vue-sonner'
import type { PodcastListItem } from '@bookorbit/types'
import EmptyState from '@/components/EmptyState.vue'
import EntityNotFound from '@/components/EntityNotFound.vue'
import AppIcon from '@/components/AppIcon.vue'
import { formatNumber } from '@/i18n/formatters'
import { useCollections } from '@/features/collection/composables/useCollections'
import { usePagedEntityMembers } from '@/composables/usePagedEntityMembers'
import { usePodcastPlayer } from '@/features/podcast/composables/usePodcastPlayer'
import PodcastShowCard from '@/features/podcast/components/PodcastShowCard.vue'

defineOptions({ name: 'PodcastCollectionView' })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const {
  collections,
  loaded: collectionsLoaded,
  error: collectionsError,
  fetchCollections,
  refreshCollections,
  fetchCollectionPodcasts,
  applyCollectionPodcastCount,
  removePodcastsFromCollection,
} = useCollections()
const player = usePodcastPlayer()

const collectionId = computed(() => Number(route.params.id))
const collection = computed(
  () => collections.value.find((candidate) => candidate.id === collectionId.value && candidate.mediaType === 'podcasts') ?? null,
)

const {
  items: shows,
  total,
  loading,
  notFound,
  error,
  appendError,
  sentinel,
  loadMore,
  removeItem,
} = usePagedEntityMembers<(typeof collections.value)[number], PodcastListItem>({
  entityId: collectionId,
  entity: collection,
  loaded: collectionsLoaded,
  listError: collectionsError,
  fetchEntities: fetchCollections,
  refreshEntities: refreshCollections,
  fetchPage: fetchCollectionPodcasts,
  applyTotal: applyCollectionPodcastCount,
  errorKeys: { load: 'views.podcastCollection.loadFailed', loadMore: 'views.podcastCollection.loadMoreFailed' },
})

function openShow(show: PodcastListItem): void {
  void router.push({ name: 'podcast-show', params: { podcastId: show.id } })
}

async function playShow(show: PodcastListItem): Promise<void> {
  const recommendation = show.playbackRecommendation
  if (recommendation) await player.playInline(recommendation.episodeId)
}

async function removeShow(show: PodcastListItem): Promise<void> {
  try {
    await removePodcastsFromCollection(collectionId.value, [show.id])
    removeItem((candidate) => candidate.id === show.id)
    toast.success(t('views.podcastCollection.removed', { name: show.title }))
  } catch {
    toast.error(t('views.podcastCollection.removeFailed'))
  }
}
</script>

<template>
  <div class="h-full">
    <EntityNotFound v-if="notFound" :entity="t('views.podcastCollection.entity')" />

    <div v-else class="flex h-full flex-col gap-3">
      <header class="flex min-w-0 items-center gap-2 px-2">
        <AppIcon :icon="collection?.icon || 'FolderOpen'" fallback="FolderOpen" :size="18" class="shrink-0 text-primary" />
        <h1 class="min-w-0 truncate text-lg font-semibold text-foreground">{{ collection?.name ?? t('views.podcastCollection.title') }}</h1>
        <span class="shrink-0 text-sm text-muted-foreground tabular-nums">{{ formatNumber(total) }}</span>
      </header>

      <p v-if="error" class="px-2 text-sm text-destructive" role="alert">{{ error }}</p>

      <EmptyState
        v-else-if="!loading && shows.length === 0"
        icon="FolderOpen"
        :title="t('views.podcastCollection.empty.title')"
        :hint="t('views.podcastCollection.empty.hint')"
      />

      <div v-else class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3 px-2">
        <div v-for="show in shows" :key="show.id" class="flex min-w-0 flex-col gap-1">
          <PodcastShowCard :show="show" @open="openShow" @play="playShow" />
          <button
            type="button"
            class="inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium text-muted-foreground outline-hidden transition-colors duration-150 hover:bg-(--shell-accent-wash) hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            :aria-label="t('views.podcastCollection.removeAria', { name: show.title })"
            @click="removeShow(show)"
          >
            <X :size="13" aria-hidden="true" />
            {{ t('views.podcastCollection.remove') }}
          </button>
        </div>

        <p v-if="appendError" class="col-span-full px-2 py-1 text-[13px] text-muted-foreground" role="alert">
          {{ appendError }}
          <button type="button" class="ml-1 font-medium text-primary underline underline-offset-2" @click="loadMore">
            {{ t('views.podcastCollection.retry') }}
          </button>
        </p>
      </div>

      <!-- Outside the branches above: the observer attaches once on mount, so the sentinel has to
         exist from the first render or paging never starts. It needs real height too, because a
         1px marker sits exactly on the scroll container's clipped edge and never reads as visible. -->
      <div ref="sentinel" class="h-8 w-full shrink-0" aria-hidden="true" />
    </div>
  </div>
</template>
