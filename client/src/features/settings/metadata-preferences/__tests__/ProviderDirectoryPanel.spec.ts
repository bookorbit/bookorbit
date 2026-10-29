import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MetadataProviderDirectory, MetadataProviderDirectoryEntry } from '@bookorbit/types'
import ProviderDirectoryPanel from '../components/ProviderDirectoryPanel.vue'
import { composeServiceFor } from '../composables/useProviderDirectory'

const api = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>())
const copyToClipboard = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>())
const toastSuccess = vi.hoisted(() => vi.fn<(message: string) => void>())
const toastError = vi.hoisted(() => vi.fn<(message: string) => void>())

vi.mock('@/lib/api', () => ({ api }))
vi.mock('@/lib/clipboard', () => ({ copyToClipboard }))
vi.mock('vue-sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

function entry(key: string, name: string, overrides: Partial<MetadataProviderDirectoryEntry> = {}): MetadataProviderDirectoryEntry {
  return {
    key,
    name,
    summary: `${name} summary.`,
    image: `ghcr.io/bookorbit/${key}-provider`,
    version: '0.1.0',
    port: 8080,
    docsUrl: `https://github.com/bookorbit/bookorbit-metadata-providers/tree/main/providers/${key}`,
    homepage: null,
    color: '#336699',
    mediaTypes: ['book'],
    languages: [],
    ...overrides,
  }
}

const DIRECTORY: MetadataProviderDirectory = {
  source: 'bundled',
  fetchedAt: null,
  providers: [
    entry('libris', 'Libris', { mediaTypes: ['book', 'audiobook'], languages: ['sv'] }),
    entry('lubimyczytac', 'LubimyCzytac', { port: 9090 }),
    entry('fantlab', 'FantLab'),
  ],
}

async function mountPanel(registeredKeys: string[] = ['fantlab']) {
  const wrapper = mount(ProviderDirectoryPanel, { props: { registeredKeys } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  api.mockReset().mockResolvedValue(Response.json(DIRECTORY))
  copyToClipboard.mockReset().mockResolvedValue(true)
  toastSuccess.mockReset()
  toastError.mockReset()
})

describe('ProviderDirectoryPanel', () => {
  it('offers only what is not added yet, and names the rest on one line', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.findAll('li h4').map((heading) => heading.text())).toEqual(['Libris', 'LubimyCzytac'])
    expect(wrapper.text()).toContain('Already added: FantLab')
    expect(wrapper.text()).toContain('List included with this version')
  })

  it('says what each covers, and marks a source that used to be built in', async () => {
    const wrapper = await mountPanel()
    const [libris, lubimyczytac] = wrapper.findAll('li')

    expect(libris!.text()).toContain('Books, Audiobooks, Swedish')
    expect(libris!.find('code').text()).toBe('ghcr.io/bookorbit/libris-provider:0.1.0')
    expect(lubimyczytac!.text()).toContain('Was built in')
    expect(libris!.text()).not.toContain('Was built in')
  })

  it('copies a Compose service that fits under services:', async () => {
    const wrapper = await mountPanel()

    await wrapper.get('button[aria-label="Copy the Compose service for Libris"]').trigger('click')
    await flushPromises()

    expect(copyToClipboard).toHaveBeenCalledWith('  libris:\n    image: ghcr.io/bookorbit/libris-provider:0.1.0\n    restart: unless-stopped\n')
    expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining('Libris copied'))
  })

  it('asks for the address the Compose service answers on, with private addresses allowed', async () => {
    const wrapper = await mountPanel()

    await wrapper.get('button[aria-label="Add LubimyCzytac"]').trigger('click')

    expect(wrapper.emitted('add')).toEqual([[{ baseUrl: 'http://lubimyczytac:9090', allowPrivateAddress: true }]])
  })

  it('says when every provider is already added', async () => {
    const wrapper = await mountPanel(['libris', 'lubimyczytac', 'fantlab'])

    expect(wrapper.findAll('li h4')).toHaveLength(0)
    expect(wrapper.text()).toContain('You have added every provider in this list.')
  })

  it('still points at adding by address when the list cannot be loaded', async () => {
    api.mockResolvedValue(new Response('nope', { status: 500 }))
    const wrapper = await mountPanel()

    expect(wrapper.get('[role="alert"]').text()).toContain('You can still add any provider by its address')
  })

  it('reports a copy the browser refused', async () => {
    copyToClipboard.mockResolvedValue(false)
    const wrapper = await mountPanel()

    await wrapper.get('button[aria-label="Copy the Compose service for Libris"]').trigger('click')
    await flushPromises()

    expect(toastError).toHaveBeenCalled()
    expect(composeServiceFor(DIRECTORY.providers[0]!)).toContain('libris-provider:0.1.0')
  })
})
