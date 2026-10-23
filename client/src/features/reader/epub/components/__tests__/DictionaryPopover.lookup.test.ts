import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import DictionaryPopover from '../DictionaryPopover.vue'

enableAutoUnmount(afterEach)

const definitionUrl = 'https://en.wiktionary.org/api/rest_v1/page/definition/nada'
const payload = {
  en: [{ partOfSpeech: 'Pronoun', definitions: [{ definition: 'English sense.' }] }],
  pt: [{ partOfSpeech: 'Pronoun', definitions: [{ definition: '<b>nothing</b>', examples: ['Não há nada.'] }] }],
}

function mountPopover(lang: string) {
  return mount(DictionaryPopover, {
    props: { word: 'nada', lang, position: { x: 200, y: 300, showBelow: false } },
    global: { stubs: { teleport: true } },
  })
}

describe('DictionaryPopover with the actual dictionary lookup', () => {
  const fetchMock = vi.fn<typeof fetch>()
  let previousLocale: typeof i18n.global.locale.value

  beforeEach(() => {
    previousLocale = i18n.global.locale.value
    i18n.global.locale.value = 'en'
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    i18n.global.locale.value = previousLocale
    vi.unstubAllGlobals()
  })

  it.each(['pt', 'pt-BR'])('renders Portuguese definitions for %s instead of the unsupported-endpoint error', async (lang) => {
    fetchMock.mockImplementation(async (input) =>
      String(input) === definitionUrl ? new Response(JSON.stringify(payload)) : new Response('{}', { status: 501 }),
    )
    const wrapper = mountPopover(lang)
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(definitionUrl)
    expect(wrapper.text()).toContain('nothing')
    expect(wrapper.text()).not.toContain('English sense.')
    expect(wrapper.text()).not.toContain('Could not load definition')
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('handles an upstream 501 and recovers on Retry using the same language', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 501 })).mockResolvedValueOnce(new Response(JSON.stringify(payload)))
    const wrapper = mountPopover('pt-BR')
    await flushPromises()

    expect(wrapper.text()).toContain('Could not load definition')
    expect(wrapper.find('button').text()).toBe('Retry')
    await wrapper.find('button').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([definitionUrl, definitionUrl])
    expect(wrapper.text()).toContain('nothing')
    expect(wrapper.text()).not.toContain('English sense.')
    expect(wrapper.text()).not.toContain('Could not load definition')
    expect(wrapper.find('button').exists()).toBe(false)
  })
})
