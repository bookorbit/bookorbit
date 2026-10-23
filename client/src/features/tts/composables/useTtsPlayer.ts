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
// Long enough to fold a speed-slider drag into one round of requests.
const SETTINGS_RESYNC_DELAY_MS = 300

type TextSourceFn = (chapterIndex: number) => Promise<string[]>
type ScheduledSource = { source: AudioBufferSourceNode; blockIdx: number; endTime: number; generation: number }

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
let scheduledSources: ScheduledSource[] = []
let nextScheduleTime = 0
const decodedQueue = new Map<number, AudioBuffer>()
let lastScheduledBlockIdx = -1

let getTextBlocks: TextSourceFn | null = null
let chapterBlocks: string[] = []
const pendingPrefetches = new Set<number>()
let prefetchGeneration = 0
let synthesisAbort = new AbortController()
// The block playback is waiting for, until its audio is scheduled.
let awaitedBlockIdx: number | null = null
let settingsResyncTimer: ReturnType<typeof setTimeout> | null = null

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

function ensureAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext()
  return audioCtx
}

// A paused player stays silent: audio that arrives during the pause waits for the listener to resume.
function getOrCreateAudioContext(): AudioContext {
  const ctx = ensureAudioContext()
  if (ctx.state === 'suspended' && playbackState.value !== 'paused') void ctx.resume()
  return ctx
}

function primeAudioContext(): void {
  const ctx = ensureAudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
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

function cancelSettingsResync(): void {
  if (settingsResyncTimer === null) return
  clearTimeout(settingsResyncTimer)
  settingsResyncTimer = null
}

function invalidateSynthesis(): void {
  prefetchGeneration++
  pendingPrefetches.clear()
  synthesisAbort.abort()
  synthesisAbort = new AbortController()
  cancelSettingsResync()
}

function stopSource(source: AudioBufferSourceNode): void {
  source.onended = null
  try {
    source.stop(0)
  } catch {
    // Source may have already ended naturally
  }
}

function stopAllSources(): void {
  for (const { source } of scheduledSources) stopSource(source)
  scheduledSources = []
  decodedQueue.clear()
  nextScheduleTime = 0
  lastScheduledBlockIdx = -1
  awaitedBlockIdx = null
  invalidateSynthesis()
}

function stopAndResetFor(blockIdx: number): void {
  stopAllSources()
  lastScheduledBlockIdx = blockIdx - 1
}

/**
 * Drops audio queued after the playing block. That block finishes as it was synthesized and is
 * moved into the current generation, so its end still hands over to the next block.
 */
function stopScheduledAfter(currentIdx: number): void {
  decodedQueue.clear()
  const current = scheduledSources.find((entry) => entry.blockIdx === currentIdx)
  if (!current) return
  for (const entry of scheduledSources) {
    if (entry !== current) stopSource(entry.source)
  }
  scheduledSources = [current]
  current.generation = prefetchGeneration
  lastScheduledBlockIdx = currentIdx
  nextScheduleTime = current.endTime
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
    const entry: ScheduledSource = { source, blockIdx, endTime, generation: prefetchGeneration }
    scheduledSources.push(entry)
    if (blockIdx === awaitedBlockIdx) awaitedBlockIdx = null
    source.onended = () => {
      scheduledSources = scheduledSources.filter((s) => s !== entry)
      if (entry.generation !== prefetchGeneration) return
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

  async function fetchAndPlay(blockIdx: number, { keepPaused = false } = {}) {
    if (!currentBook.value) return
    cancelSettingsResync()
    if (!keepPaused || playbackState.value !== 'paused') playbackState.value = 'loading'
    const text = chapterBlocks[blockIdx]
    if (!text) {
      await advanceChapter()
      return
    }
    const gen = prefetchGeneration
    const { signal } = synthesisAbort
    awaitedBlockIdx = blockIdx
    try {
      const blob = await fetchAudio(text, signal)
      if (prefetchGeneration !== gen) return
      const buffer = await decodeAudioBlob(blob)
      if (prefetchGeneration !== gen) return
      scheduleIfNext(blockIdx, buffer)
      currentBlockIndex.value = blockIdx
      if (playbackState.value !== 'paused') {
        playbackState.value = 'playing'
        mediaSession.setPlaybackState('playing')
      }
      queueCurrentPositionSave(blockIdx)
      prefetchAhead(blockIdx)
    } catch (err) {
      if (prefetchGeneration !== gen) return
      handleError(err)
    }
  }

  async function fetchAudio(text: string, signal: AbortSignal): Promise<Blob> {
    const res = await ttsApi.synthesize(
      {
        text,
        voiceId: currentVoiceId.value,
        providerId: currentProviderId.value,
        speed: speed.value,
        format: 'mp3',
      },
      signal,
    )
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
    if (next <= lastScheduledBlockIdx) return
    awaitedBlockIdx = next
    if (!pendingPrefetches.has(next) && !decodedQueue.has(next)) {
      await fetchAndPlay(next)
    }
  }

  function prefetchAhead(currentIdx: number) {
    const gen = prefetchGeneration
    const { signal } = synthesisAbort
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
      // A superseded generation must leave pendingPrefetches alone: it was cleared, and may
      // already hold the replacement request for the same block.
      fetchAudio(text, signal)
        .then(async (blob) => {
          if (prefetchGeneration !== gen) return
          const buffer = await decodeAudioBlob(blob)
          if (prefetchGeneration !== gen) return
          pendingPrefetches.delete(idx)
          scheduleIfNext(idx, buffer)
        })
        .catch(() => {
          if (prefetchGeneration !== gen) return
          pendingPrefetches.delete(idx)
          if (idx === awaitedBlockIdx) void fetchAndPlay(idx, { keepPaused: true })
        })
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
    applySynthesisSettings()
  }

  function setVoice(providerId: string, voiceId: string) {
    if (providerId === currentProviderId.value && voiceId === currentVoiceId.value) return
    currentProviderId.value = providerId
    currentVoiceId.value = voiceId
    applySynthesisSettings()
  }

  /**
   * The playing block finishes as it was synthesized; everything after it is cancelled and asked
   * for again once the settings stop changing. A block playback is still waiting for is fetched again.
   */
  function applySynthesisSettings() {
    if (!isActive.value) return
    invalidateSynthesis()
    stopScheduledAfter(currentBlockIndex.value)
    settingsResyncTimer = setTimeout(resyncAfterSettingsChange, SETTINGS_RESYNC_DELAY_MS)
  }

  function resyncAfterSettingsChange() {
    settingsResyncTimer = null
    if (awaitedBlockIdx !== null) {
      const blockIdx = awaitedBlockIdx
      stopAndResetFor(blockIdx)
      void fetchAndPlay(blockIdx, { keepPaused: true })
      return
    }
    const currentIdx = currentBlockIndex.value
    if (scheduledSources.some((entry) => entry.blockIdx === currentIdx)) prefetchAhead(currentIdx)
  }

  function increaseSpeed() {
    setSpeed(Math.round((speed.value + SPEED_STEP) * 100) / 100)
  }

  function decreaseSpeed() {
    setSpeed(Math.round((speed.value - SPEED_STEP) * 100) / 100)
  }

  function handleError(err: unknown) {
    awaitedBlockIdx = null
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
