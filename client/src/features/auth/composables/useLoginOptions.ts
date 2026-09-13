import { ref } from 'vue'
import type { LoginOptionsResponse } from '@bookorbit/types'

const loginOptions = ref<LoginOptionsResponse | null>(null)
const loginOptionsError = ref<string | null>(null)
let inFlight: Promise<LoginOptionsResponse> | null = null

export function useLoginOptions() {
  async function fetchLoginOptions(force = false): Promise<LoginOptionsResponse> {
    if (inFlight) return inFlight
    if (!force && loginOptions.value) return loginOptions.value

    inFlight = (async () => {
      try {
        const res = await fetch('/api/v1/auth/login-options', { credentials: 'include' })
        if (!res.ok) throw new Error('Failed to load sign-in options')
        const data = (await res.json()) as LoginOptionsResponse
        loginOptions.value = data
        loginOptionsError.value = null
        return data
      } catch (error) {
        loginOptions.value = null
        loginOptionsError.value = error instanceof Error ? error.message : 'Failed to load sign-in options'
        throw error
      } finally {
        inFlight = null
      }
    })()

    return inFlight
  }

  return { loginOptions, loginOptionsError, fetchLoginOptions }
}
