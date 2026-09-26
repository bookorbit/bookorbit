import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'

// ─── AudioContext mock ────────────────────────────────────────────────────────

type MockBufferSourceNode = {
  buffer: AudioBuffer | null
  connect: Mock
  start: Mock
  stop: Mock
  onended: (() => void) | null
  playbackRate: { value: number }
}

type MockAudioContextInstance = {
  currentTime: number
  state: 'running' | 'suspended' | 'closed'
  destination: Record<string, never>
  decodeAudioData: Mock
  suspend: Mock
  resume: Mock
  createBufferSource: Mock
  createdSources: MockBufferSourceNode[]
}

function createMockAudioContext(): MockAudioContextInstance {
  const ctx: MockAudioContextInstance = {
    currentTime: 0,
    state: 'running',
    destination: {},
    createdSources: [],
    decodeAudioData: vi.fn<() => Promise<AudioBuffer>>().mockImplementation(async () => {
      return { duration: 1.0 } as unknown as AudioBuffer
    }),
    suspend: vi.fn<() => Promise<void>>().mockImplementation(async () => {
      ctx.state = 'suspended'
    }),
    resume: vi.fn<() => Promise<void>>().mockImplementation(async () => {
      ctx.state = 'running'
    }),
    createBufferSource: vi.fn<() => MockBufferSourceNode>().mockImplementation(() => {
      const src: MockBufferSourceNode = {
        buffer: null,
        connect: vi.fn<() => void>(),
        start: vi.fn<() => void>(),
        stop: vi.fn<() => void>().mockImplementation(() => {
          if (src.onended) src.onended()
        }),
        onended: null,
        playbackRate: { value: 1 },
      }
      ctx.createdSources.push(src)
      return src
    }),
  }
  return ctx
}

let mockCtxInstance: MockAudioContextInstance

const MockAudioContext = vi.fn<() => MockAudioContextInstance>(function MockAudioContextCtor() {
  mockCtxInstance = createMockAudioContext()
  return mockCtxInstance
})

vi.stubGlobal('AudioContext', MockAudioContext)

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../api/tts.api', () => ({
  synthesize: vi.fn<() => Promise<unknown>>().mockResolvedValue({
    ok: true,
    blob: vi.fn<() => Promise<unknown>>().mockResolvedValue({
      arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(8)),
    }),
  }),
}))

