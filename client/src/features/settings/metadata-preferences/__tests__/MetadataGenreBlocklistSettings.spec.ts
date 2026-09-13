import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetadataFetchOptions, MetadataFetchPreferences } from '@bookorbit/types'
import MetadataGenreBlocklistSettings from '../MetadataGenreBlocklistSettings.vue'

const apiMock = vi.hoisted(() => vi.fn<(...args: unknown[]) => Promise<{ ok: boolean; json?: () => Promise<unknown> }>>())
const toastSuccess = vi.hoisted(() => vi.fn<(message: string) => void>())
const toastError = vi.hoisted(() => vi.fn<(message: string) => void>())

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    success: toastSuccess,
    error: toastError,
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function response(data: unknown, ok = true) {
  return {
    ok,
    json: async () => data,
  }
}

function makePrefs(
  blocklist: string[],
  marker = 'initial',
  providerIdMode: MetadataFetchOptions['providerIdMode'] = 'preferExisting',
): MetadataFetchPreferences {
  return {
    fields: {
      title: {
        enabled: true,
        providers: [marker],
        mergeStrategy: 'fillMissing',
      },
    },
    options: {
      genres: {
        mode: 'merge',
        blocklist,
        maxCount: 3,
      },
      saveProviderIds: true,
      providerIdMode,
    },
  } as unknown as MetadataFetchPreferences
}

function putBodyAt(index: number): MetadataFetchPreferences {
  const [, init] = apiMock.mock.calls[index] as [string, RequestInit]
  return JSON.parse(String(init.body)) as MetadataFetchPreferences
}

describe('MetadataGenreBlocklistSettings', () => {
  beforeEach(() => {
    apiMock.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
  })

  it('adds a genre without duplicate-warning flicker and preserves latest preferences', async () => {
    const latestFetch = deferred<{ ok: boolean; json: () => Promise<unknown> }>()
    apiMock
      .mockResolvedValueOnce(response(makePrefs(['Audiobook'])))
      .mockReturnValueOnce(latestFetch.promise)
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response(makePrefs(['Audiobook', 'Adult'], 'latest', 'existingOnly')))

    const wrapper = mount(MetadataGenreBlocklistSettings)
    await flushPromises()

    const input = wrapper.get<HTMLInputElement>('#genre-blocklist-entry')
    await input.setValue(' Adult ')
    await wrapper.get('button[data-slot="button"]').trigger('click')
    await nextTick()

    expect(input.element.value).toBe('')
    expect(wrapper.text()).not.toContain('This genre is already blocked.')

    latestFetch.resolve(response(makePrefs(['Audiobook'], 'latest', 'existingOnly')))
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(4)
    expect(apiMock.mock.calls[2]?.[0]).toBe('/api/v1/metadata-preferences/global')
    const body = putBodyAt(2)
    expect(body.fields.title.providers).toEqual(['latest'])
    expect(body.options?.genres.blocklist).toEqual(['Audiobook', 'Adult'])
    expect(body.options?.genres.maxCount).toBe(3)
    expect(body.options?.providerIdMode).toBe('existingOnly')
  })

  it('does not submit duplicate genre values', async () => {
    apiMock.mockResolvedValue(response(makePrefs(['Audiobook'])))

    const wrapper = mount(MetadataGenreBlocklistSettings)
    await flushPromises()

    await wrapper.get('#genre-blocklist-entry').setValue('audiobook')

    expect(wrapper.text()).toContain('This genre is already blocked.')
    expect(wrapper.get('button[data-slot="button"]').attributes('disabled')).toBeDefined()
    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('filters long blocklists and shows an empty filtered state', async () => {
    apiMock.mockResolvedValue(response(makePrefs(['Audiobook', 'Adult'])))

    const wrapper = mount(MetadataGenreBlocklistSettings)
    await flushPromises()

    const filterInput = wrapper.get<HTMLInputElement>('input[placeholder="Filter blocklist"]')
    await filterInput.setValue('audio')

    expect(wrapper.text()).toContain('1 of 2')
    expect(wrapper.text()).toContain('Audiobook')
    expect(wrapper.text()).not.toContain('Adult')

    await filterInput.setValue('missing')

    expect(wrapper.text()).toContain('No blocked genres match the current filter.')
  })

  it('rolls back a delete when saving fails', async () => {
    apiMock
      .mockResolvedValueOnce(response(makePrefs(['Audiobook', 'Adult'])))
      .mockResolvedValueOnce(response(makePrefs(['Audiobook', 'Adult'])))
      .mockResolvedValueOnce(response({}, false))

    const wrapper = mount(MetadataGenreBlocklistSettings)
    await flushPromises()

    await wrapper.get('button[aria-label="Remove Audiobook"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Audiobook')
    expect(wrapper.text()).toContain('Adult')
    expect(toastError).toHaveBeenCalledWith('Could not save metadata preferences. Check your connection and try again.')
  })
})
