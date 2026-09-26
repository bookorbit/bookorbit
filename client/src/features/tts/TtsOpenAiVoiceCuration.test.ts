import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import TtsOpenAiVoiceCuration from './TtsOpenAiVoiceCuration.vue'
import type { TtsDbProvider, StaticVoiceConfig } from './api/tts.api'
import * as ttsApi from './api/tts.api'

const BASE_PROVIDER: TtsDbProvider = {
  id: 1,
  name: 'Kokoro TTS',
  type: 'openai-compatible',
  enabled: true,
  baseUrl: 'http://localhost:8000/v1',
  apiKey: null,
  defaultModel: 'kokoro',
  displayOrder: 0,
  staticVoices: null,
  supportsVoiceDiscovery: true,
}

const SAVED_VOICES: StaticVoiceConfig[] = [
  { id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' },
  { id: 'am_adam', name: 'Adam', shortName: 'am_adam', language: 'English', locale: 'en-US', gender: 'Male' },
]

function mountCuration(provider: TtsDbProvider = BASE_PROVIDER) {
  return mount(TtsOpenAiVoiceCuration, {
    props: { provider },
    global: {
      stubs: {
        teleport: true,
        Tooltip: { template: '<div><slot /></div>' },
        TooltipTrigger: { template: '<div><slot /></div>' },
        TooltipContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

describe('TtsOpenAiVoiceCuration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe('initialization', () => {
    it('shows empty state when provider has no static voices', () => {
      const wrapper = mountCuration()
      expect(wrapper.text()).toContain('No voices configured')
    })

    it('shows saved voices when provider has static voices', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      expect(wrapper.text()).toContain('Heart')
      expect(wrapper.text()).toContain('Adam')
    })

    it('shows voice count in header', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      expect(wrapper.text()).toContain('2 voices configured')
    })

    it('shows Load Kokoro preset button for kokoro model', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'kokoro' })
      expect(wrapper.text()).toContain('Load Kokoro preset')
    })

    it('shows Load OpenAI preset button for openai model', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'tts-1' })
      expect(wrapper.text()).toContain('Load OpenAI preset')
    })

    it('does not show preset button when model is unknown', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: null })
      expect(wrapper.text()).not.toContain('Load Kokoro preset')
      expect(wrapper.text()).not.toContain('Load OpenAI preset')
    })

    it('empty state hint mentions import and preset when both are available', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, supportsVoiceDiscovery: true, defaultModel: 'kokoro', staticVoices: null })
      expect(wrapper.text()).toContain('Import from provider or load a preset.')
    })

    it('empty state hint mentions only import when no preset available', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, supportsVoiceDiscovery: true, defaultModel: null, staticVoices: null })
      expect(wrapper.text()).toContain('Import from provider.')
    })

    it('empty state hint mentions only preset when import is disabled', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, supportsVoiceDiscovery: false, defaultModel: 'kokoro', staticVoices: null })
      expect(wrapper.text()).toContain('Load a preset to get started.')
    })

    it('empty state hint mentions manual add when neither available', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, supportsVoiceDiscovery: false, defaultModel: null, staticVoices: null })
      expect(wrapper.text()).toContain('Add voices manually.')
    })
  })

  describe('Import from provider', () => {
    it('calls discoverVoices and merges new voices', async () => {
      vi.spyOn(ttsApi, 'discoverVoices').mockResolvedValue({
        supported: true,
        voices: [
          { id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' },
          { id: 'af_bella', name: 'Bella', shortName: 'af_bella', language: 'English', locale: 'en-US', gender: 'Female' },
        ],
      })
      const wrapper = mountCuration()
      await wrapper.find('[data-testid="import-from-provider"]').trigger('click')
      await vi.waitFor(() => expect(ttsApi.discoverVoices).toHaveBeenCalledWith(1))
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('Heart')
      expect(wrapper.text()).toContain('Bella')
    })

    it('shows error when provider returns unsupported', async () => {
      vi.spyOn(ttsApi, 'discoverVoices').mockResolvedValue({ supported: false, voices: [] })
      const wrapper = mountCuration()
      await wrapper.find('[data-testid="import-from-provider"]').trigger('click')
      await vi.waitFor(() => expect(ttsApi.discoverVoices).toHaveBeenCalled())
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('does not expose a voice list endpoint')
    })

    it('shows error on network failure', async () => {
      vi.spyOn(ttsApi, 'discoverVoices').mockRejectedValue(new Error('ECONNREFUSED'))
      const wrapper = mountCuration()
      await wrapper.find('[data-testid="import-from-provider"]').trigger('click')
      await vi.waitFor(() => expect(ttsApi.discoverVoices).toHaveBeenCalled())
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('ECONNREFUSED')
    })

    it('deduplicates voices by ID when merging', async () => {
      vi.spyOn(ttsApi, 'discoverVoices').mockResolvedValue({
        supported: true,
        voices: [{ id: 'af_heart', name: 'Heart', shortName: 'af_heart', language: 'English', locale: 'en-US', gender: 'Female' }],
      })
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      await wrapper.find('[data-testid="import-from-provider"]').trigger('click')
      await vi.waitFor(() => expect(ttsApi.discoverVoices).toHaveBeenCalled())
      await wrapper.vm.$nextTick()
      const cells = wrapper.findAll('span.font-mono')
      const ids = cells.map((c) => c.text())
      const heartCount = ids.filter((id) => id === 'af_heart').length
      expect(heartCount).toBe(1)
    })

    it('button is disabled when supportsVoiceDiscovery is false', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, supportsVoiceDiscovery: false })
      const btn = wrapper.find<HTMLButtonElement>('[data-testid="import-from-provider"]')
      expect(btn.element.disabled).toBe(true)
    })

    it('button is enabled when supportsVoiceDiscovery is true', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, supportsVoiceDiscovery: true })
      const btn = wrapper.find<HTMLButtonElement>('[data-testid="import-from-provider"]')
      expect(btn.element.disabled).toBe(false)
    })

    it('does not call discoverVoices when supportsVoiceDiscovery is false', async () => {
      const spy = vi.spyOn(ttsApi, 'discoverVoices').mockResolvedValue({ supported: true, voices: [] })
      const wrapper = mountCuration({ ...BASE_PROVIDER, supportsVoiceDiscovery: false })
      const btn = wrapper.find('[data-testid="import-from-provider"]')
      await btn.trigger('click')
      expect(spy).not.toHaveBeenCalled()
    })

    it('shows generic tooltip reason when supportsVoiceDiscovery is false and no preset', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: null, supportsVoiceDiscovery: false })
      expect(wrapper.text()).toContain('This provider does not support voice discovery.')
    })

    it('shows preset-specific tooltip reason when supportsVoiceDiscovery is false and kokoro preset detected', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'kokoro', supportsVoiceDiscovery: false })
      expect(wrapper.text()).toContain('Load Kokoro preset')
    })
  })

  describe('Preview voice', () => {
    it('calls previewVoice with provider id and voice id', async () => {
      const mockBlob = new Blob(['audio'], { type: 'audio/mpeg' })
      const spy = vi.spyOn(ttsApi, 'previewVoice').mockResolvedValue(new Response(mockBlob, { status: 200 }))
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      await wrapper.find('button[aria-label="Preview Heart"]').trigger('click')
      await vi.waitFor(() => expect(spy).toHaveBeenCalledWith('1', 'af_heart'))
    })

    it('shows error icon when preview fails', async () => {
      vi.spyOn(ttsApi, 'previewVoice').mockResolvedValue(new Response(null, { status: 500 }))
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      await wrapper.find('button[aria-label="Preview Heart"]').trigger('click')
      await vi.waitFor(() => expect(wrapper.find('button[aria-label="Preview Heart"] .text-destructive').exists()).toBe(true))
    })
  })

  describe('Load preset', () => {
    it('loads Kokoro preset voices', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'kokoro', staticVoices: null })
      const presetBtn = wrapper.findAll('button').find((b) => b.text().includes('Load Kokoro preset'))
      await presetBtn!.trigger('click')
      expect(wrapper.text()).toContain('af_heart')
      expect(wrapper.text()).toContain('bm_lewis')
    })

    it('merges preset with existing voices without duplicates', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, defaultModel: 'kokoro', staticVoices: [SAVED_VOICES[0]!] })
      const presetBtn = wrapper.findAll('button').find((b) => b.text().includes('Load Kokoro preset'))
      await presetBtn!.trigger('click')
      const cells = wrapper.findAll('span.font-mono')
      const ids = cells.map((c) => c.text())
      const heartCount = ids.filter((id) => id === 'af_heart').length
      expect(heartCount).toBe(1)
      expect(ids.length).toBe(12)
    })
  })

  describe('Add voice manually', () => {
    it('does not show an add voice form or button', () => {
      const wrapper = mountCuration()
      expect(wrapper.text()).not.toContain('Add voice manually')
      expect(wrapper.find('input[placeholder="af_heart"]').exists()).toBe(false)
    })
  })

  describe('Edit voice', () => {
    it('enters edit mode on pencil click', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      await wrapper.find('button[aria-label="Edit Heart"]').trigger('click')
      expect(wrapper.find('input').exists()).toBe(true)
    })

    it('cancels edit mode without saving', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      await wrapper.find('button[aria-label="Edit Heart"]').trigger('click')
      const cancelBtn = wrapper.find('button[aria-label="Cancel edit"]')
      await cancelBtn.trigger('click')
      expect(wrapper.find('input').exists()).toBe(false)
      expect(wrapper.text()).toContain('Heart')
    })
  })

  describe('Delete voice', () => {
    it('removes a voice from the list', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      const deleteBtns = wrapper.findAll('button[class*="hover:text-destructive"]')
      await deleteBtns[0]!.trigger('click')
      expect(wrapper.text()).not.toContain('af_heart')
    })
  })

  describe('Save', () => {
    it('emits save with current voices', async () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      await wrapper.find('button[aria-label="Edit Heart"]').trigger('click')
      await wrapper.find('input').setValue('af_heart_v2')
      const saveRowBtn = wrapper.findAll('button').find((b) => b.text().trim() === 'Save' && !b.classes().includes('bg-primary'))
      await saveRowBtn!.trigger('click')
      const saveFooterBtn = wrapper.find('button.bg-primary')
      await saveFooterBtn.trigger('click')
      const emitted = wrapper.emitted('save')
      expect(emitted).toBeTruthy()
      expect(emitted![0]).toBeTruthy()
    })

    it('Save button is disabled when there are no unsaved changes', () => {
      const wrapper = mountCuration({ ...BASE_PROVIDER, staticVoices: SAVED_VOICES })
      const saveBtn = wrapper.find('button.bg-primary')
      expect((saveBtn.element as HTMLButtonElement).disabled).toBe(true)
    })
  })

  describe('Close', () => {
    it('emits close immediately when no unsaved changes', async () => {
      const wrapper = mountCuration()
      const closeBtn = wrapper.find('button.rounded-lg.hover\\:bg-accent')
      await closeBtn.trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('emits close on Cancel button click (no changes)', async () => {
      const wrapper = mountCuration()
      const cancelBtn = wrapper.findAll('button').find((b) => b.text() === 'Cancel')
      await cancelBtn!.trigger('click')
      expect(wrapper.emitted('close')).toBeTruthy()
    })
  })
})
