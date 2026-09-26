import { computed, onScopeDispose, ref, watch, type Ref } from 'vue'
import type { PodcastEpisodePage, PodcastPlaylistRules } from '@bookorbit/types'
import { apiJson } from '@/lib/api-json'
import { createRequestGeneration } from '@/lib/async'
import { appendPlaylistRuleParams } from '../lib/podcast-playlist-rules'

const PREVIEW_DEBOUNCE_MS = 400

export interface PodcastPlaylistPreviewOptions {
  libraryId: Ref<number>
  rules: Ref<PodcastPlaylistRules>
  /** Counting stops and resets while the editor is closed, so a shut sheet costs nothing. */
  active: Ref<boolean>
}

/**
 * How many episodes the rules being drafted match, and how long they run.
 *
 * Counting is the expensive half of the episode query once a library holds tens of thousands of
 * episodes, so it is debounced and keyed on the rules that actually narrow the match: changing the
 * playlist's order re-sorts the same set, and must not spend a second count to learn that.
 */
export function usePodcastPlaylistPreview(options: PodcastPlaylistPreviewOptions) {
  const count = ref<number | null>(null)
  const durationSeconds = ref(0)
  const loading = ref(false)
  const failed = ref(false)

  const generation = createRequestGeneration()
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  const matchKey = computed(() => {
    const rules = options.rules.value
    return JSON.stringify([
      options.libraryId.value,
      rules.filter,
      rules.minDurationMinutes,
      rules.maxDurationMinutes,
      rules.publishedWithinDays,
      rules.followedOnly,
      rules.podcastIds,
    ])
  })

  onScopeDispose(cancel)

  function cancel(): void {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = null
    generation.invalidate()
  }

  function reset(): void {
    count.value = null
    durationSeconds.value = 0
    loading.value = false
    failed.value = false
  }

  /** One row is enough: the endpoint returns the full match total and duration whatever the page size. */
  async function fetchPreview(): Promise<void> {
    const token = generation.begin()
    const params = new URLSearchParams({ page: '0', size: '1' })
    appendPlaylistRuleParams(params, options.rules.value)
    try {
      const page = await apiJson<PodcastEpisodePage>(
        `/api/v1/podcast-libraries/${options.libraryId.value}/episodes?${params.toString()}`,
        undefined,
        'podcast.errors.loadEpisodes',
      )
      if (!generation.isCurrent(token)) return
      count.value = page.total
      durationSeconds.value = page.totalDurationSeconds
      failed.value = false
    } catch {
      if (!generation.isCurrent(token)) return
      count.value = null
      durationSeconds.value = 0
      failed.value = true
    } finally {
      if (generation.isCurrent(token)) loading.value = false
    }
  }

  watch(
    [options.active, matchKey],
    ([isActive]) => {
      cancel()
      if (!isActive) {
        reset()
        return
      }
      // Set before the debounce rather than inside it, so an edit marks the shown count stale
      // immediately instead of leaving the previous rules' answer looking current.
      loading.value = true
      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void fetchPreview()
      }, PREVIEW_DEBOUNCE_MS)
    },
    { immediate: true },
  )

  return { count, durationSeconds, loading, failed }
}
