import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

interface UseMigrationPollingOptions {
  runState: Ref<string | undefined>
  pollFn: () => Promise<void>
  intervalMs?: number
}

export function useMigrationPolling({ runState, pollFn, intervalMs = 3000 }: UseMigrationPollingOptions) {
  let timer: ReturnType<typeof setInterval> | null = null
  const pollingError = ref(false)

  function start() {
    stop()
    timer = setInterval(() => void doPoll(), intervalMs)
  }

  function stop() {
    if (timer == null) return
    clearInterval(timer)
    timer = null
  }

  async function doPoll() {
    try {
      await pollFn()
      pollingError.value = false
    } catch {
      stop()
      pollingError.value = true
    }
  }

  function retry() {
    pollingError.value = false
    start()
    void doPoll()
  }

  watch(runState, (state) => {
    if (state === 'running') {
      start()
    } else {
      stop()
    }
  })

  onBeforeUnmount(stop)

  return { pollingError, start, stop, retry }
}
