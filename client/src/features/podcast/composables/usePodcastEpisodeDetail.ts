import { computed, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PodcastEpisodeSummary } from '@bookorbit/types'
import { apiJson } from '@/lib/api-json'
import { createRequestGeneration } from '@/lib/async'

/**
 * `GET /podcast-episodes/:id` for the surfaces that open on top of a list row: the quick view and
 * the metadata editor. Both need the full episode rather than the list projection, both re-read on
 * every open because a feed refresh or another editor may have moved the values since the row
 * rendered, and both render the same loading/error/retry surface around it.
 */
export function usePodcastEpisodeDetail(episodeId: Ref<number | null>, open: Ref<boolean>) {
  const { t } = useI18n()
  const detail = ref<PodcastEpisodeSummary | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const generation = createRequestGeneration()

  const loaded = computed(() => !loading.value && error.value === null && detail.value !== null)

  async function load(): Promise<void> {
    const requestedId = episodeId.value
    if (!requestedId) return
    const activeGeneration = generation.begin()
    loading.value = true
    error.value = null
    try {
      const episode = await apiJson<PodcastEpisodeSummary>(`/api/v1/podcast-episodes/${requestedId}`, undefined, 'podcast.errors.loadEpisode')
      if (!generation.isCurrent(activeGeneration)) return
      detail.value = episode
    } catch (reason) {
      if (!generation.isCurrent(activeGeneration)) return
      detail.value = null
      error.value = reason instanceof Error ? reason.message : t('podcast.errors.loadEpisode')
    } finally {
      if (generation.isCurrent(activeGeneration)) loading.value = false
    }
  }

  function reload(): void {
    void load()
  }

  watch(
    [open, episodeId] as const,
    ([isOpen, id], previous) => {
      if (!isOpen || !id) return
      // A different episode must not show the previous one's body while the new read is open.
      if (!previous || id !== previous[1]) detail.value = null
      void load()
    },
    { immediate: true },
  )

  return { detail, loading, error, loaded, reload }
}
