import { useI18n } from 'vue-i18n'
import { APP_FEATURES } from '@bookorbit/types'
import { formatNumber } from '@/i18n/formatters'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'
import { usePodcastImportProgress } from '@/features/podcast/composables/usePodcastImportProgress'

/** A run in progress on a library row: a book scan, or a podcast library's local-file import. */
export interface SidebarItemActivity {
  pct: number
  barWidth: string
  label: string
}

interface ActivityTarget {
  id: number
  type?: string
}

const INDETERMINATE_SCAN_WIDTH = '30%'

export function useSidebarLibraryActivity() {
  const { t } = useI18n()
  const { subscribeLibrary: subscribeScan, getProgress } = useScanProgress()
  const podcastImport = APP_FEATURES.podcasts ? usePodcastImportProgress() : null

  function scanActivity(libraryId: number): SidebarItemActivity | null {
    const progress = getProgress(libraryId)
    if (progress?.status !== 'running') return null
    const pct = progress.total > 0 ? Math.floor((progress.processed / progress.total) * 100) : 0
    return {
      pct,
      barWidth: progress.total > 0 ? `${pct}%` : INDETERMINATE_SCAN_WIDTH,
      label: t('components.sidebar.scanProgress', {
        processed: formatNumber(progress.processed),
        total: formatNumber(progress.total),
      }),
    }
  }

  function podcastImportActivity(libraryId: number): SidebarItemActivity | null {
    const state = podcastImport?.getImport(libraryId)
    if (!podcastImport || !state?.active) return null
    return {
      pct: podcastImport.importPct(libraryId),
      barWidth: podcastImport.importBarWidth(libraryId),
      label:
        state.total === null
          ? t('components.sidebar.podcastImportCounting')
          : t('components.sidebar.podcastImportProgress', { processed: formatNumber(state.processed), total: formatNumber(state.total) }),
    }
  }

  function activityFor(library: ActivityTarget): SidebarItemActivity | null {
    return library.type === 'podcasts' ? podcastImportActivity(library.id) : scanActivity(library.id)
  }

  /** Podcast libraries watch the same id on their own channel, so both subscriptions are needed. */
  function subscribe(library: ActivityTarget): void {
    subscribeScan(library.id)
    if (library.type === 'podcasts') podcastImport?.subscribeLibrary(library.id)
  }

  return { activityFor, subscribe }
}
