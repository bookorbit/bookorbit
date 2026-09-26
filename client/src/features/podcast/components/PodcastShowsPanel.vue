<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Plus, Upload, X } from '@lucide/vue'
import type { CSSProperties } from 'vue'
import type { PodcastListItem } from '@bookorbit/types'
import EmptyState from '@/components/EmptyState.vue'
import { Button } from '@/components/ui/button'
import PodcastShowCard from './PodcastShowCard.vue'

defineProps<{
  shows: PodcastListItem[]
  gridStyle: CSSProperties
  refreshing: boolean
  importing: boolean
  hasSearchQuery: boolean
  canManageFeeds: boolean
  selecting?: boolean
  selectedIds?: ReadonlySet<number>
}>()

const emit = defineEmits<{
  open: [show: PodcastListItem]
  play: [show: PodcastListItem]
  follow: [show: PodcastListItem]
  unfollow: [show: PodcastListItem]
  'toggle-select': [show: PodcastListItem]
  'clear-search': []
  'add-feed': []
  'import-opml': []
}>()

const { t } = useI18n()

function clearSearch() {
  emit('clear-search')
}

function addFeed() {
  emit('add-feed')
}

function importOpml() {
  emit('import-opml')
}

function openShow(show: PodcastListItem) {
  emit('open', show)
}

function playShow(show: PodcastListItem) {
  emit('play', show)
}

function followShow(show: PodcastListItem) {
  emit('follow', show)
}

function unfollowShow(show: PodcastListItem) {
  emit('unfollow', show)
}

function toggleSelect(show: PodcastListItem) {
  emit('toggle-select', show)
}
</script>

<template>
  <section class="pt-4" :aria-busy="refreshing">
    <div v-if="shows.length > 0" class="grid" :style="gridStyle">
      <PodcastShowCard
        v-for="show in shows"
        :key="show.id"
        :show="show"
        :selectable="selecting"
        :selected="selectedIds?.has(show.id) ?? false"
        @open="openShow"
        @play="playShow"
        @follow="followShow"
        @unfollow="unfollowShow"
        @toggle-select="toggleSelect"
      />
    </div>

    <EmptyState
      v-else-if="importing && !hasSearchQuery"
      icon="Radio"
      :title="t('podcast.library.importingTitle')"
      :hint="t('podcast.library.importingHint')"
    />

    <EmptyState
      v-else
      icon="Radio"
      :title="hasSearchQuery ? t('podcast.library.noMatchingShows') : t('podcast.library.ready')"
      :hint="hasSearchQuery ? t('podcast.library.tryDifferentSearch') : t('podcast.library.readyDescription')"
    >
      <template #actions>
        <Button v-if="hasSearchQuery" variant="outline" @click="clearSearch"> <X :size="14" /> {{ t('podcast.library.clearSearch') }} </Button>
        <template v-if="!hasSearchQuery && canManageFeeds">
          <Button @click="addFeed"> <Plus :size="14" /> {{ t('podcast.library.addFeed') }} </Button>
          <Button variant="outline" @click="importOpml"> <Upload :size="14" /> {{ t('podcast.library.importOpml') }} </Button>
        </template>
      </template>
    </EmptyState>
  </section>
</template>
