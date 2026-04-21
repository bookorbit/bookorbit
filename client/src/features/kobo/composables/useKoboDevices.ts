import { ref } from 'vue'
import { api } from '@/lib/api'
import type { KoboDevice, KoboDeviceWithToken } from '@bookorbit/types'

const devices = ref<KoboDevice[]>([])
let fetchPromise: Promise<void> | null = null

export function useKoboDevices() {
  async function fetchDevices(): Promise<void> {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/kobo/devices')
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to fetch devices')
        devices.value = await res.json()
      })
      .finally(() => {
        fetchPromise = null
      })
    return fetchPromise
  }

  async function createDevice(name: string): Promise<KoboDeviceWithToken> {
    const res = await api('/api/v1/kobo/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error('Failed to create device')
    const created: KoboDeviceWithToken = await res.json()
    devices.value = [...devices.value, { id: created.id, name: created.name, lastSeenAt: created.lastSeenAt, createdAt: created.createdAt }]
    return created
  }

  async function renameDevice(id: number, name: string): Promise<KoboDevice> {
    const res = await api(`/api/v1/kobo/devices/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error('Failed to rename device')
    const updated: KoboDevice = await res.json()
    devices.value = devices.value.map((d) => (d.id === id ? updated : d))
    return updated
  }

  async function revokeDevice(id: number) {
    const res = await api(`/api/v1/kobo/devices/${id}`, { method: 'DELETE' })
    if (!res.ok) throw new Error('Failed to revoke device')
    devices.value = devices.value.filter((d) => d.id !== id)
  }

  return { devices, fetchDevices, createDevice, renameDevice, revokeDevice }
}
