import { ref } from 'vue'
import { api } from '@/lib/api'
import { useAuth } from './useAuth'

export const MAX_PROFILE_AVATAR_BYTES = 5 * 1024 * 1024

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const message = (payload as { message?: unknown }).message
  if (typeof message === 'string' && message.trim().length > 0) return message
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0]
  return fallback
}

export function useProfileAvatar() {
  const { user, me } = useAuth()
  const uploading = ref(false)
  const removing = ref(false)

  async function uploadAvatar(file: File): Promise<string | null> {
    if (!file.type.startsWith('image/')) {
      throw new Error('File must be an image')
    }
    if (file.size > MAX_PROFILE_AVATAR_BYTES) {
      throw new Error('Image exceeds 5 MB limit')
    }

    uploading.value = true
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await api('/api/v1/users/me/avatar', { method: 'POST', body: formData })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(extractErrorMessage(payload, 'Failed to upload profile picture'))
      }

      const payload = (await res.json().catch(() => null)) as { avatarUrl?: string | null } | null
      if (user.value) {
        user.value = { ...user.value, avatarUrl: payload?.avatarUrl ?? null }
      } else {
        await me()
      }

      return payload?.avatarUrl ?? null
    } finally {
      uploading.value = false
    }
  }

  async function removeAvatar(): Promise<string | null> {
    removing.value = true
    try {
      const res = await api('/api/v1/users/me/avatar', { method: 'DELETE' })
      if (!res.ok) {
        const payload = await res.json().catch(() => null)
        throw new Error(extractErrorMessage(payload, 'Failed to remove profile picture'))
      }

      const payload = (await res.json().catch(() => null)) as { avatarUrl?: string | null } | null
      if (user.value) {
        user.value = { ...user.value, avatarUrl: payload?.avatarUrl ?? null }
      } else {
        await me()
      }

      return payload?.avatarUrl ?? null
    } finally {
      removing.value = false
    }
  }

  return {
    uploading,
    removing,
    uploadAvatar,
    removeAvatar,
  }
}
