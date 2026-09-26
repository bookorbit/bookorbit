import { ref } from 'vue'
import type { TtsPlaybackState } from '@bookorbit/types'
import { registerAudioFocusOwner, requestAudioFocus } from '@/lib/audio-focus'
import * as ttsApi from '../api/tts.api'
import { useTtsPosition } from './useTtsPosition'
import { useTtsMediaSession } from './useTtsMediaSession'
import { useTtsSleepTimer } from './useTtsSleepTimer'
import { useTtsReadingSession } from './useTtsReadingSession'
import type { TtsCurrentBook } from '../lib/tts-state'
import { i18n } from '@/i18n'

const PREFETCH_AHEAD = 3
const MIN_SPEED = 0.25
const MAX_SPEED = 4.0
const SPEED_STEP = 0.25
const SCHEDULE_LATENCY = 0.05

type TextSourceFn = (chapterIndex: number) => Promise<string[]>

const playbackState = ref<TtsPlaybackState>('idle')
const currentBook = ref<TtsCurrentBook | null>(null)
const currentBlockIndex = ref(0)
const currentChapterIndex = ref(0)
const speed = ref(1.0)
const error = ref<string | null>(null)
const isActive = ref(false)
const currentProviderId = ref('')
const currentVoiceId = ref('')

let audioCtx: AudioContext | null = null
let scheduledSources: Array<{ source: AudioBufferSourceNode; blockIdx: number; endTime: number }> = []
let nextScheduleTime = 0
const decodedQueue = new Map<number, AudioBuffer>()
let lastScheduledBlockIdx = -1

let getTextBlocks: TextSourceFn | null = null
let chapterBlocks: string[] = []
const pendingPrefetches = new Set<number>()
let prefetchGeneration = 0

const positionComposable = useTtsPosition()
const mediaSession = useTtsMediaSession()
const readingSession = useTtsReadingSession()

function queueCurrentPositionSave(blockIdx = currentBlockIndex.value) {
  if (!currentBook.value) return
  positionComposable.scheduleSave(currentBook.value.bookFileId, `tts:${currentChapterIndex.value}:${blockIdx}`, currentChapterIndex.value)
}

function flushCurrentPositionSave() {
  queueCurrentPositionSave()
  void positionComposable.flushPendingSave()
}

function getOrCreateAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

function primeAudioContext(): void {
  getOrCreateAudioContext()
}

function internalReset(): void {
  flushCurrentPositionSave()
  stopAllSources()
  if (currentBook.value && readingSession.sessionId.value) {
    void readingSession.endSession({
      bookFileId: currentBook.value.bookFileId,
      endedAt: new Date(),
      durationSeconds: 0,
      progressDelta: null,
      endProgress: null,
    })
  }
  mediaSession.clearHandlers()
  mediaSession.setPlaybackState('none')
  isActive.value = false
  playbackState.value = 'idle'
  currentBook.value = null
  currentProviderId.value = ''
  currentVoiceId.value = ''
  error.value = null
  chapterBlocks = []
  getTextBlocks = null
}

async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = getOrCreateAudioContext()
  const ab = await blob.arrayBuffer()
  return ctx.decodeAudioData(ab)
}

function stopAllSources(): void {
  for (const { source } of scheduledSources) {
    source.onended = null
    try {
      source.stop(0)
    } catch {
      // Source may have already ended naturally
    }
  }
  scheduledSources = []
  decodedQueue.clear()
  nextScheduleTime = 0
  lastScheduledBlockIdx = -1
  pendingPrefetches.clear()
  prefetchGeneration++
}

function stopAndResetFor(blockIdx: number): void {
  stopAllSources()
  lastScheduledBlockIdx = blockIdx - 1
}

function stopScheduledExcept(keepBlockIdx: number): void {
  const toStop = scheduledSources.filter((s) => s.blockIdx !== keepBlockIdx)
  for (const { source } of toStop) {
    source.onended = null
    try {
      source.stop(0)
    } catch {
      // Source may have already ended naturally
    }
  }
  scheduledSources = scheduledSources.filter((s) => s.blockIdx === keepBlockIdx)
  decodedQueue.clear()
  lastScheduledBlockIdx = keepBlockIdx
  const currentEntry = scheduledSources[0]
  if (currentEntry) nextScheduleTime = currentEntry.endTime
}

function pausePlayback() {
  void audioCtx?.suspend()
  playbackState.value = 'paused'
  mediaSession.setPlaybackState('paused')
  flushCurrentPositionSave()
}

const sleepTimer = useTtsSleepTimer(pausePlayback)

registerAudioFocusOwner('tts', () => {
  if (playbackState.value === 'playing') pausePlayback()
})

