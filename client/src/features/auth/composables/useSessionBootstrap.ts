import { readonly, ref } from 'vue'
import { useAuth } from './useAuth'
import { useLoginOptions } from './useLoginOptions'
import { useSetupStatus } from './useSetupStatus'

const RETRY_BASE_DELAY_MS = 1_000
const RETRY_MAX_DELAY_MS = 10_000

const unreachable = ref(false)
let checking = false
let resolved: Promise<void> = Promise.resolve()
let markResolved: (() => void) | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let failedRetries = 0

/** True once the server has answered, whatever the answer was. */
async function askServer(): Promise<boolean> {
  const { fetchSetupStatus, needsSetup } = useSetupStatus()
  try {
    await Promise.all([fetchSetupStatus(), useLoginOptions().fetchLoginOptions()])
  } catch {
    // The session check below decides whether the server is there at all.
  }
  if (needsSetup.value === true) return true
  return (await useAuth().init()) !== 'unreachable'
}

function scheduleRetry(): void {
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** failedRetries, RETRY_MAX_DELAY_MS)
  failedRetries += 1
  retryTimer = setTimeout(() => void retryNow(), delay)
}

async function retryNow(): Promise<void> {
  if (!unreachable.value || checking) return
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  checking = true
  const answered = await askServer().catch(() => false)
  checking = false
  if (!answered) {
    scheduleRetry()
    return
  }
  unreachable.value = false
  markResolved?.()
  markResolved = null
}

/**
 * Settles setup status and the session before the router's first decision. When the server cannot be
 * reached (a restart, a dropped connection) the session is unknown rather than absent, so this keeps
 * asking in the background and the auth guard waits, instead of sending a signed-in reader to sign in.
 */
export async function bootstrapSession(): Promise<void> {
  if (await askServer()) return
  unreachable.value = true
  resolved = new Promise((resolve) => {
    markResolved = resolve
  })
  scheduleRetry()
}

/** Settles once the server has said whether there is a session. */
export function whenSessionResolved(): Promise<void> {
  return resolved
}

export function useSessionBootstrap() {
  return { unreachable: readonly(unreachable), retryNow }
}
