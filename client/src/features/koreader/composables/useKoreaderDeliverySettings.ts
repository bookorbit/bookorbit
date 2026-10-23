import { computed, reactive, ref, watch, type Ref } from 'vue'
import type { KoreaderCredentials, KoreaderDeviceInfo, KoreaderDeviceSweepInfo, ReadAloudDeliveryPreference } from '@bookorbit/types'
import { api } from '@/lib/api'

export function useKoreaderDeliverySettings(
  credentials: Ref<KoreaderCredentials | null>,
  devices: Ref<(KoreaderDeviceInfo | KoreaderDeviceSweepInfo)[]>,
  refreshed: () => void,
) {
  const defaultDraft = ref<ReadAloudDeliveryPreference>(credentials.value?.readAloudDelivery ?? null)
  const deviceDrafts = reactive<Record<string, ReadAloudDeliveryPreference>>({})
  const saving = ref<string | null>(null)
  const error = ref(false)
  const saved = ref(false)
  const defaultChanged = computed(() => defaultDraft.value !== (credentials.value?.readAloudDelivery ?? null))

  watch(
    () => credentials.value?.readAloudDelivery,
    (value) => {
      defaultDraft.value = value ?? null
    },
  )
  watch(
    devices,
    (rows, previous) => {
      const oldValues = new Map((previous ?? []).map((device) => [device.deviceId, device.readAloudDelivery ?? null]))
      for (const device of rows) {
        if (!(device.deviceId in deviceDrafts) || deviceDrafts[device.deviceId] === oldValues.get(device.deviceId))
          deviceDrafts[device.deviceId] = device.readAloudDelivery ?? null
      }
    },
    { immediate: true },
  )

  function deviceChanged(device: KoreaderDeviceInfo | KoreaderDeviceSweepInfo) {
    return deviceDrafts[device.deviceId] !== (device.readAloudDelivery ?? null)
  }

  async function save(deviceId?: string) {
    if (saving.value) return
    const value = deviceId ? (deviceDrafts[deviceId] ?? null) : defaultDraft.value
    saving.value = deviceId ?? 'default'
    error.value = false
    saved.value = false
    try {
      const response = await api(
        deviceId ? `/api/v1/koreader/devices/${encodeURIComponent(deviceId)}/delivery-settings` : '/api/v1/koreader/credentials',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ readAloudDelivery: value }),
        },
      )
      if (!response.ok) throw new Error('save')
      saved.value = true
      refreshed()
    } catch {
      error.value = true
    } finally {
      saving.value = null
    }
  }

  return { defaultDraft, deviceDrafts, saving, saved, error, defaultChanged, deviceChanged, save }
}