export function useTtsPlayer() {
  function scheduleAudioBuffer(buffer: AudioBuffer, blockIdx: number): void {
    const ctx = getOrCreateAudioContext()
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    const startTime = Math.max(ctx.currentTime + SCHEDULE_LATENCY, nextScheduleTime)
    source.start(startTime)
    const endTime = startTime + buffer.duration
    nextScheduleTime = endTime
    scheduledSources.push({ source, blockIdx, endTime })
    const capturedGen = prefetchGeneration
    source.onended = () => {
      scheduledSources = scheduledSources.filter((s) => s.source !== source)
      if (prefetchGeneration !== capturedGen) return
      if (playbackState.value !== 'playing') return
      void onBlockEnded(blockIdx)
    }
  }

  function scheduleIfNext(blockIdx: number, buffer: AudioBuffer): void {
    if (blockIdx === lastScheduledBlockIdx + 1) {
      scheduleAudioBuffer(buffer, blockIdx)
      lastScheduledBlockIdx = blockIdx
      let nextIdx = lastScheduledBlockIdx + 1
      while (decodedQueue.has(nextIdx)) {
        const buf = decodedQueue.get(nextIdx)!
        decodedQueue.delete(nextIdx)
        scheduleAudioBuffer(buf, nextIdx)
        lastScheduledBlockIdx = nextIdx
        nextIdx++
      }
    } else {
      decodedQueue.set(blockIdx, buffer)
    }
  }

  async function startPlayback(
    book: TtsCurrentBook,
    providerId: string,
    voiceId: string,
    spd: number,
    textSource: TextSourceFn,
    startChapter = 0,
    startBlock = 0,
  ) {
    internalReset()
    requestAudioFocus('tts')
    currentBook.value = book
    currentProviderId.value = providerId
    currentVoiceId.value = voiceId
    speed.value = spd
    currentChapterIndex.value = startChapter
    currentBlockIndex.value = Math.max(0, startBlock)
    getTextBlocks = textSource
    isActive.value = true
    playbackState.value = 'loading'
    error.value = null

    mediaSession.setMetadata(book)
    mediaSession.registerHandlers({
      play: resumePlayback,
      pause: pausePlayback,
      previoustrack: prevBlock,
      nexttrack: nextBlock,
      stop: stopPlayback,
    })
    readingSession.startSession()

    try {
      chapterBlocks = await textSource(startChapter)
      if (chapterBlocks.length === 0) {
        await advanceChapter()
      } else {
        // Clamp the requested start block and align the scheduler to it.
        // Without resetting lastScheduledBlockIdx, scheduleIfNext() would only
        // schedule when blockIdx === lastScheduledBlockIdx + 1 (i.e. block 0),
        // so any non-zero start block (read-from-here / play-from-here) would be
        // decoded but never scheduled, leaving playback silently stuck.
        const safeStartBlock = Math.min(Math.max(0, startBlock), chapterBlocks.length - 1)
        currentBlockIndex.value = safeStartBlock
        stopAndResetFor(safeStartBlock)
        await fetchAndPlay(safeStartBlock)
      }
    } catch (err) {
      handleError(err)
    }
  }

  async function fetchAndPlay(blockIdx: number) {
    if (!currentBook.value) return
    playbackState.value = 'loading'
    const text = chapterBlocks[blockIdx]
    if (!text) {
      await advanceChapter()
      return
    }
    const gen = prefetchGeneration
    try {
      const blob = await fetchAudio(text)
      if (prefetchGeneration !== gen) return
      const buffer = await decodeAudioBlob(blob)
      if (prefetchGeneration !== gen) return
      scheduleIfNext(blockIdx, buffer)
      currentBlockIndex.value = blockIdx
      playbackState.value = 'playing'
      mediaSession.setPlaybackState('playing')
      queueCurrentPositionSave(blockIdx)
      prefetchAhead(blockIdx)
    } catch (err) {
      handleError(err)
    }
  }

  async function fetchAudio(text: string): Promise<Blob> {
    const res = await ttsApi.synthesize({
      text,
      voiceId: currentVoiceId.value,
      providerId: currentProviderId.value,
      speed: speed.value,
      format: 'mp3',
    })
    if (!res.ok) throw new Error(`Synthesis failed: ${res.status}`)
    return res.blob()
  }

  async function onBlockEnded(blockIdx: number) {
    if (playbackState.value !== 'playing') return
    const next = blockIdx + 1
    if (next >= chapterBlocks.length) {
      await advanceChapter()
      return
    }
    currentBlockIndex.value = next
    queueCurrentPositionSave(next)
    prefetchAhead(next)
    if (next > lastScheduledBlockIdx && !pendingPrefetches.has(next) && !decodedQueue.has(next)) {
      await fetchAndPlay(next)
    }
  }

  function prefetchAhead(currentIdx: number) {
    const gen = prefetchGeneration
    for (let i = 1; i <= PREFETCH_AHEAD; i++) {
      const idx = currentIdx + i
      if (idx >= chapterBlocks.length) break
      if (pendingPrefetches.has(idx)) continue
      if (idx <= lastScheduledBlockIdx) continue
      if (decodedQueue.has(idx)) continue
      pendingPrefetches.add(idx)
      const text = chapterBlocks[idx]
      if (!text) {
        pendingPrefetches.delete(idx)
        continue
      }
      fetchAudio(text)
        .then((blob) => {
          if (prefetchGeneration !== gen) {
            pendingPrefetches.delete(idx)
            return
          }
          return decodeAudioBlob(blob).then((buffer) => {
            pendingPrefetches.delete(idx)
            if (prefetchGeneration !== gen) return
            scheduleIfNext(idx, buffer)
          })
        })
        .catch(() => pendingPrefetches.delete(idx))
    }
  }

  async function advanceChapter() {
    if (!currentBook.value) return
    const next = currentChapterIndex.value + 1
    if (next >= currentBook.value.totalChapters) {
      stopPlayback()
      return
    }
    currentChapterIndex.value = next
    currentBlockIndex.value = 0
    stopAllSources()
    if (!getTextBlocks) return
    chapterBlocks = await getTextBlocks(next)
    if (chapterBlocks.length > 0) {
      await fetchAndPlay(0)
    } else {
      await advanceChapter()
    }
  }

  function resumePlayback() {
    if (playbackState.value !== 'paused') return
    requestAudioFocus('tts')
    if (audioCtx) void audioCtx.resume()
    playbackState.value = 'playing'
    mediaSession.setPlaybackState('playing')
  }

  function stopPlayback() {
    internalReset()
    void audioCtx?.close?.()
    audioCtx = null
  }

  async function nextBlock() {
    if (!isActive.value) return
    flushCurrentPositionSave()
    const next = currentBlockIndex.value + 1
    if (next < chapterBlocks.length) {
      stopAndResetFor(next)
      await fetchAndPlay(next)
    } else {
      await advanceChapter()
    }
  }

  async function prevBlock() {
    if (!isActive.value) return
    flushCurrentPositionSave()
    const prev = Math.max(0, currentBlockIndex.value - 1)
    stopAndResetFor(prev)
    await fetchAndPlay(prev)
  }

  function togglePlayPause() {
    if (playbackState.value === 'playing') pausePlayback()
    else if (playbackState.value === 'paused') resumePlayback()
  }

  function setSpeed(newSpeed: number) {
    const nextSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, newSpeed))
    if (nextSpeed === speed.value) return
    speed.value = nextSpeed
    if (!isActive.value) return
    prefetchGeneration++
    pendingPrefetches.clear()
    stopScheduledExcept(currentBlockIndex.value)
  }

  function setVoice(providerId: string, voiceId: string) {
    currentProviderId.value = providerId
    currentVoiceId.value = voiceId
    if (!isActive.value) return
    prefetchGeneration++
    pendingPrefetches.clear()
    stopScheduledExcept(currentBlockIndex.value)
  }

  function increaseSpeed() {
    setSpeed(Math.round((speed.value + SPEED_STEP) * 100) / 100)
  }

  function decreaseSpeed() {
    setSpeed(Math.round((speed.value - SPEED_STEP) * 100) / 100)
  }

  function handleError(err: unknown) {
    flushCurrentPositionSave()
    const message = err instanceof Error ? err.message : i18n.global.t('tts.errors.generic')
    error.value = message
    playbackState.value = 'error'
    mediaSession.setPlaybackState('none')
  }

  async function startFromPosition(chapterIndex: number, blockIndex: number) {
    if (!currentBook.value || !getTextBlocks) return
    if (chapterIndex !== currentChapterIndex.value) {
      currentChapterIndex.value = chapterIndex
      chapterBlocks = await getTextBlocks(chapterIndex)
    }
    stopAndResetFor(blockIndex)
    await fetchAndPlay(blockIndex)
  }

  return {
    playbackState,
    currentBook,
    currentBlockIndex,
    currentChapterIndex,
    speed,
    currentProviderId,
    currentVoiceId,
    error,
    isActive,
    sleepTimer,
    primeAudioContext,
    startPlayback,
    pausePlayback,
    resumePlayback,
    stopPlayback,
    nextBlock,
    prevBlock,
    togglePlayPause,
    setSpeed,
    setVoice,
    increaseSpeed,
    decreaseSpeed,
    startFromPosition,
  }
}
