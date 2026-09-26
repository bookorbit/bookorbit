import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaTransport from '../MediaTransport.vue'

const labels = {
  play: 'Play',
  pause: 'Pause',
  previous: 'Previous episode',
  next: 'Next episode',
  back: 'Back 15 seconds',
  forward: 'Forward 30 seconds',
}

function mountTransport(props: Partial<InstanceType<typeof MediaTransport>['$props']> = {}) {
  return mount(MediaTransport, {
    props: {
      playing: false,
      hasPrevious: true,
      hasNext: true,
      skipBackSeconds: 15,
      skipForwardSeconds: 30,
      labels,
      ...props,
    },
  })
}

describe('MediaTransport', () => {
  it('shows play, pause, and pending states on the main button', () => {
    const idle = mountTransport()
    expect(idle.find('.lucide-play').exists()).toBe(true)
    expect(idle.find('[aria-label="Play"]').exists()).toBe(true)

    const playing = mountTransport({ playing: true })
    expect(playing.find('.lucide-pause').exists()).toBe(true)
    expect(playing.find('[aria-label="Pause"]').exists()).toBe(true)

    const pending = mountTransport({ playing: true, pending: true })
    expect(pending.find('.lucide-loader-circle').exists()).toBe(true)
    expect(pending.find('.lucide-pause').exists()).toBe(false)
    expect(pending.find('.lucide-play').exists()).toBe(false)
  })

  it('keeps the main button operable while pending so a stalled stream can still be paused', async () => {
    const wrapper = mountTransport({ playing: true, pending: true })

    await wrapper.get('[aria-label="Pause"]').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('disables queue navigation with nothing to navigate to', () => {
    const wrapper = mountTransport({ hasPrevious: false, hasNext: false })

    expect(wrapper.get('[aria-label="Previous episode"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="Next episode"]').attributes('disabled')).toBeDefined()
  })

  it('emits one event per control', async () => {
    const wrapper = mountTransport()

    await wrapper.get('[aria-label="Previous episode"]').trigger('click')
    await wrapper.get('[aria-label="Back 15 seconds"]').trigger('click')
    await wrapper.get('[aria-label="Play"]').trigger('click')
    await wrapper.get('[aria-label="Forward 30 seconds"]').trigger('click')
    await wrapper.get('[aria-label="Next episode"]').trigger('click')

    expect(wrapper.emitted('previous')).toHaveLength(1)
    expect(wrapper.emitted('skipBack')).toHaveLength(1)
    expect(wrapper.emitted('toggle')).toHaveLength(1)
    expect(wrapper.emitted('skipForward')).toHaveLength(1)
    expect(wrapper.emitted('next')).toHaveLength(1)
  })

  it('badges the skip buttons with their own interval', () => {
    const wrapper = mountTransport({ skipBackSeconds: 10, skipForwardSeconds: 45 })

    expect(wrapper.get('[aria-label="Back 15 seconds"]').text()).toBe('10')
    expect(wrapper.get('[aria-label="Forward 30 seconds"]').text()).toBe('45')
  })

  it('grows the main button for the full-player size', () => {
    expect(mountTransport({ size: 'md' }).get('[aria-label="Play"]').classes()).toContain('size-10')
    expect(mountTransport({ size: 'lg' }).get('[aria-label="Play"]').classes()).toContain('size-16')
  })

  it('rings the main button only when the caller opts in and playback is running', () => {
    expect(mountTransport({ playing: true }).find('[data-testid="media-transport-pulse"]').exists()).toBe(false)
    expect(mountTransport({ playing: false, pulse: true }).find('[data-testid="media-transport-pulse"]').exists()).toBe(false)
    expect(mountTransport({ playing: true, pulse: true }).find('[data-testid="media-transport-pulse"]').exists()).toBe(true)
  })
})