vi.mock('./useTtsPosition', () => ({
  useTtsPosition: () => ({
    scheduleSave: vi.fn<() => void>(),
    flushPendingSave: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

vi.mock('./useTtsMediaSession', () => ({
  useTtsMediaSession: () => ({
    setMetadata: vi.fn<() => void>(),
    registerHandlers: vi.fn<() => void>(),
    clearHandlers: vi.fn<() => void>(),
    setPlaybackState: vi.fn<() => void>(),
  }),
}))

vi.mock('./useTtsSleepTimer', () => ({
  useTtsSleepTimer: () => ({
    isActive: { value: false },
    remaining: { value: null },
    start: vi.fn<() => void>(),
    cancel: vi.fn<() => void>(),
  }),
}))

vi.mock('./useTtsReadingSession', () => ({
  useTtsReadingSession: () => ({
    sessionId: { value: null },
    startSession: vi.fn<() => void>(),
    endSession: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

// ─── Import under test ────────────────────────────────────────────────────────

import * as ttsApi from '../api/tts.api'
import { useTtsPlayer } from './useTtsPlayer'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBook(totalChapters = 3) {
  return {
    bookId: 1,
    bookFileId: 10,
    title: 'Test Book',
    author: 'Author',
    coverUrl: null,
    totalChapters,
  }
}

function makeTextSource(chapters: string[][]): (idx: number) => Promise<string[]> {
  return (idx: number) => Promise.resolve(chapters[idx] ?? [])
}

async function startWithBlocks(blocks: string[]): Promise<ReturnType<typeof useTtsPlayer>> {
  const player = useTtsPlayer()
  await player.startPlayback(makeBook(), 'provider1', 'voice1', 1.0, makeTextSource([blocks]))
  return player
}

function simulateBlockEnd(sourceIndex: number) {
  const src = mockCtxInstance?.createdSources[sourceIndex]
  if (src?.onended) src.onended()
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useTtsPlayer (AudioContext)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockAudioContext.mockImplementation(function MockAudioContextCtor() {
      mockCtxInstance = createMockAudioContext()
      return mockCtxInstance
    })
    ;(ttsApi.synthesize as Mock).mockResolvedValue({
      ok: true,
      blob: vi.fn<() => Promise<unknown>>().mockResolvedValue({
        arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(8)),
      }),
    })
  })

  afterEach(() => {
    const player = useTtsPlayer()
    player.stopPlayback()
    player.setSpeed(1.0)
  })

  describe('primeAudioContext', () => {
    it('creates AudioContext if none exists', () => {
      const player = useTtsPlayer()
      player.primeAudioContext()
      expect(MockAudioContext).toHaveBeenCalledTimes(1)
    })

    it('does not call resume if context is already running', () => {
      const player = useTtsPlayer()
      player.primeAudioContext()
      expect(mockCtxInstance.resume).not.toHaveBeenCalled()
    })

    it('calls resume if context is suspended', async () => {
      const player = useTtsPlayer()
      player.primeAudioContext()
      await mockCtxInstance.suspend()
      player.primeAudioContext()
      expect(mockCtxInstance.resume).toHaveBeenCalled()
    })

    it('reuses existing context on repeated calls', () => {
      const player = useTtsPlayer()
      player.primeAudioContext()
      player.primeAudioContext()
      expect(MockAudioContext).toHaveBeenCalledTimes(1)
    })

    it('startPlayback reuses the primed context instead of creating a new one', async () => {
      const player = useTtsPlayer()
      player.primeAudioContext()
      const ctxCreationsAfterPrime = (MockAudioContext as Mock).mock.calls.length
      await player.startPlayback(makeBook(), 'provider1', 'voice1', 1.0, makeTextSource([['Block.']]))
      expect((MockAudioContext as Mock).mock.calls.length).toBe(ctxCreationsAfterPrime)
      expect(player.playbackState.value).toBe('playing')
    })
  })

  describe('startPlayback', () => {
    it('fetches and schedules first block on start', async () => {
      await startWithBlocks(['Hello world.'])
      expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello world.', voiceId: 'voice1' }))
      expect(mockCtxInstance.createBufferSource).toHaveBeenCalled()
    })

    it('sets playbackState to playing after first block scheduled', async () => {
      const player = await startWithBlocks(['Hello world.'])
      expect(player.playbackState.value).toBe('playing')
    })

    it('sets currentBlockIndex to 0 on start', async () => {
      const player = await startWithBlocks(['Block 0.', 'Block 1.'])
      expect(player.currentBlockIndex.value).toBe(0)
    })

    it('prefetches ahead on start', async () => {
      await startWithBlocks(['Block 0.', 'Block 1.', 'Block 2.', 'Block 3.', 'Block 4.'])
      await vi.waitFor(() => expect(ttsApi.synthesize).toHaveBeenCalledTimes(4))
    })

    it('advances chapter when first chapter has no blocks', async () => {
      const player = useTtsPlayer()
      const textSource = makeTextSource([[], ['Chapter 2 block.']])
      await player.startPlayback(makeBook(), 'p', 'v', 1.0, textSource)
      expect(player.currentChapterIndex.value).toBe(1)
    })

    it('sets isActive to true', async () => {
      const player = await startWithBlocks(['Block.'])
      expect(player.isActive.value).toBe(true)
    })

    it('schedules and plays when starting from a non-zero block (regression: silent stall)', async () => {
      const player = useTtsPlayer()
      await player.startPlayback(makeBook(), 'provider1', 'voice1', 1.0, makeTextSource([['B0.', 'B1.', 'B2.']]), 0, 2)
      expect(player.currentBlockIndex.value).toBe(2)
      expect(player.playbackState.value).toBe('playing')
      // Before the fix, the decoded buffer for block 2 was queued but never
      // scheduled (lastScheduledBlockIdx stayed at -1), so nothing ever played.
      expect(mockCtxInstance.createdSources.length).toBe(1)
      expect(mockCtxInstance.createdSources[0]!.start).toHaveBeenCalled()
      expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'B2.' }))
    })

    it('clamps an out-of-range start block to the last block', async () => {
      const player = useTtsPlayer()
      await player.startPlayback(makeBook(), 'provider1', 'voice1', 1.0, makeTextSource([['B0.', 'B1.']]), 0, 99)
      expect(player.currentBlockIndex.value).toBe(1)
      expect(player.playbackState.value).toBe('playing')
      expect(mockCtxInstance.createdSources.length).toBeGreaterThanOrEqual(1)
      expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'B1.' }))
    })
  })

  describe('AudioContext scheduling', () => {
    it('starts audio source with time >= currentTime + SCHEDULE_LATENCY', async () => {
      mockCtxInstance = createMockAudioContext()
      mockCtxInstance.currentTime = 2.0
      MockAudioContext.mockImplementationOnce(function MockAudioContextCtor() {
        return mockCtxInstance
      })
      await startWithBlocks(['Block.'])
      const source = mockCtxInstance.createdSources[0]!
      const startTime = (source.start as Mock).mock.calls[0]![0] as number
      expect(startTime).toBeGreaterThanOrEqual(2.0 + 0.05)
    })

    it('schedules consecutive buffers back-to-back (no gap)', async () => {
      await startWithBlocks(['Block 0.', 'Block 1.'])
      await vi.waitFor(() => expect(mockCtxInstance.createdSources.length).toBeGreaterThanOrEqual(2))
      const start0 = (mockCtxInstance.createdSources[0]!.start as Mock).mock.calls[0]![0] as number
      const start1 = (mockCtxInstance.createdSources[1]!.start as Mock).mock.calls[0]![0] as number
      expect(start1).toBeCloseTo(start0 + 1.0, 5)
    })
  })

  describe('pausePlayback / resumePlayback', () => {
    it('suspends AudioContext on pause', async () => {
      const player = await startWithBlocks(['Hello.'])
      player.pausePlayback()
      expect(mockCtxInstance.suspend).toHaveBeenCalled()
    })

    it('sets playbackState to paused', async () => {
      const player = await startWithBlocks(['Hello.'])
      player.pausePlayback()
      expect(player.playbackState.value).toBe('paused')
    })

    it('resumes AudioContext and restores playing state', async () => {
      const player = await startWithBlocks(['Hello.'])
      player.pausePlayback()
      player.resumePlayback()
      expect(mockCtxInstance.resume).toHaveBeenCalled()
      expect(player.playbackState.value).toBe('playing')
    })

    it('does nothing if already playing when resumePlayback called', async () => {
      const player = await startWithBlocks(['Hello.'])
      player.resumePlayback()
      expect(mockCtxInstance.resume).not.toHaveBeenCalled()
    })
  })

  describe('stopPlayback', () => {
    it('stops all scheduled sources', async () => {
      await startWithBlocks(['Block 0.', 'Block 1.'])
      await vi.waitFor(() => expect(mockCtxInstance.createdSources.length).toBeGreaterThanOrEqual(1))
      const player = useTtsPlayer()
      player.stopPlayback()
      for (const src of mockCtxInstance.createdSources) {
        expect(src.stop).toHaveBeenCalled()
      }
    })

    it('sets playbackState to idle', async () => {
      const player = await startWithBlocks(['Hello.'])
      player.stopPlayback()
      expect(player.playbackState.value).toBe('idle')
    })

    it('clears currentBook', async () => {
      const player = await startWithBlocks(['Hello.'])
      player.stopPlayback()
      expect(player.currentBook.value).toBeNull()
    })

    it('sets isActive to false', async () => {
      const player = await startWithBlocks(['Hello.'])
      player.stopPlayback()
      expect(player.isActive.value).toBe(false)
    })
  })

  describe('onBlockEnded (block advancement)', () => {
    it('updates currentBlockIndex when block 0 ends and block 1 is already scheduled', async () => {
      const player = await startWithBlocks(['Block 0.', 'Block 1.'])
      await vi.waitFor(() => expect(mockCtxInstance.createdSources.length).toBeGreaterThanOrEqual(2))
      simulateBlockEnd(0)
      await vi.waitFor(() => expect(player.currentBlockIndex.value).toBe(1))
    })

    it('does not advance when playbackState is not playing', async () => {
      const player = await startWithBlocks(['Block 0.', 'Block 1.'])
      player.pausePlayback()
      simulateBlockEnd(0)
      await new Promise((r) => setTimeout(r, 10))
      expect(player.currentBlockIndex.value).toBe(0)
    })

    it('does not fire stale onended after stopPlayback clears sources', async () => {
      const player = await startWithBlocks(['Block 0.', 'Block 1.'])
      player.stopPlayback()
      expect(player.playbackState.value).toBe('idle')
    })

    it('advances chapter when last block ends', async () => {
      const player = useTtsPlayer()
      const textSource = makeTextSource([['Only block.'], ['Ch2 block.']])
      await player.startPlayback(makeBook(), 'p', 'v', 1.0, textSource)
      simulateBlockEnd(0)
      await vi.waitFor(() => expect(player.currentChapterIndex.value).toBe(1))
    })

    it('stops playback when final chapter last block ends', async () => {
      const book = makeBook(1)
      const player = useTtsPlayer()
      await player.startPlayback(book, 'p', 'v', 1.0, makeTextSource([['Only block.']]))
      simulateBlockEnd(0)
      await vi.waitFor(() => expect(player.playbackState.value).toBe('idle'))
    })
  })

  describe('nextBlock / prevBlock', () => {
    it('nextBlock fetches next block', async () => {
      const player = await startWithBlocks(['Block 0.', 'Block 1.', 'Block 2.'])
      vi.clearAllMocks()
      ;(ttsApi.synthesize as Mock).mockResolvedValue({
        ok: true,
        blob: vi
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(8)) }),
      })
      await player.nextBlock()
      expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'Block 1.' }))
      expect(player.currentBlockIndex.value).toBe(1)
    })

    it('prevBlock fetches block 0 when at block 0', async () => {
      const player = await startWithBlocks(['Block 0.', 'Block 1.'])
      vi.clearAllMocks()
      ;(ttsApi.synthesize as Mock).mockResolvedValue({
        ok: true,
        blob: vi
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(8)) }),
      })
      await player.prevBlock()
      expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'Block 0.' }))
      expect(player.currentBlockIndex.value).toBe(0)
    })

    it('nextBlock advances chapter when at last block', async () => {
      const player = useTtsPlayer()
      const textSource = makeTextSource([['Only block.'], ['Ch2 block.']])
      await player.startPlayback(makeBook(), 'p', 'v', 1.0, textSource)
      vi.clearAllMocks()
      ;(ttsApi.synthesize as Mock).mockResolvedValue({
        ok: true,
        blob: vi
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(8)) }),
      })
      await player.nextBlock()
      expect(player.currentChapterIndex.value).toBe(1)
    })
  })

  describe('setSpeed', () => {
    it('cancels pre-scheduled future blocks', async () => {
      await startWithBlocks(['B0.', 'B1.', 'B2.', 'B3.', 'B4.'])
      await vi.waitFor(() => expect(mockCtxInstance.createdSources.length).toBeGreaterThanOrEqual(2))
      const player = useTtsPlayer()
      player.setSpeed(1.5)
      const stoppedCount = mockCtxInstance.createdSources.slice(1).filter((s) => (s.stop as Mock).mock.calls.length > 0).length
      expect(stoppedCount).toBeGreaterThanOrEqual(1)
    })

    it('does not change speed below minimum', () => {
      const player = useTtsPlayer()
      player.setSpeed(0.1)
      expect(player.speed.value).toBe(0.25)
    })

    it('does not change speed above maximum', () => {
      const player = useTtsPlayer()
      player.setSpeed(99)
      expect(player.speed.value).toBe(4.0)
    })

    it('is a no-op when value is unchanged', async () => {
      const player = await startWithBlocks(['Block.'])
      await vi.waitFor(() => expect(mockCtxInstance.createdSources.length).toBeGreaterThanOrEqual(1))
      const srcsBefore = mockCtxInstance.createdSources.length
      player.setSpeed(1.0)
      const stopCallCount = mockCtxInstance.createdSources.slice(0, srcsBefore).filter((s) => (s.stop as Mock).mock.calls.length > 0).length
      expect(stopCallCount).toBe(0)
    })
  })

  describe('setVoice', () => {
    it('updates currentVoiceId and currentProviderId', async () => {
      const player = await startWithBlocks(['Block.'])
      player.setVoice('provider2', 'voice2')
      expect(player.currentVoiceId.value).toBe('voice2')
      expect(player.currentProviderId.value).toBe('provider2')
    })

    it('cancels future pre-scheduled blocks', async () => {
      await startWithBlocks(['B0.', 'B1.', 'B2.', 'B3.', 'B4.'])
      await vi.waitFor(() => expect(mockCtxInstance.createdSources.length).toBeGreaterThanOrEqual(2))
      const player = useTtsPlayer()
      player.setVoice('p2', 'v2')
      const stoppedFuture = mockCtxInstance.createdSources.slice(1).filter((s) => (s.stop as Mock).mock.calls.length > 0).length
      expect(stoppedFuture).toBeGreaterThanOrEqual(1)
    })
  })

  describe('startFromPosition', () => {
    it('jumps to specified block in same chapter', async () => {
      const player = await startWithBlocks(['B0.', 'B1.', 'B2.'])
      vi.clearAllMocks()
      ;(ttsApi.synthesize as Mock).mockResolvedValue({
        ok: true,
        blob: vi
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(8)) }),
      })
      await player.startFromPosition(0, 2)
      expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'B2.' }))
      expect(player.currentBlockIndex.value).toBe(2)
    })

    it('loads new chapter when jumping to different chapter', async () => {
      const player = useTtsPlayer()
      const textSource = makeTextSource([['Ch1 B0.'], ['Ch2 B0.', 'Ch2 B1.']])
      await player.startPlayback(makeBook(), 'p', 'v', 1.0, textSource)
      vi.clearAllMocks()
      ;(ttsApi.synthesize as Mock).mockResolvedValue({
        ok: true,
        blob: vi
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ arrayBuffer: vi.fn<() => Promise<ArrayBuffer>>().mockResolvedValue(new ArrayBuffer(8)) }),
      })
      await player.startFromPosition(1, 1)
      expect(player.currentChapterIndex.value).toBe(1)
      expect(ttsApi.synthesize).toHaveBeenCalledWith(expect.objectContaining({ text: 'Ch2 B1.' }))
    })
  })

  describe('error handling', () => {
    it('sets error state when synthesis fails', async () => {
      ;(ttsApi.synthesize as Mock).mockResolvedValueOnce({ ok: false, status: 500, blob: vi.fn<() => Promise<unknown>>() })
      const player = useTtsPlayer()
      await player.startPlayback(makeBook(), 'p', 'v', 1.0, makeTextSource([['Block.']]))
      expect(player.playbackState.value).toBe('error')
      expect(player.error.value).toContain('Synthesis failed')
    })

    it('sets error state when synthesis throws', async () => {
      ;(ttsApi.synthesize as Mock).mockRejectedValueOnce(new Error('Network error'))
      const player = useTtsPlayer()
      await player.startPlayback(makeBook(), 'p', 'v', 1.0, makeTextSource([['Block.']]))
      expect(player.playbackState.value).toBe('error')
      expect(player.error.value).toBe('Network error')
    })
  })

  describe('increaseSpeed / decreaseSpeed', () => {
    it('increases speed by SPEED_STEP', () => {
      const player = useTtsPlayer()
      player.increaseSpeed()
      expect(player.speed.value).toBe(1.25)
    })

    it('decreases speed by SPEED_STEP', () => {
      const player = useTtsPlayer()
      player.decreaseSpeed()
      expect(player.speed.value).toBe(0.75)
    })
  })

  describe('togglePlayPause', () => {
    it('pauses when playing', async () => {
      const player = await startWithBlocks(['Block.'])
      player.togglePlayPause()
      expect(player.playbackState.value).toBe('paused')
    })

    it('resumes when paused', async () => {
      const player = await startWithBlocks(['Block.'])
      player.pausePlayback()
      player.togglePlayPause()
      expect(player.playbackState.value).toBe('playing')
    })
  })
})
