import { ref } from 'vue'

const SLEEP_PRESETS_MINUTES = [5, 10, 15, 30, 60] as const

export function useTtsSleepTimer(onExpire: () => void) {
  const activeMinutes = ref<number | null>(null)
  const remainingSeconds = ref<number | null>(null)
  let timer: ReturnType<typeof setInterval> | null = null

  function startTimer(minutes: number) {
    cancelTimer()
    activeMinutes.value = minutes
    remainingSeconds.value = minutes * 60
    timer = setInterval(() => {
      if (remainingSeconds.value !== null) {
        remainingSeconds.value -= 1
        if (remainingSeconds.value <= 0) {
          cancelTimer()
          onExpire()
        }
      }
    }, 1000)
  }

  function cancelTimer() {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    activeMinutes.value = null
    remainingSeconds.value = null
  }

  return {
    activeMinutes,
    remainingSeconds,
    presets: SLEEP_PRESETS_MINUTES,
    startTimer,
    cancelTimer,
  }
}
