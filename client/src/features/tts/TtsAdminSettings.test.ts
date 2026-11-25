import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import * as apiClient from '@/lib/api'
import TtsAdminSettings from './TtsAdminSettings.vue'
import TtsOpenAiVoiceCuration from './TtsOpenAiVoiceCuration.vue'
import TtsAdminProviderCard from './components/TtsAdminProviderCard.vue'
import TtsAdminVoiceChips from './components/TtsAdminVoiceChips.vue'
import * as ttsApi from './api/tts.api'
import type { StaticVoiceConfig, TtsDbProvider } from './api/tts.api'
import type { TtsAdminProvider, TtsAdminVoice } from './composables/useTtsAdminProviders'

const KOKORO_VOICES: StaticVoiceConfig[] = [
  { id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' },
  { id: 'am_adam', name: 'Adam', shortName: 'am_adam', language: 'English', locale: 'en-US', gender: 'Male' },
]

const KOKORO: TtsDbProvider = {
  id: 1,
  name: 'Kokoro',
  type: 'openai-compatible',
  enabled: true,
  baseUrl: 'http://localhost:8880/v1',
  apiKey: null,
  defaultModel: 'kokoro',
  displayOrder: 1,
  staticVoices: KOKORO_VOICES,
  supportsVoiceDiscovery: true,
}

const PIPER: TtsDbProvider = {
  ...KOKORO,
  id: 2,
  name: 'Piper',
  baseUrl: 'http://192.168.1.40:5000/v1',
  displayOrder: 2,
  staticVoices: [],
  enabled: false,
}

function stubApi(overrides: { providers?: TtsDbProvider[] } = {}) {
  vi.spyOn(ttsApi, 'getAdminProviders').mockResolvedValue(overrides.providers ?? [KOKORO, PIPER])
}

async function mountSettings() {
  const wrapper = mount(TtsAdminSettings, {
    global: { stubs: { teleport: true, VueDraggable: { template: '<div><slot /></div>' } } },
  })
  await flushPromises()
  return wrapper
}

describe('TtsAdminSettings', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders a card for every configured provider', async () => {
    stubApi()
    const wrapper = await mountSettings()

    const cards = wrapper.findAllComponents(TtsAdminProviderCard)
    expect(cards).toHaveLength(2)
    expect(cards.map((card) => card.props('provider').name)).toEqual(['Kokoro', 'Piper'])
  })

  it('orders cards by display order rather than by id', async () => {
    stubApi({
      providers: [
        { ...KOKORO, displayOrder: 3 },
        { ...PIPER, displayOrder: 1 },
      ],
    })
    const wrapper = await mountSettings()

    const names = wrapper.findAllComponents(TtsAdminProviderCard).map((card) => card.props('provider').name)
    expect(names).toEqual(['Piper', 'Kokoro'])
  })

  it('submits the complete provider order when a card is moved', async () => {
    stubApi()
    const reorder = vi.spyOn(ttsApi, 'reorderProviders').mockResolvedValue()
    const wrapper = await mountSettings()

    await wrapper.findAllComponents(TtsAdminProviderCard)[1]!.vm.$emit('move-up')
    await flushPromises()

    expect(reorder).toHaveBeenCalledWith(['2', '1'])
  })

  it('restores the previous order when the reorder request fails', async () => {
    stubApi()
    vi.spyOn(ttsApi, 'reorderProviders').mockRejectedValue(new Error('boom'))
    const wrapper = await mountSettings()

    await wrapper.findAllComponents(TtsAdminProviderCard)[1]!.vm.$emit('move-up')
    await flushPromises()

    const names = wrapper.findAllComponents(TtsAdminProviderCard).map((card) => card.props('provider').name)
    expect(names).toEqual(['Kokoro', 'Piper'])
  })

  it('lists the curated voices of a provider', async () => {
    stubApi()
    const wrapper = await mountSettings()

    const kokoro = wrapper.findAllComponents(TtsAdminProviderCard)[0]!
    expect(kokoro.props('provider').voices.map((voice) => voice.id)).toEqual(['af_heart', 'am_adam'])
  })

  it('adds the first PocketTTS voice with discovery off and retries a failed save', async () => {
    const provider = {
      ...PIPER,
      name: 'LocalAI',
      baseUrl: 'http://localhost:8080/v1',
      enabled: true,
      defaultModel: 'pocket-tts',
      supportsVoiceDiscovery: false,
      staticVoices: null,
    }
    const voice: StaticVoiceConfig = { id: 'alba', name: 'Alba', shortName: 'alba', language: '', locale: '', gender: 'Unknown' }
    const request = vi
      .spyOn(apiClient, 'api')
      .mockResolvedValueOnce(Response.json([]))
      .mockResolvedValueOnce(Response.json(provider, { status: 201 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(Response.json({ ...provider, staticVoices: [voice] }))
    const wrapper = await mountSettings()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Add provider')!
      .trigger('click')
    const providerForm = wrapper.get('form')
    await providerForm.get('#tts-provider-name').setValue(provider.name)
    await providerForm.get('#tts-provider-url').setValue(provider.baseUrl)
    await providerForm.get('#tts-provider-model').setValue(provider.defaultModel)
    await providerForm.get('input[type="checkbox"]').setValue(false)
    await providerForm.trigger('submit')
    await flushPromises()
    expect(request).toHaveBeenNthCalledWith(
      2,
      '/api/v1/tts/admin/providers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: provider.name,
          baseUrl: provider.baseUrl,
          defaultModel: provider.defaultModel,
          supportsVoiceDiscovery: false,
        }),
      }),
    )

    await wrapper.get('button[aria-expanded="false"]').trigger('click')
    const manageVoices = wrapper.findAll('button').find((button) => button.text() === 'Manage voices')!
    await manageVoices.trigger('click')
    const dialog = wrapper.getComponent(TtsOpenAiVoiceCuration)
    expect(dialog.get<HTMLButtonElement>('[data-testid="import-from-provider"]').element.disabled).toBe(true)
    expect(dialog.findAll('button').some((button) => button.text().includes('preset'))).toBe(false)
    await dialog
      .findAll('button')
      .find((button) => button.text() === 'Add voice')!
      .trigger('click')
    const voiceForm = dialog.get('form')
    await voiceForm.get('input[name="voice-id"]').setValue(' alba ')
    await voiceForm.get('input[name="voice-name"]').setValue(' Alba ')
    await voiceForm.trigger('submit')

    const save = dialog.findAll<HTMLButtonElement>('button').find((button) => button.text() === 'Save 1 voice')!
    expect(save.element.disabled).toBe(false)
    await save.trigger('click')
    await flushPromises()
    expect(dialog.get('[role="alert"]').text()).toContain('Failed to save LocalAI')
    expect(save.element.disabled).toBe(false)
    await save.trigger('click')
    await flushPromises()

    for (const attempt of [3, 4]) {
      expect(request).toHaveBeenNthCalledWith(
        attempt,
        '/api/v1/tts/admin/providers/2',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ staticVoices: [voice] }) }),
      )
    }
    expect(dialog.find('[role="alert"]').exists()).toBe(false)
    expect(save.element.disabled).toBe(true)
    await dialog.get('button[aria-label="Close"]').trigger('click')
    await manageVoices.trigger('click')
    expect(wrapper.getComponent(TtsOpenAiVoiceCuration).find('button[aria-label="Edit Alba"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('toggles a provider through the provider update route', async () => {
    stubApi()
    const update = vi.spyOn(ttsApi, 'updateProvider').mockResolvedValue({ ...KOKORO, enabled: false })
    const wrapper = await mountSettings()

    await wrapper.findAllComponents(TtsAdminProviderCard)[0]!.vm.$emit('set-enabled', false)
    await flushPromises()

    expect(update).toHaveBeenCalledWith(1, { enabled: false })
  })

  it('previews a voice through the provider key rather than the numeric id', async () => {
    stubApi()
    const preview = vi.spyOn(ttsApi, 'previewVoice').mockResolvedValue(new Response(new Blob(), { status: 200 }))
    const wrapper = await mountSettings()

    const kokoro = wrapper.findAllComponents(TtsAdminProviderCard)[0]!
    await kokoro.vm.$emit('preview', kokoro.props('provider').voices[0])
    await flushPromises()

    expect(preview).toHaveBeenCalledWith('1', 'af_heart')
  })
})

