<script setup lang="ts">
import { computed } from 'vue'
import type { PodcastEpisodeListItem } from '@bookorbit/types'
import { episodeMediaStatusKind } from '../lib/podcast-episode-presentation'
import PodcastStatusChip from './PodcastStatusChip.vue'

/** The five-chip strip an episode shows wherever it is rendered: the row, the quick view, and any future surface. */
const props = withDefaults(
  defineProps<{
    episode: PodcastEpisodeListItem
    isActive?: boolean
    isPlaying?: boolean
  }>(),
  { isActive: false, isPlaying: false },
)

const mediaStatusKind = computed(() => episodeMediaStatusKind(props.episode))
</script>

<template>
  <PodcastStatusChip v-if="isActive" :kind="isPlaying ? 'nowPlaying' : 'paused'" />
  <PodcastStatusChip v-if="mediaStatusKind" :kind="mediaStatusKind" />
  <PodcastStatusChip v-if="episode.finished" kind="played" />
  <PodcastStatusChip v-if="!episode.inFeed" kind="removedFromFeed" />
  <PodcastStatusChip v-if="episode.queued" kind="inQueue" />
</template>
