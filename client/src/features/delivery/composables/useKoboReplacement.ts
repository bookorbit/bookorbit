import { onScopeDispose, ref, watch, type Ref } from 'vue'
import type { DeliveryArtifactMetadata, ReadAloudDeliveryVariant } from '@bookorbit/types'
import { api } from '@/lib/api'

interface Replacement {
  id: string
  state: string
  options: { replacement: boolean }
  metadata: DeliveryArtifactMetadata
}
export function useKoboReplacement(deviceId: Ref<number | null>, bookId: Ref<number | null>) {
  const replacement = ref<Replacement | null>(null)
  const busy = ref(false)
  const failed = ref(false)
  const alreadyOnDevice = ref(false)
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined

  function stop() {
    generation++
    clearTimeout(timer)
    controller?.abort()
  }
  function poll() {
    clearTimeout(timer)
    if (replacement.value && ['offered', 'transfer_observed'].includes(replacement.value.state)) timer = setTimeout(refresh, 3000)
  }
  async function request(path: string, body?: unknown, onRecord?: (record: Replacement | null) => void) {
    const current = ++generation
    clearTimeout(timer)
    controller?.abort()
    const requestController = new AbortController()
    controller = requestController
    busy.value = true
    failed.value = false
    try {
      const response = await api(path, {
        ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
        signal: requestController.signal,
      })
      if (!response.ok) throw new Error('Replacement request failed')
      const record: Replacement | null = await response.json()
      if (current === generation) {
        replacement.value = record?.options.replacement ? record : null
        onRecord?.(record)
      }
    } catch {
      if (current === generation && !requestController.signal.aborted) failed.value = true
    } finally {
      if (current === generation) {
        busy.value = false
        poll()
      }
    }
  }
  async function refresh() {
    if (!deviceId.value || !bookId.value) return
    await request(`/api/v1/kobo/devices/${deviceId.value}/books/${bookId.value}/delivery`)
  }
  watch([deviceId, bookId], () => {
    stop()
    replacement.value = null
    busy.value = false
    failed.value = false
    alreadyOnDevice.value = false
    void refresh()
  })
  onScopeDispose(stop)
  // The server answers with the device's current copy, not a replacement, when that copy already has these bytes.
  function noteCopyOnDevice(record: Replacement | null) {
    alreadyOnDevice.value = !!record && !record.options.replacement
  }
  async function prepare(variant: ReadAloudDeliveryVariant) {
    alreadyOnDevice.value = false
    if (deviceId.value && bookId.value)
      await request(`/api/v1/kobo/devices/${deviceId.value}/books/${bookId.value}/replacement`, { variant }, noteCopyOnDevice)
  }
  async function transition(action: 'offer' | 'confirm' | 'cancel') {
    if (!deviceId.value || !replacement.value) return
    alreadyOnDevice.value = false
    await request(`/api/v1/kobo/devices/${deviceId.value}/replacements/${replacement.value.id}/${action}`, {})
  }
  return { replacement, busy, failed, alreadyOnDevice, prepare, transition, refresh }
}
