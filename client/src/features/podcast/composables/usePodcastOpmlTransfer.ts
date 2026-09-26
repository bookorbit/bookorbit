import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { PodcastAcquisitionPolicy, PodcastOpmlImportResult } from '@bookorbit/types'
import { PODCAST_OPML_OMITTED_HEADER } from '@bookorbit/types'
import { api } from '@/lib/api'
import { apiError, apiJson, jsonBody } from '@/lib/api-json'

const MAX_OPML_BYTES = 5_000_000

export function usePodcastOpmlTransfer(libraryId: Ref<number>) {
  const { t } = useI18n()
  const importFile = ref<File | null>(null)
  const importPolicy = ref<PodcastAcquisitionPolicy>('remote_only')
  const importLimit = ref(3)
  const importWindowDays = ref(30)
  const importing = ref(false)
  const exporting = ref(false)

  function resetImport() {
    importFile.value = null
    importPolicy.value = 'remote_only'
    importLimit.value = 3
    importWindowDays.value = 30
  }

  function selectImportFile(file: File | undefined): boolean {
    if (!file) return false
    if (file.size > MAX_OPML_BYTES) {
      toast.error(t('podcast.errors.opmlTooLarge'))
      return false
    }
    importFile.value = file
    return true
  }

  async function importOpml(): Promise<PodcastOpmlImportResult | null> {
    const file = importFile.value
    if (!file || importing.value) return null
    if (importPolicy.value === 'newest' && (!Number.isInteger(importLimit.value) || importLimit.value < 1)) {
      toast.error(t('podcast.errors.invalidEpisodeLimit'))
      return null
    }
    if (importPolicy.value === 'window' && (!Number.isInteger(importWindowDays.value) || importWindowDays.value < 1)) {
      toast.error(t('podcast.errors.invalidEpisodeWindow'))
      return null
    }
    importing.value = true
    try {
      const payload: Record<string, unknown> = { opml: await file.text(), acquisitionPolicy: importPolicy.value }
      if (importPolicy.value === 'newest') payload.autoDownloadLimit = importLimit.value
      if (importPolicy.value === 'window') payload.autoDownloadWindowDays = importWindowDays.value
      const result = await apiJson<PodcastOpmlImportResult>(
        `/api/v1/podcast-libraries/${libraryId.value}/opml/import`,
        jsonBody('POST', payload),
        'podcast.errors.opmlImport',
      )
      toast.success(t('podcast.messages.feedsQueued', { count: result.queued }))
      return result
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.errors.opmlImport'))
      return null
    } finally {
      importing.value = false
    }
  }

  async function exportOpml() {
    if (exporting.value) return
    exporting.value = true
    try {
      const response = await api(`/api/v1/podcast-libraries/${libraryId.value}/opml/export`)
      if (!response.ok) throw await apiError(response, 'podcast.errors.opmlExport')
      const url = URL.createObjectURL(await response.blob())
      try {
        const link = document.createElement('a')
        link.href = url
        link.download = 'podcasts.opml'
        link.click()
      } finally {
        URL.revokeObjectURL(url)
      }
      const omitted = Number(response.headers.get(PODCAST_OPML_OMITTED_HEADER) ?? 0)
      if (omitted > 0) toast.info(t('podcast.messages.opmlOmittedLocalShows', { count: omitted }))
    } catch (reason) {
      toast.error(reason instanceof Error ? reason.message : t('podcast.errors.opmlExport'))
    } finally {
      exporting.value = false
    }
  }

  return { importFile, importPolicy, importLimit, importWindowDays, importing, exporting, resetImport, selectImportFile, importOpml, exportOpml }
}
