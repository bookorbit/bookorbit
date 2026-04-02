import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ReaderSettingsPanel from '../ReaderSettingsPanel.vue'
import type { ReaderState } from '../../composables/useReaderState'

function makeState(overrides: Partial<ReaderState> = {}): ReaderState {
  return {
    fontSize: 16,
    lineHeight: 1.5,
    fontFamily: null,
    maxColumnCount: 2,
    gap: 0.05,
    maxInlineSize: 720,
    maxBlockSize: 1440,
    justify: true,
    hyphenate: true,
    isDark: false,
    themeName: 'default',
    flow: 'paginated',
    ...overrides,
  }
}

describe('ReaderSettingsPanel', () => {
  it('emits incremental updates from text controls', async () => {
    const wrapper = mount(ReaderSettingsPanel, {
      props: {
        state: makeState(),
      },
    })

    const textTab = wrapper.findAll('button').find((btn) => btn.text().includes('Text'))
    await textTab?.trigger('click')

    const plusButtons = wrapper.findAll('button').filter((btn) => btn.text() === '+')
    await plusButtons[0]!.trigger('click')

    expect(wrapper.emitted('update')?.[0]).toEqual([{ fontSize: 17 }])
  })

  it('emits appearance and layout toggles', async () => {
    const wrapper = mount(ReaderSettingsPanel, {
      props: {
        state: makeState({ isDark: false, flow: 'paginated' }),
      },
    })

    const darkButton = wrapper.findAll('button').find((btn) => btn.text().includes('Dark'))
    await darkButton?.trigger('click')
    expect(wrapper.emitted('update')?.[0]).toEqual([{ isDark: true }])

    const layoutTab = wrapper.findAll('button').find((btn) => btn.text().includes('Layout'))
    await layoutTab?.trigger('click')

    const scrolledButton = wrapper.findAll('button').find((btn) => btn.text().includes('Scrolled'))
    await scrolledButton?.trigger('click')

    expect(wrapper.emitted('update')?.[1]).toEqual([{ flow: 'scrolled' }])
  })
})
