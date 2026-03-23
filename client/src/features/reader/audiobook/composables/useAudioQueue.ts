import { ref } from 'vue'
import { Howl } from 'howler'

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

  // Only the active Howl and its immediate neighbours are kept alive.
  const howls = new Map<number, Howl>()

  // Pending seek to apply when the current Howl finishes loading.
  // Using a single variable prevents stacking multiple once('load') seek handlers.
  let pendingSeek: number | null = null

  function buildHowl(index: number): Howl {
    const file = files[index]!
    const fmt = file.format?.toLowerCase() ?? 'm4b'
    const howl = new Howl({
      src: [serveUrl(file.id)],
      format: [fmt],
      html5: true,
      preload: false,
      onend() {
        onFileEnd(file.id)
      },
      onplay() {
        isPlaying.value = true
      },
      onpause() {
        isPlaying.value = false
      },
      onstop() {
        isPlaying.value = false
      },
      onload() {
        if (index === currentIndex.value) {
          duration.value = howl.duration()
        }
      },
      onloaderror(_id: number, err: unknown) {
        if (index === currentIndex.value) {
          loadError.value = typeof err === 'string' ? err : 'Failed to load audio file'
        }
      },
    })
    return howl
  }

  function getOrCreate(index: number): Howl {
    const file = files[index]!
    if (!howls.has(file.id)) {
      howls.set(file.id, buildHowl(index))
    }
    return howls.get(file.id)!
  }

  function evictDistant(activeIndex: number) {
    for (const [fileId, howl] of howls) {
      const idx = files.findIndex((f) => f.id === fileId)
      if (Math.abs(idx - activeIndex) > 1) {
        howl.stop()
        howl.unload()
        howls.delete(fileId)
      }
    }
  }

  function activateIndex(index: number, positionSeconds = 0) {
    const clamped = Math.max(0, Math.min(index, files.length - 1))
    if (clamped !== currentIndex.value) {
      const prev = howls.get(files[currentIndex.value]!.id)
      prev?.stop()
      currentIndex.value = clamped
      pendingSeek = null
    }

    const howl = getOrCreate(clamped)
    if (clamped + 1 < files.length) getOrCreate(clamped + 1)
    if (clamped - 1 >= 0) getOrCreate(clamped - 1)
    evictDistant(clamped)

    loadError.value = null
    duration.value = files[clamped]!.durationSeconds ?? 0

    if (howl.state() === 'loaded') {
      duration.value = howl.duration()
      howl.seek(positionSeconds)
      currentPosition.value = positionSeconds
    } else {
      pendingSeek = positionSeconds
      howl.once('load', () => {
        duration.value = howl.duration()
        const seekTo = pendingSeek ?? positionSeconds
        pendingSeek = null
        howl.seek(seekTo)
        currentPosition.value = seekTo
      })
      howl.load()
    }
  }

  function currentHowl(): Howl | undefined {
    const id = files[currentIndex.value]?.id
    return id !== undefined ? howls.get(id) : undefined
  }

  function play() {
    const h = currentHowl()
    if (!h) return
    if (h.state() === 'unloaded') {
      h.once('load', () => h.play())
      h.load()
    } else {
      h.play()
    }
  }

  function pause() {
    currentHowl()?.pause()
  }

  function seek(seconds: number) {
    const h = currentHowl()
    if (!h) return
    const fileDur = files[currentIndex.value]?.durationSeconds
    const upper = duration.value || (fileDur != null ? fileDur : Infinity)
    const s = Math.max(0, Math.min(seconds, upper))
    if (h.state() === 'loaded') {
      h.seek(s)
    } else {
      // Store as pending; the activateIndex load handler will apply the latest value.
      pendingSeek = s
    }
    currentPosition.value = s
  }

  function position(): number {
    const h = currentHowl()
    if (!h) return currentPosition.value
    const p = h.seek()
    return typeof p === 'number' ? p : currentPosition.value
  }

  function setSpeed(rate: number) {
    for (const h of howls.values()) h.rate(rate)
  }

  function setVolume(vol: number) {
    for (const h of howls.values()) h.volume(vol)
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
    for (const h of howls.values()) {
      h.stop()
      h.unload()
    }
    howls.clear()
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
