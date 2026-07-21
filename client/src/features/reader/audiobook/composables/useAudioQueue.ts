import { ref } from 'vue'
import { refreshAccessToken } from '@/lib/api'

export interface AudioFile {
  id: number
  format: string | null
  durationSeconds: number | null
}

function serveUrl(fileId: number): string {
  return `/api/v1/books/files/${fileId}/serve`
}

export function useAudioQueue(files: AudioFile[], onFileEnd: (fileId: number) => void) {
  const currentIndex = ref(0)
  const isPlaying = ref(false)
  const currentPosition = ref(0)
  const duration = ref(0)
  const loadError = ref<string | null>(null)

  const audio = new Audio()
  audio.crossOrigin = 'anonymous'

  let retriedForSrc: string | null = null

  audio.addEventListener('ended', () => {
    onFileEnd(files[currentIndex.value]?.id ?? 0)
  })

  audio.addEventListener('play', () => {
    isPlaying.value = true
  })

  audio.addEventListener('pause', () => {
    isPlaying.value = false
  })

  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration)) {
      duration.value = audio.duration
    }
  })

  audio.addEventListener('timeupdate', () => {
    currentPosition.value = audio.currentTime
  })

  audio.addEventListener('error', () => {
    retryOnError()
  })

  // The access_token cookie can expire during long screen-off playback.
  // Refresh it and retry loading the current src once.
  function retryOnError() {
    const src = audio.src
    if (!src || retriedForSrc === src) {
      loadError.value = 'Failed to load audio file'
      return
    }
    retriedForSrc = src
    void refreshAccessToken()
      .catch(() => {})
      .finally(() => {
        if (audio.src !== src) return
        const pos = audio.currentTime
        audio.src = src
        audio.currentTime = pos
        audio.play().catch(() => {})
      })
  }

  function loadTrack(index: number) {
    const clamped = Math.max(0, Math.min(index, files.length - 1))
    currentIndex.value = clamped
    const file = files[clamped]!
    const url = serveUrl(file.id)

    if (audio.src !== url) {
      audio.src = url
      retriedForSrc = null
    }

    duration.value = file.durationSeconds ?? 0
    loadError.value = null
  }

  function activateIndex(index: number, positionSeconds = 0) {
    loadTrack(index)
    currentPosition.value = positionSeconds

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(audio.duration)) {
      audio.currentTime = positionSeconds
    } else {
      const target = positionSeconds
      const onMeta = () => {
        audio.currentTime = target
        audio.removeEventListener('loadedmetadata', onMeta)
      }
      audio.addEventListener('loadedmetadata', onMeta)
    }
  }

  function play() {
    audio.play().catch(() => {})
  }

  function pause() {
    audio.pause()
  }

  function seek(seconds: number) {
    const fileDur = files[currentIndex.value]?.durationSeconds
    const upper = duration.value || (fileDur != null ? fileDur : Infinity)
    const s = Math.max(0, Math.min(seconds, upper))

    if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
      audio.currentTime = s
    } else {
      const target = s
      const onMeta = () => {
        audio.currentTime = target
        audio.removeEventListener('loadedmetadata', onMeta)
      }
      audio.addEventListener('loadedmetadata', onMeta)
    }
    currentPosition.value = s
  }

  function position(): number {
    return audio.currentTime
  }

  function setSpeed(rate: number) {
    audio.playbackRate = rate
  }

  function setVolume(vol: number) {
    audio.volume = vol
  }

  function goToFile(fileId: number, positionSeconds = 0) {
    const idx = files.findIndex((f) => f.id === fileId)
    if (idx === -1) return
    activateIndex(idx, positionSeconds)
  }

  function nextFile() {
    if (currentIndex.value < files.length - 1) activateIndex(currentIndex.value + 1, 0)
  }

  function prevFile() {
    if (currentIndex.value > 0) activateIndex(currentIndex.value - 1, 0)
  }

  function destroy() {
    audio.pause()
    audio.src = ''
    retriedForSrc = null
  }

  return {
    currentIndex,
    isPlaying,
    currentPosition,
    duration,
    loadError,
    files,
    activateIndex,
    play,
    pause,
    seek,
    position,
    setSpeed,
    setVolume,
    goToFile,
    nextFile,
    prevFile,
    destroy,
  }
}
