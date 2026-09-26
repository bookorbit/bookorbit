<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ListMusic, Plus, Radio, SlidersHorizontal, X } from '@lucide/vue'
import { DynamicScroller, DynamicScrollerItem } from 'vue-virtual-scroller'
import 'vue-virtual-scroller/dist/vue-virtual-scroller.css'
import type { PodcastEpisodeFilter, PodcastEpisodeListItem } from '@bookorbit/types'
import EmptyState from '@/components/EmptyState.vue'
import { Button } from '@/components/ui/button'
import PodcastEpisodeRow from './PodcastEpisodeRow.vue'

defineProps<{
  mode: 'episodes' | 'playlists'
  episodes: PodcastEpisodeListItem[]
  refreshing: boolean
  canDownload: boolean
  canManageFeeds: boolean
  hasSearchQuery: boolean
  hasFiltersApplied: boolean
  currentFilter: PodcastEpisodeFilter
  emptyTitle: string
  activeEpisodeId: number | null
  isPlaying: boolean
  downloadProgress: Map<number, { receivedBytes: number; totalBytes: number | null }>
  canEditMetadata: (episode: PodcastEpisodeListItem) => boolean
}>()

const emit = defineEmits<{
  'clear-search': []
  'edit-playlist': []
  'browse-episodes': []
  'reset-filters': []
  'browse-shows': []
  'add-feed': []
}>()

const { t } = useI18n()

function clearSearch() {
  emit('clear-search')
}

function editPlaylist() {
  emit('edit-playlist')
}

function browseEpisodes() {
  emit('browse-episodes')
}

function resetFilters() {
  emit('reset-filters')
}

function browseShows() {
  emit('browse-shows')
}

function addFeed() {
  emit('add-feed')
}
</script>

<template>
  <section class="pt-4" :aria-busy="refreshing">
    <DynamicScroller v-if="episodes.length > 0" page-mode :items="episodes" :min-item-size="92" key-field="id">
      <template #default="{ item: episode, index, active }">
        <DynamicScrollerItem :item="episode" :active="active" :data-index="index" class="pb-2.5">
          <PodcastEpisodeRow
            :episode="episode"
            :can-download="canDownload"
            :can-edit-metadata="canEditMetadata(episode)"
            :download-progress="downloadProgress.get(episode.id)"
            :is-active="activeEpisodeId === episode.id"
            :is-playing="isPlaying && activeEpisodeId === episode.id"
          />
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>
    <EmptyState
      v-else-if="mode === 'playlists'"
      icon="ListFilter"
      :title="hasSearchQuery ? t('podcast.library.noMatchingEpisodes') : t('podcast.playlists.empty')"
      :hint="hasSearchQuery ? t('podcast.library.tryDifferentSearch') : t('podcast.playlists.emptyDescription')"
    >
      <template #actions>
        <Button v-if="hasSearchQuery" variant="outline" @click="clearSearch"> <X :size="14" /> {{ t('podcast.library.clearSearch') }} </Button>
        <Button @click="editPlaylist">
          <SlidersHorizontal :size="14" />
          {{ t('podcast.playlists.adjustRules') }}
        </Button>
        <Button variant="outline" @click="browseEpisodes"> <ListMusic :size="14" /> {{ t('podcast.library.browseEpisodes') }} </Button>
      </template>
    </EmptyState>

    <EmptyState
      v-else
      icon="ListMusic"
      :title="hasSearchQuery ? t('podcast.library.noMatchingEpisodes') : emptyTitle"
      :hint="
        hasSearchQuery
          ? t('podcast.library.tryDifferentSearch')
          : currentFilter === 'pinned'
            ? t('podcast.labels.pinnedHint')
            : t('podcast.library.noEpisodesDescription')
      "
    >
      <template #actions>
        <Button v-if="hasSearchQuery" variant="outline" @click="clearSearch"> <X :size="14" /> {{ t('podcast.library.clearSearch') }} </Button>
        <Button v-if="hasFiltersApplied" variant="outline" @click="resetFilters">
          <ListMusic :size="14" /> {{ t('podcast.library.showAllEpisodes') }}
        </Button>
        <Button v-if="!hasSearchQuery && !hasFiltersApplied" variant="outline" @click="browseShows">
          <Radio :size="14" /> {{ t('podcast.library.browseShows') }}
        </Button>
        <Button v-if="!hasSearchQuery && !hasFiltersApplied && canManageFeeds" @click="addFeed">
          <Plus :size="14" /> {{ t('podcast.library.addFeed') }}
        </Button>
      </template>
    </EmptyState>
  </section>
</template>