describe('TtsAdminProviderCard', () => {
  function mountCard(provider: Partial<TtsAdminProvider> = {}) {
    return mount(TtsAdminProviderCard, {
      props: {
        provider: {
          key: '1',
          id: 1,
          name: 'Kokoro',
          baseUrl: 'http://localhost:8880/v1',
          apiKey: null,
          defaultModel: 'kokoro',
          enabled: true,
          supportsVoiceDiscovery: true,
          voices: [
            {
              id: 'af_heart',
              name: 'Heart',
              gender: 'Female',
              languageName: 'English',
              countryName: 'United States',
              groupLabel: 'English · United States',
            },
          ],
          ...provider,
        },
        expanded: false,
        health: undefined,
        testing: false,
        deleting: false,
        playingVoiceKey: null,
        previewLoadingKey: null,
        canMoveUp: true,
        canMoveDown: true,
      },
    })
  }

  it('shows a single status phrase for an enabled provider', () => {
    const wrapper = mountCard()
    expect(wrapper.text()).toContain('Not checked')
    expect(wrapper.text()).toContain('1 voice')
  })

  it('drops the health phrase entirely when the provider is disabled', () => {
    const wrapper = mountCard({ enabled: false })
    expect(wrapper.text()).not.toContain('Not checked')
    expect(wrapper.text()).toContain('1 voice')
  })

  it('offers the connection test and delete actions once expanded', async () => {
    const wrapper = mountCard()
    await wrapper.setProps({ expanded: true })
    expect(wrapper.text()).toContain('Test connection')
    expect(wrapper.text()).toContain('Delete')
  })
})

describe('TtsAdminVoiceChips', () => {
  const VOICES: TtsAdminVoice[] = [
    { id: 'a', name: 'Aria', gender: 'Female', languageName: 'English', countryName: 'United States', groupLabel: 'English · United States' },
    { id: 'b', name: 'Katja', gender: 'Female', languageName: 'German', countryName: 'Germany', groupLabel: 'German · Germany' },
  ]

  function mountChips(props: Partial<InstanceType<typeof TtsAdminVoiceChips>['$props']> = {}) {
    return mount(TtsAdminVoiceChips, {
      props: { voices: VOICES, providerKey: '1', playingVoiceKey: null, loadingVoiceKey: null, canPreview: true, ...props },
    })
  }

  it('groups voices under language headings when a provider spans locales', () => {
    const wrapper = mountChips()
    expect(wrapper.text()).toContain('English · United States')
    expect(wrapper.text()).toContain('German · Germany')
  })

  it('omits the heading when every voice shares one locale', () => {
    const wrapper = mountChips({ voices: [VOICES[0]!] })
    expect(wrapper.text()).not.toContain('English · United States')
    expect(wrapper.text()).toContain('Aria')
  })

  it('disables preview when the provider is disabled', () => {
    const wrapper = mountChips({ canPreview: false })
    expect(wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(true)
  })

  it('emits the voice to preview when a chip is clicked', async () => {
    const wrapper = mountChips()
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('preview')?.[0]?.[0]).toMatchObject({ id: 'a' })
  })
})
