import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReaderFooter from '../ReaderFooter.vue'

const globalStubs = {
  stubs: {
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
  },
}

const defaultProps = {
  fraction: 0.33,
  sectionIndex: 2,
  totalSections: 5,
  sectionFractions: [0, 0.2, 0.4, 0.6, 0.8, 1],
  chapterStartFraction: 0.2,
  chapterEndFraction: 0.4,
  locationTotal: 100,
}

describe('ReaderFooter', () => {
  it('disables previous button on first section and next button on last section', async () => {
    const first = mount(ReaderFooter, {
      props: {
        ...defaultProps,
        fraction: 0.1,
        sectionIndex: 0,
        totalSections: 5,
      },
      global: globalStubs,
    })

    const firstPrevButton = first.get('button[aria-label="Previous section"]')
    const firstNextButton = first.get('button[aria-label="Next section"]')
    expect(firstPrevButton.attributes('disabled')).toBeDefined()
    expect(firstNextButton.attributes('disabled')).toBeUndefined()

    const last = mount(ReaderFooter, {
      props: {
        ...defaultProps,
        fraction: 0.9,
        sectionIndex: 4,
        totalSections: 5,
      },
      global: globalStubs,
    })

    const lastNextButton = last.get('button[aria-label="Next section"]')
    expect(lastNextButton.attributes('disabled')).toBeDefined()
  })

  it('emits prev/next section and seek events', async () => {
    const wrapper = mount(ReaderFooter, {
      props: defaultProps,
      global: globalStubs,
    })

    await wrapper.get('button[aria-label="Previous section"]').trigger('click')
    await wrapper.get('button[aria-label="Next section"]').trigger('click')

    const slider = wrapper.get('input[type="range"]')
    await slider.setValue('0.42')

    expect(wrapper.emitted('prevSection')?.length).toBe(1)
    expect(wrapper.emitted('nextSection')?.length).toBe(1)
    expect(wrapper.emitted('seek')?.[0]).toEqual([0.42])
  })

  it('renders the chapter progress segment', () => {
    const wrapper = mount(ReaderFooter, {
      props: {
        ...defaultProps,
        chapterStartFraction: 0.2,
        chapterEndFraction: 0.4,
      },
      global: globalStubs,
    })

    const segment = wrapper.find('[class*="pointer-events-none"][class*="rounded-full"]')
    expect(segment.exists()).toBe(true)
    expect(segment.attributes('style')).toContain('left: 20%')
    expect(segment.attributes('style')).toContain('width: 20%')
  })

  it('does not render chapter segment when start equals end', () => {
    const wrapper = mount(ReaderFooter, {
      props: {
        ...defaultProps,
        chapterStartFraction: 0.5,
        chapterEndFraction: 0.5,
      },
      global: globalStubs,
    })

    const segments = wrapper.findAll('[class*="pointer-events-none"][class*="rounded-full"]')
    expect(segments.length).toBe(0)
  })

  it('shows percentage display by default', () => {
    const wrapper = mount(ReaderFooter, {
      props: defaultProps,
      global: globalStubs,
    })

    const pctDisplay = wrapper.find('button[aria-label="Jump to location"]')
    expect(pctDisplay.exists()).toBe(true)
    expect(pctDisplay.text()).toContain('33%')
  })

  it('shows go-to input when percentage is clicked', async () => {
    const wrapper = mount(ReaderFooter, {
      props: defaultProps,
      global: globalStubs,
    })

    const pctDisplay = wrapper.find('button[aria-label="Jump to location"]')
    await pctDisplay.trigger('click')

    const input = wrapper.find('input[type="text"]')
    expect(input.exists()).toBe(true)
    expect(input.attributes('placeholder')).toBe('45 or p123')
  })

  it('emits seek with correct fraction when percentage is entered', async () => {
    const wrapper = mount(ReaderFooter, {
      props: defaultProps,
      global: globalStubs,
    })

    const pctDisplay = wrapper.find('button[aria-label="Jump to location"]')
    await pctDisplay.trigger('click')

    const input = wrapper.find('input[type="text"]')
    await input.setValue('50')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('seek')?.[0]).toEqual([0.5])
  })

  it('emits seek with correct fraction for page input', async () => {
    const wrapper = mount(ReaderFooter, {
      props: { ...defaultProps, locationTotal: 200 },
      global: globalStubs,
    })

    const pctDisplay = wrapper.find('button[aria-label="Jump to location"]')
    await pctDisplay.trigger('click')

    const input = wrapper.find('input[type="text"]')
    await input.setValue('p101')
    await input.trigger('keydown.enter')

    expect(wrapper.emitted('seek')?.[0]).toEqual([100 / 200])
  })

  it('blocks navigation controls when navigation is locked', async () => {
    const wrapper = mount(ReaderFooter, {
      props: {
        ...defaultProps,
        navigationLocked: true,
      },
      global: globalStubs,
    })

    expect(wrapper.get('button[aria-label="Previous section"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[aria-label="Next section"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button[aria-label="Jump to location"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type="range"]').attributes('disabled')).toBeDefined()

    await wrapper.get('button[aria-label="Previous section"]').trigger('click')
    await wrapper.get('button[aria-label="Next section"]').trigger('click')
    await wrapper.get('input[type="range"]').setValue('0.55')
    await wrapper.get('button[aria-label="Jump to location"]').trigger('click')

    expect(wrapper.emitted('prevSection')).toBeUndefined()
    expect(wrapper.emitted('nextSection')).toBeUndefined()
    expect(wrapper.emitted('seek')).toBeUndefined()
    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
  })

  it('closes go-to input on Escape', async () => {
    const wrapper = mount(ReaderFooter, {
      props: defaultProps,
      global: globalStubs,
    })

    const pctDisplay = wrapper.find('button[aria-label="Jump to location"]')
    await pctDisplay.trigger('click')

    expect(wrapper.find('input[type="text"]').exists()).toBe(true)

    const input = wrapper.find('input[type="text"]')
    await input.trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('input[type="text"]').exists()).toBe(false)
  })
})
