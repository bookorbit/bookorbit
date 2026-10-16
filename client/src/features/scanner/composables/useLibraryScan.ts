import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { Library } from '@bookorbit/types'
import { api } from '@/lib/api'
import { jsonBody } from '@/lib/api-json'
import { useScanProgress } from './useScanProgress'

/**
 * Starts a library scan the way the settings page always has, so the library page's own Scan
 * button and the admin list share one request, one toast and one progress subscription.
 */
export function useLibraryScan() {
  const { t } = useI18n()
  const { subscribeLibrary } = useScanProgress()

  function request(library: Pick<Library, 'id' | 'type'>): Promise<Response> {
    if (library.type === 'podcasts') {
      return api(`/api/v1/podcast-libraries/${library.id}/import-scan`, jsonBody('POST', { dryRun: false }))
    }
    return api(`/api/v1/scanner/libraries/${library.id}/scan`, { method: 'POST' })
  }

  async function scanLibrary(library: Pick<Library, 'id' | 'type' | 'name'>): Promise<boolean> {
    try {
      const res = await request(library)
      if (res.ok) {
        toast.success(t('settings.admin.libraries.scanStarted', { name: library.name }))
        if (library.type !== 'podcasts') subscribeLibrary(library.id)
        return true
      }
      toast.error(t('settings.admin.libraries.scanStartFailed', { name: library.name }))
    } catch {
      toast.error(t('settings.admin.libraries.scanStartFailed', { name: library.name }))
    }
    return false
  }

  return { scanLibrary, startScanRequest: request }
}
