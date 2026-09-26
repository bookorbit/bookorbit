import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import type { TtsVoice } from '@bookorbit/types'
import TtsMiniPlayer from './TtsMiniPlayer.vue'
import * as ttsApi from '../api/tts.api'
import { useTtsPlayer } from '../composables/useTtsPlayer'
import { useTtsVoices } from '../composables/useTtsVoices'

vi.mock('../composables/useTtsPlayer', async () => {
  const { ref } = await import('vue')
  const state = {
    playbackState: ref('idle'),
    currentBook: ref(null),
    currentBlockIndex: ref(0),
    currentChapterIndex: ref(0),
    speed: ref(1),
    currentProviderId: ref(null),
    currentVoiceId: ref(null),
    togglePlayPause: () => {},
  }
  return { useTtsPlayer: () => state }
})

const HEART: TtsVoice = {
  id: 'af_heart',
  name: 'Heart',
  shortName: 'af_heart',
  language: 'English',
  locale: 'en-US',
  gender: 'Female',
  providerId: '1',
  providerName: 'Kokoro',
}

function mountPlayer() {
  return mount(TtsMiniPlayer, { global: { stubs: { TtsMiniPlayerExpanded: true } } })
}

enableAutoUnmount(afterEach)

describe('TtsMiniPlayer', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    useTtsPlayer().playbackState.value = 'idle'
    useTtsVoices().allVoices.value = []
  })

  // The player is mounted app-wide, so a voices request while idle fires on the signed-out reset,
  // magic-link and sign-in pages, where its 401 used to send the page to /login (issue 1503).
  it('does not request voices while nothing is playing', async () => {
    const getVoices = vi.spyOn(ttsApi, 'getVoices').mockResolvedValue([])

    mountPlayer()
    await flushPromises()

    expect(getVoices).not.toHaveBeenCalled()
  })

  it('loads voices once playback starts', async () => {
    const getVoices = vi.spyOn(ttsApi, 'getVoices').mockResolvedValue([HEART])
    mountPlayer()
    await flushPromises()

    useTtsPlayer().playbackState.value = 'playing'
    await flushPromises()

    expect(getVoices).toHaveBeenCalledTimes(1)
    expect(useTtsVoices().allVoices.value).toEqual([HEART])
  })

  it('keeps the voices it already has when playback starts again', async () => {
    useTtsVoices().allVoices.value = [HEART]
    const getVoices = vi.spyOn(ttsApi, 'getVoices').mockResolvedValue([])
    mountPlayer()

    useTtsPlayer().playbackState.value = 'playing'
    await flushPromises()

    expect(getVoices).not.toHaveBeenCalled()
  })
})
