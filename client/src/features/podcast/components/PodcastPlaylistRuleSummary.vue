<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpDown } from '@lucide/vue'
import type { PodcastPlaylistRules } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { PODCAST_EPISODE_FILTER_OPTIONS, PODCAST_EPISODE_SORT_OPTIONS } from '../lib/podcast-episode-filters'

/**
 * A playlist's saved rules stated in one line, so the page says what it is collecting without the
 * user opening the editor to find out. Reads the rules only; the editor is the one place that
 * changes them.
 */
const props = defineProps<{ rules: PodcastPlaylistRules }>()

const { t } = useI18n()

/** Duration bounds and windows are counts of a unit, which Intl pluralizes per locale for free. */
function unitValue(value: number, unit: 'minute' | 'day'): string {
  return formatNumber(value, { style: 'unit', unit, unitDisplay: 'long' })
}

function optionLabel(options: ReadonlyArray<{ id: string; labelKey: string }>, id: string): string {
  const match = options.find((option) => option.id === id)
  return match ? t(match.labelKey) : id
}

const chips = computed(() => {
  const rules = props.rules
  const list = [{ key: 'filter', label: t('podcast.playlists.filterLabel'), value: optionLabel(PODCAST_EPISODE_FILTER_OPTIONS, rules.filter) }]
  if (rules.minDurationMinutes) {
    list.push({ key: 'min', label: t('podcast.playlists.summaryShortest'), value: unitValue(rules.minDurationMinutes, 'minute') })
  }
  if (rules.maxDurationMinutes) {
    list.push({ key: 'max', label: t('podcast.playlists.summaryLongest'), value: unitValue(rules.maxDurationMinutes, 'minute') })
  }
  if (rules.publishedWithinDays) {
    list.push({ key: 'published', label: t('podcast.playlists.summaryPublishedWithin'), value: unitValue(rules.publishedWithinDays, 'day') })
  }
  if (rules.podcastIds.length > 0) {
    list.push({ key: 'shows', label: t('podcast.playlists.showsLabel'), value: formatNumber(rules.podcastIds.length) })
  }
  return list
})

const sortLabel = computed(() => optionLabel(PODCAST_EPISODE_SORT_OPTIONS, props.rules.sort))
</script>

<template>
  <span class="inline-flex flex-wrap items-center gap-1.5">
    <span v-for="chip in chips" :key="chip.key" class="inline-flex items-center overflow-hidden rounded-md border border-border/60 text-xs">
      <span class="border-e border-border/60 bg-muted px-2 py-0.5 font-semibold text-muted-foreground">{{ chip.label }}</span>
      <span class="bg-muted/40 px-2 py-0.5 font-medium text-foreground">{{ chip.value }}</span>
    </span>

    <span
      v-if="rules.followedOnly"
      class="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-xs font-medium text-foreground"
    >
      {{ t('podcast.library.followedOnly') }}
    </span>

    <span class="inline-flex items-center overflow-hidden rounded-md border border-border/60 text-xs">
      <span class="inline-flex items-center gap-1 border-e border-border/60 bg-muted px-2 py-0.5 font-semibold text-muted-foreground">
        <ArrowUpDown :size="10" class="shrink-0" aria-hidden="true" />
        {{ t('views.bookView.sort') }}
      </span>
      <span class="bg-muted/40 px-2 py-0.5 font-medium text-foreground">{{ sortLabel }}</span>
    </span>
  </span>
</template>
