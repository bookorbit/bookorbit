import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MediaScrubber from '../MediaScrubber.vue'
import MediaVolumeControl from '../MediaVolumeControl.vue'

const popoverStubs = {
  Popover: { template: '<div><slot /></div>' },
  PopoverTrigger: { template: '<div><slot /></div>' },
  PopoverContent: { template: '<div><slot /></div>' },
}

function mountControl(props: { volume: number; variant?: 'inline' | 'popover' }) {
  return mount(MediaVolumeControl, { props, global: { stubs: popoverStubs } })
}

describe('MediaVolumeControl', () => {
  it('cycles the speaker icon through silent, low, and high volume', () => {
    expect(mountControl({ volume: 0 }).find('.lucide-volume-x').exists()).toBe(true)
    expect(mountControl({ volume: 0.3 }).find('.lucide-volume-1').exists()).toBe(true)
    expect(mountControl({ volume: 0.5 }).find('.lucide-volume-2').exists()).toBe(true)
  })

  it('labels the toggle by what the next click does', () => {
    expect(mountControl({ volume: 0.8 }).get('button').attributes('aria-label')).toBe('Mute')

    const muted = mountControl({ volume: 0 })
    expect(muted.get('button').attributes('aria-label')).toBe('Unmute')
    expect(muted.get('button').attributes('aria-pressed')).toBe('true')
  })

  it('leaves the mute decision to the caller', async () => {
    const wrapper = mountControl({ volume: 0.8 })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('toggleMute')).toHaveLength(1)
    expect(wrapper.emitted('update:volume')).toBeUndefined()
  })

  it('reports slider movement as a volume update', async () => {
    const wrapper = mountControl({ volume: 0.8 })

    wrapper.getComponent(MediaScrubber).vm.$emit('seek', 0.25)

    expect(wrapper.emitted('update:volume')).toEqual([[0.25]])
  })

  it('drives the slider live so the level follows the drag', () => {
    const scrubber = mountControl({ volume: 0.42 }).getComponent(MediaScrubber)

    expect(scrubber.props('continuous')).toBe(true)
    expect(scrubber.props('duration')).toBe(1)
    expect(scrubber.props('current')).toBe(0.42)
    expect(scrubber.props('ariaValueText')).toBe('42%')
  })

  it('renders the inline variant as one row with a percent readout', () => {
    const wrapper = mountControl({ volume: 0.42, variant: 'inline' })

    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.text()).toContain('42%')
  })

  it('renders the popover variant behind an icon-only trigger', () => {
    const wrapper = mountControl({ volume: 0.42, variant: 'popover' })

    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(2)
    expect(buttons[0]!.attributes('aria-label')).toBe('Volume')
    expect(buttons[0]!.text()).toBe('')
    expect(buttons[1]!.attributes('aria-label')).toBe('Mute')
    expect(wrapper.findComponent(MediaScrubber).exists()).toBe(true)
  })
})
