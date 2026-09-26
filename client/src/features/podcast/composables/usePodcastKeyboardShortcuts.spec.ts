import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePodcastKeyboardShortcuts } from './usePodcastKeyboardShortcuts'
import { usePodcastShortcuts } from './usePodcastShortcuts'

const playerMocks = vi.hoisted(() => ({
  episode: { value: { id: 42 } as { id: number } | null },
  togglePlayback: vi.fn<() => void>(),
  skipBackward: vi.fn<() => void>(),
  skipForward: vi.fn<() => void>(),
  playNext: vi.fn<() => Promise<void>>(async () => undefined),
  playPrevious: vi.fn<() => Promise<void>>(async () => undefined),
  stepPlaybackRate: vi.fn<(direction: -1 | 1) => void>(),
  toggleMute: vi.fn<() => void>(),
  setVolume: vi.fn<(volume: number) => void>(),
  volume: { value: 0.5 },
}))
const route = vi.hoisted(() => ({ name: 'podcast-player' as string, meta: {} as Record<string, unknown> }))

vi.mock('vue-router', () => ({ useRoute: () => route }))
vi.mock('./usePodcastPlayer', () => ({ usePodcastPlayer: () => playerMocks }))

function mountHarness() {
  return mount(
    defineComponent({
      setup() {
        usePodcastKeyboardShortcuts()
        return () =>
          h('div', [
            h('button', { id: 'control' }, 'Control'),
            h('input', { id: 'field' }),
            h('div', { role: 'menu' }, [h('button', { id: 'menu-item', role: 'menuitem' }, 'Item')]),
            h('section', { 'data-podcast-mini-player': '' }, [h('button', { id: 'mini-control' }, 'Mini')]),
          ])
      },
    }),
    { attachTo: document.body },
  )
}

function press(key: string, target: Element | null = document.body) {
  const event = new KeyboardEvent('keydown', { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true })
  target?.dispatchEvent(event)
  return event
}

describe('usePodcastKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.name = 'podcast-player'
    route.meta = {}
    playerMocks.episode.value = { id: 42 }
    usePodcastShortcuts().closeShortcuts()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps letter shortcuts working after a control takes focus', () => {
    const wrapper = mountHarness()
    const control = document.getElementById('control')

    press('l', control)
    press('j', control)
    press('n', control)
    press('p', control)

    expect(playerMocks.skipForward).toHaveBeenCalledOnce()
    expect(playerMocks.skipBackward).toHaveBeenCalledOnce()
    expect(playerMocks.playNext).toHaveBeenCalledOnce()
    expect(playerMocks.playPrevious).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('leaves Space to the focused control but still toggles from the page', () => {
    const wrapper = mountHarness()

    press(' ', document.getElementById('control'))
    expect(playerMocks.togglePlayback).not.toHaveBeenCalled()

    const event = press(' ', document.body)
    expect(playerMocks.togglePlayback).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('ignores shortcuts typed into a text field', () => {
    const wrapper = mountHarness()

    press('l', document.getElementById('field'))

    expect(playerMocks.skipForward).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('leaves arrow keys to a menu that owns them', () => {
    const wrapper = mountHarness()

    press('ArrowRight', document.getElementById('menu-item'))

    expect(playerMocks.skipForward).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('drives playback from anywhere the mini player is on screen', () => {
    route.name = 'podcast-library'
    const wrapper = mountHarness()

    press('l', document.body)
    expect(playerMocks.skipForward).toHaveBeenCalledOnce()

    press('ArrowRight', document.body)
    expect(playerMocks.skipForward).toHaveBeenCalledOnce()

    press('ArrowRight', document.getElementById('mini-control'))
    expect(playerMocks.skipForward).toHaveBeenCalledTimes(2)
    wrapper.unmount()
  })

  it('does nothing without a loaded episode or on a public route', () => {
    playerMocks.episode.value = null
    const wrapper = mountHarness()

    press('l', document.body)
    expect(playerMocks.skipForward).not.toHaveBeenCalled()

    playerMocks.episode.value = { id: 42 }
    route.meta = { public: true }
    press('l', document.body)
    expect(playerMocks.skipForward).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('toggles the shortcut overlay with the question mark key', () => {
    const wrapper = mountHarness()
    const { open } = usePodcastShortcuts()

    press('?', document.getElementById('control'))
    expect(open.value).toBe(true)

    press('?', document.getElementById('control'))
    expect(open.value).toBe(false)
    wrapper.unmount()
  })

  it('changes speed, mute, and volume with the expanded shortcuts', () => {
    const wrapper = mountHarness()

    press('>')
    press('<')
    press('m')
    const volumeUp = press('ArrowUp')
    const volumeDown = press('ArrowDown')

    expect(playerMocks.stepPlaybackRate).toHaveBeenNthCalledWith(1, 1)
    expect(playerMocks.stepPlaybackRate).toHaveBeenNthCalledWith(2, -1)
    expect(playerMocks.toggleMute).toHaveBeenCalledOnce()
    expect(playerMocks.setVolume).toHaveBeenNthCalledWith(1, 0.55)
    expect(playerMocks.setVolume).toHaveBeenNthCalledWith(2, 0.45)
    expect(volumeUp.defaultPrevented).toBe(true)
    expect(volumeDown.defaultPrevented).toBe(true)
    wrapper.unmount()
  })

  it('requests the bookmark composer only on the full player route', () => {
    const wrapper = mountHarness()
    const { bookmarkComposerRequest } = usePodcastShortcuts()
    const before = bookmarkComposerRequest.value

    press('b')
    expect(bookmarkComposerRequest.value).toBe(before + 1)

    route.name = 'podcast-library'
    press('b')
    expect(bookmarkComposerRequest.value).toBe(before + 1)
    wrapper.unmount()
  })
})
