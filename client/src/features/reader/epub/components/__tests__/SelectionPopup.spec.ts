import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import SelectionPopup from '../SelectionPopup.vue'

const globalStubs = {
  stubs: {
    teleport: true,
    Tooltip: { template: '<div><slot /></div>' },
    TooltipTrigger: { template: '<div><slot /></div>' },
    TooltipContent: { template: '<div><slot /></div>' },
  },
}

function accessibleName(button: DOMWrapper<Element>) {
  return (button.attributes('aria-label') ?? button.text()).trim()
}

function getButtonByName(wrapper: VueWrapper, name: string) {
  const matches = wrapper.findAll('button').filter((button) => accessibleName(button) === name)
  expect(matches, `button named "${name}"`).toHaveLength(1)
  return matches[0]!
}

function mountPopup(props: Partial<InstanceType<typeof SelectionPopup>['$props']> = {}) {
  return mount(SelectionPopup, {
    props: {
      visible: true,
      position: { x: 100, y: 200 },
      showBelow: false,
      selectedText: 'Text',
      overlappingAnnotationId: null,
      isTtsAvailable: false,
      ...props,
    },
    global: globalStubs,
  })
}

describe('SelectionPopup', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('gives every icon-only action a localized accessible name', () => {
    const wrapper = mountPopup({ overlappingAnnotationId: 7, isTtsAvailable: true })

    for (const name of ['Copy', 'Highlight', 'Search', 'Translate', 'Define', 'Add note', 'Delete annotation', 'Read from here']) {
      getButtonByName(wrapper, name)
    }
    for (const button of wrapper.findAll('button')) {
      expect(accessibleName(button)).not.toBe('')
    }
  })

  it('names the highlight style buttons and exposes the selected style', async () => {
    const wrapper = mountPopup()

    await getButtonByName(wrapper, 'Highlight').trigger('click')

    const highlight = getButtonByName(wrapper, 'Highlight style: Highlight')
    const underline = getButtonByName(wrapper, 'Highlight style: Underline')
    const strikethrough = getButtonByName(wrapper, 'Highlight style: Strikethrough')
    const squiggly = getButtonByName(wrapper, 'Highlight style: Squiggly underline')

    expect([highlight, underline, strikethrough, squiggly].map((button) => button.text())).toEqual(['H', 'U', 'S', '~'])
    expect(highlight.attributes('aria-pressed')).toBe('true')
    expect(underline.attributes('aria-pressed')).toBe('false')

    await underline.trigger('click')
    expect(getButtonByName(wrapper, 'Highlight style: Underline').attributes('aria-pressed')).toBe('true')
    expect(getButtonByName(wrapper, 'Highlight style: Highlight').attributes('aria-pressed')).toBe('false')

    for (const button of wrapper.findAll('button')) {
      expect(accessibleName(button)).not.toBe('')
    }
  })

  it('copies selected text to clipboard and emits copy after feedback delay', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn<(value: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    const wrapper = mount(SelectionPopup, {
      props: {
        visible: true,
        position: { x: 100, y: 200 },
        showBelow: false,
        selectedText: 'Important quote',
        overlappingAnnotationId: null,
        isTtsAvailable: true,
      },
      global: globalStubs,
    })

    await wrapper.findAll('button')[0]!.trigger('click')
    await vi.runAllTicks()

    expect(writeText).toHaveBeenCalledWith('Important quote')
    // copy is not emitted yet — waiting for the 1500ms feedback window
    expect(wrapper.emitted('copy')).toBeUndefined()

    await vi.runAllTimersAsync()

    expect(wrapper.emitted('copy')?.length).toBe(1)
    vi.useRealTimers()
  })

  it('emits highlight from picker apply and from second highlight click', async () => {
    const wrapper = mount(SelectionPopup, {
      props: {
        visible: true,
        position: { x: 100, y: 200 },
        showBelow: false,
        selectedText: 'Text',
        overlappingAnnotationId: null,
        isTtsAvailable: true,
      },
      global: globalStubs,
    })

    const highlightButton = wrapper.findAll('button')[1]!
    await highlightButton.trigger('click')

    expect(wrapper.text()).toContain('Apply')

    await wrapper.get('button[class*="flex-1"]').trigger('click')
    expect(wrapper.emitted('highlight')?.[0]).toEqual(['#FACC15', 'highlight'])

    await highlightButton.trigger('click')
    await highlightButton.trigger('click')
    expect(wrapper.emitted('highlight')?.[1]).toEqual(['#FACC15', 'highlight'])
  })

  it('shows KOReader-equivalent highlight colors in the picker', async () => {
    const wrapper = mount(SelectionPopup, {
      props: {
        visible: true,
        position: { x: 100, y: 200 },
        showBelow: false,
        selectedText: 'Text',
        overlappingAnnotationId: null,
        isTtsAvailable: false,
      },
      global: globalStubs,
    })

    const highlightButton = wrapper.findAll('button')[1]!
    await highlightButton.trigger('click')

    expect(wrapper.text()).toContain('Red')
    expect(wrapper.text()).toContain('Olive')
    expect(wrapper.text()).toContain('Cyan')
    expect(wrapper.text()).toContain('Purple')
    expect(wrapper.text()).toContain('Gray')
  })

  it('shows delete action only when overlapping annotation exists', async () => {
    const withDelete = mount(SelectionPopup, {
      props: {
        visible: true,
        position: { x: 100, y: 200 },
        showBelow: false,
        selectedText: 'Text',
        overlappingAnnotationId: 55,
        isTtsAvailable: false,
      },
      global: globalStubs,
    })

    const withoutDelete = mount(SelectionPopup, {
      props: {
        visible: true,
        position: { x: 100, y: 200 },
        showBelow: false,
        selectedText: 'Text',
        overlappingAnnotationId: null,
        isTtsAvailable: false,
      },
      global: globalStubs,
    })

    expect(withDelete.findAll('button').length).toBeGreaterThan(withoutDelete.findAll('button').length)

    const deleteButtons = withDelete.findAll('button')
    const deleteButton = deleteButtons[deleteButtons.length - 1]
    await deleteButton?.trigger('click')

    expect(withDelete.emitted('deleteAnnotation')?.[0]).toEqual([55])
  })
})
