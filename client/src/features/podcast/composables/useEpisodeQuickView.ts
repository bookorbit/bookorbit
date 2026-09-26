import { ref } from 'vue'
import type { PodcastEpisodeListItem } from '@bookorbit/types'

/**
 * The quick-view sheet and the metadata editor are opened from a row in three different views, and
 * each was wiring the same pair of "which episode" plus "is it open" refs by hand.
 */
export function useEpisodeQuickView() {
  const quickViewEpisode = ref<PodcastEpisodeListItem | null>(null)
  const quickViewOpen = ref(false)
  const editEpisodeId = ref<number | null>(null)
  const editEpisodeOpen = ref(false)

  function openDetails(episode: PodcastEpisodeListItem): void {
    quickViewEpisode.value = episode
    quickViewOpen.value = true
  }

  function setQuickViewOpen(open: boolean): void {
    quickViewOpen.value = open
  }

  function openMetadataEditor(episode: PodcastEpisodeListItem): void {
    editEpisodeId.value = episode.id
    editEpisodeOpen.value = true
  }

  function setEditOpen(open: boolean): void {
    editEpisodeOpen.value = open
  }

  return { quickViewEpisode, quickViewOpen, editEpisodeId, editEpisodeOpen, openDetails, setQuickViewOpen, openMetadataEditor, setEditOpen }
}
