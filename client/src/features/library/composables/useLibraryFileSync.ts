import { ref } from 'vue'
import { api } from '@/lib/api'
import type { LibraryFileSyncProgressEvent } from '@projectx/types'

export interface FileSyncStats {
  processed: number
  succeeded: number
  failed: number
  skipped: number
}

export function useLibraryFileSync() {
  const syncing = ref(false)
  const stats = ref<FileSyncStats | null>(null)
  const error = ref<string | null>(null)

  async function syncAll(libraryId: number, dryRun = false): Promise<void> {
    syncing.value = true
    stats.value = null
    error.value = null

    try {
      const url = `/api/v1/libraries/${libraryId}/write-metadata-to-files${dryRun ? '?dryRun=true' : ''}`
      const res = await api(url, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n')
          buf = lines.pop() ?? ''
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (!raw) continue
            const event = JSON.parse(raw) as LibraryFileSyncProgressEvent
            if ('done' in event && event.done) {
              stats.value = {
                processed: event.processed,
                succeeded: event.succeeded,
                failed: event.failed,
                skipped: event.skipped,
              }
            }
          }
        }
      } catch (e) {
        reader.cancel().catch(() => {})
        throw e
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Sync failed'
    } finally {
      syncing.value = false
    }
  }

  return { syncing, stats, error, syncAll }
}
