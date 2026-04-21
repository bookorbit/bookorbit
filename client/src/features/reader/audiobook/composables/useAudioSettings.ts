import { ref } from 'vue'
import type { AudioReaderSettings } from '@bookorbit/types'
import { AUDIO_READER_DEFAULTS } from '@bookorbit/types'
import { useReaderDefaultSettings } from '@/features/reader/shared/composables/useReaderSettings'

export function useAudioSettings(onSpeedChange: (rate: number) => void, onVolumeChange: (vol: number) => void) {
  const { effective, load, update } = useReaderDefaultSettings<AudioReaderSettings>('m4b')

  const playbackSpeed = ref(AUDIO_READER_DEFAULTS.playbackSpeed)
  const volume = ref(AUDIO_READER_DEFAULTS.volume)
  const skipBackSeconds = ref(AUDIO_READER_DEFAULTS.skipBackSeconds)
  const skipForwardSeconds = ref(AUDIO_READER_DEFAULTS.skipForwardSeconds)

  async function init() {
    await load()
    playbackSpeed.value = effective.value.playbackSpeed
    volume.value = effective.value.volume
    skipBackSeconds.value = effective.value.skipBackSeconds
    skipForwardSeconds.value = effective.value.skipForwardSeconds
    onSpeedChange(playbackSpeed.value)
    onVolumeChange(volume.value)
  }

  function setPlaybackSpeed(rate: number) {
    playbackSpeed.value = rate
    update({ playbackSpeed: rate })
    onSpeedChange(rate)
  }

  function setVolume(vol: number) {
    volume.value = vol
    update({ volume: vol })
    onVolumeChange(vol)
  }

  function setSkipBackSeconds(secs: number) {
    skipBackSeconds.value = secs
    update({ skipBackSeconds: secs })
  }

  function setSkipForwardSeconds(secs: number) {
    skipForwardSeconds.value = secs
    update({ skipForwardSeconds: secs })
  }

  return {
    playbackSpeed,
    volume,
    skipBackSeconds,
    skipForwardSeconds,
    init,
    setPlaybackSpeed,
    setVolume,
    setSkipBackSeconds,
    setSkipForwardSeconds,
  }
}
