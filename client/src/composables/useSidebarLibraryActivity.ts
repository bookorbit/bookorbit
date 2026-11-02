import { useI18n } from 'vue-i18n'
import { formatNumber } from '@/i18n/formatters'
import { useScanProgress } from '@/features/scanner/composables/useScanProgress'

/** A book scan in progress on a library row. */
export interface SidebarItemActivity {
  pct: number
  barWidth: string
  label: string
}

interface ActivityTarget {
  id: number
}

const INDETERMINATE_SCAN_WIDTH = '30%'

export function useSidebarLibraryActivity() {
  const { t } = useI18n()
  const { subscribeLibrary: subscribeScan, getProgress } = useScanProgress()

  function activityFor(library: ActivityTarget): SidebarItemActivity | null {
    const progress = getProgress(library.id)
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

  function subscribe(library: ActivityTarget): void {
    subscribeScan(library.id)
  }

  return { activityFor, subscribe }
}
