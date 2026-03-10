import { ref } from 'vue'

const needsSetup = ref<boolean | null>(null)
const setupStatusError = ref<string | null>(null)
let inFlight: Promise<boolean> | null = null

export function useSetupStatus() {
  async function fetchSetupStatus(force = false): Promise<boolean> {
    if (inFlight) return inFlight
    if (!force && needsSetup.value !== null) return needsSetup.value

    inFlight = (async () => {
      try {
        const res = await fetch('/api/v1/auth/setup-status', { credentials: 'include' })
        if (!res.ok) throw new Error('Failed to load setup status')
        const data = (await res.json()) as { needsSetup?: boolean }
        setupStatusError.value = null
        needsSetup.value = data.needsSetup === true
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load setup status'
        setupStatusError.value = message
        throw err
      } finally {
        inFlight = null
      }
      return needsSetup.value ?? false
    })()

    return inFlight
  }

  function markSetupComplete(): void {
    needsSetup.value = false
    setupStatusError.value = null
  }

  return { needsSetup, setupStatusError, fetchSetupStatus, markSetupComplete }
}
