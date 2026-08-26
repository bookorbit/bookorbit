import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadClientItem } from '@bookorbit/types'

const { apiMock, toastMock } = vi.hoisted(() => ({
  apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(),
  toastMock: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() },
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))
vi.mock('vue-sonner', () => ({ toast: toastMock }))

import DownloadClientsPanel from '../DownloadClientsPanel.vue'

function client(overrides: Partial<DownloadClientItem> = {}): DownloadClientItem {
  return {
    id: 1,
    name: 'My qBittorrent',
    color: null,
    adapterType: 'qbittorrent',
    enabled: true,
    priority: 1,
    baseUrl: 'http://127.0.0.1:8080',
    username: 'admin',
    hasPassword: true,
    category: 'bookorbit',
    useHardlinks: true,
    allowPrivateAddress: true,
    // Required since a client without one declares no directory the import may read out of.
    pathMappings: [{ id: 1, remotePath: '/downloads', localPath: '/data/torrents' }],
    lastTestedAt: null,
    lastTestOk: null,
    lastErrorMessage: null,
    createdAt: '2026-08-19T00:00:00.000Z',
    updatedAt: '2026-08-19T00:00:00.000Z',
    ...overrides,
  } as DownloadClientItem
}

function response(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: vi.fn<() => Promise<unknown>>().mockResolvedValue(body) } as unknown as Response
}

async function mountPanel(clients: DownloadClientItem[] = []) {
  apiMock.mockImplementation(() => Promise.resolve(response({ clients, encryptionConfigured: true })))
  const wrapper = mount(DownloadClientsPanel)
  await flushPromises()
  return wrapper
}

/** The editor renders through DialogPortal, so it lands on the body rather than in the wrapper. */
function sheet(): HTMLElement {
  const el = document.body.querySelector('[role="dialog"]')
  if (el === null) throw new Error('no editor sheet is open')
  return el as HTMLElement
}

function clickInSheet(text: string) {
  const button = [...sheet().querySelectorAll('button')].find((candidate) => (candidate.textContent ?? '').includes(text))
  if (button === undefined) throw new Error(`no button labelled "${text}" in the sheet`)
  button.click()
}

async function clickInPanel(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text))
  if (button === undefined) throw new Error(`no button labelled "${text}" in the panel`)
  await button.trigger('click')
  await flushPromises()
}

function typeInto(selector: string, value: string) {
  const input = sheet().querySelector<HTMLInputElement>(selector)
  if (input === null) throw new Error(`no field matching ${selector}`)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function openCreate(wrapper: VueWrapper) {
  await clickInPanel(wrapper, 'Add client')
  await flushPromises()
  // Creating now starts on the type step, so the form does not exist until one is chosen.
  clickInSheet('Continue')
  await flushPromises()
}

/** A save is refused without one, so anything testing a *different* rejection has to fill it in. */
function fillMapping(remotePath = '/downloads', localPath = '/data/torrents') {
  typeInto('#mapping-remote-0', remotePath)
  typeInto('#mapping-local-0', localPath)
}

describe('DownloadClientsPanel', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => {
    document.body.innerHTML = ''
  })

  /**
   * Every client that can be added is somebody else's program reached over the network, and which
   * one it is decides what the form has to ask for, so the step earns itself once there are
   * several. A direct file is fetched by BookOrbit itself and is deliberately not offered at all.
   */
  /**
   * With no client the heading heads nothing, so the panel takes its place. The distinction it has
   * to keep is that this is not a broken install: a direct HTTP download needs no client at all.
   */
  it('says what is missing rather than that nothing works, when no client is configured', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.find('section[aria-labelledby="download-clients-heading"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('No download client yet')
    expect(wrapper.text()).toContain('direct HTTP download')
    expect(wrapper.findAll('button').filter((button) => button.text().includes('Add client'))).toHaveLength(1)
  })

  it('goes back to the list and its heading once a client exists', async () => {
    const wrapper = await mountPanel([client()])

    expect(wrapper.find('section[aria-labelledby="download-clients-heading"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('No download client yet')
  })

  it('asks which client this is before showing a form shaped for it', async () => {
    const wrapper = await mountPanel()
    await clickInPanel(wrapper, 'Add client')

    expect([...sheet().querySelectorAll<HTMLInputElement>('input[name="download-client-type"]')].map((input) => input.value)).toEqual([
      'qbittorrent',
      'transmission',
      'deluge',
    ])
    expect(sheet().querySelector('#download-client-name')).toBeNull()

    clickInSheet('Continue')
    await flushPromises()

    expect(sheet().querySelector('#download-client-name')).not.toBeNull()
    expect(sheet().querySelector('#download-client-url')).not.toBeNull()
  })

  it('keeps the list rendered while a row is being edited', async () => {
    const wrapper = await mountPanel([client()])
    await clickInPanel(wrapper, 'Edit My qBittorrent')

    expect(wrapper.text()).toContain('My qBittorrent')
    expect(sheet().querySelector<HTMLInputElement>('#download-client-name')?.value).toBe('My qBittorrent')
  })

  it('shows and saves the assigned client color', async () => {
    const wrapper = await mountPanel([client({ color: 'orange' })])

    expect(wrapper.find('[role="img"]').classes().join(' ')).toContain('--pill-source-orange')
    await clickInPanel(wrapper, 'Edit My qBittorrent')

    const green = sheet().querySelector<HTMLInputElement>('input[name="download-client-color"][value="green"]')
    if (green === null) throw new Error('no green client color option')
    green.click()
    clickInSheet('Save')
    await flushPromises()

    const saveCall = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({ color: 'green' })
  })

  it('shows a rejected save under the field it belongs to instead of as a toast', async () => {
    const wrapper = await mountPanel()
    await openCreate(wrapper)
    typeInto('#download-client-name', 'Taken')
    typeInto('#download-client-url', 'http://localhost:8080')
    fillMapping()
    await flushPromises()

    apiMock.mockImplementation((url: string, init?: RequestInit) =>
      Promise.resolve(
        init?.method === 'POST'
          ? response({ errorCode: 'DOWNLOAD_CLIENT_URL_PRIVATE', message: 'private' }, false)
          : response({ clients: [], encryptionConfigured: true }),
      ),
    )
    clickInSheet('Save')
    await flushPromises()

    expect(sheet().querySelector('#download-client-url-error')?.textContent).toContain('private or local network')
    expect(toastMock.error).not.toHaveBeenCalled()
  })

  /**
   * The mapping declares the directory the import may read out of, so the server refuses a client
   * without one. Saying so under the section beats letting the round trip come back with a 400.
   */
  it('refuses to save a client with no path mapping, and says so under the mappings section', async () => {
    const wrapper = await mountPanel()
    await openCreate(wrapper)
    typeInto('#download-client-name', 'qbit')
    typeInto('#download-client-url', 'http://localhost:8080')
    await flushPromises()

    clickInSheet('Save')
    await flushPromises()

    expect(sheet().textContent).toContain('Add at least one path mapping')
    expect(apiMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  /** The single-host answer, which is a mapping rather than the absence of one. */
  it('offers a mapping row to fill in as soon as the form opens', async () => {
    const wrapper = await mountPanel()
    await openCreate(wrapper)

    expect(sheet().querySelector('#mapping-remote-0')).not.toBeNull()
    expect(sheet().textContent).toContain('Same filesystem?')
  })

  /**
   * An empty box means "keep", because that is what it looked like when the form opened. Sending
   * the empty string wiped a working credential and the next grab failed with nothing saying why.
   */
  describe('stored password', () => {
    async function editAndSave(wrapper: VueWrapper, act: () => void) {
      await clickInPanel(wrapper, 'Edit My qBittorrent')
      act()
      await flushPromises()
      clickInSheet('Save')
      await flushPromises()
      const saveCall = apiMock.mock.calls.find(([, init]) => init?.method === 'PUT')
      return JSON.parse(String(saveCall?.[1]?.body)) as Record<string, unknown>
    }

    it('keeps it when a typed password is erased again', async () => {
      const wrapper = await mountPanel([client()])

      const body = await editAndSave(wrapper, () => {
        typeInto('#download-client-password', 'hunter2')
        typeInto('#download-client-password', '')
      })

      expect(body).not.toHaveProperty('password')
    })

    it('sends a typed password', async () => {
      const wrapper = await mountPanel([client()])

      const body = await editAndSave(wrapper, () => typeInto('#download-client-password', 'hunter2'))

      expect(body).toMatchObject({ password: 'hunter2' })
    })

    it('removes it only when clearing is asked for outright', async () => {
      const wrapper = await mountPanel([client()])

      const body = await editAndSave(wrapper, () => clickInSheet('Clear'))

      expect(body).toMatchObject({ password: '' })
    })

    it('offers no clearing on a client that has no stored password', async () => {
      const wrapper = await mountPanel([client({ hasPassword: false })])
      await clickInPanel(wrapper, 'Edit My qBittorrent')

      expect([...sheet().querySelectorAll('button')].some((button) => (button.textContent ?? '').trim() === 'Clear')).toBe(false)
    })
  })

  /** Test runs against the saved row, so a green tick for a draft would be a tick for old values. */
  it('refuses to test while the draft differs from the saved client', async () => {
    const wrapper = await mountPanel([client()])
    await clickInPanel(wrapper, 'Edit My qBittorrent')

    const savedTest = sheet().querySelector<HTMLButtonElement>('button[aria-label="Test connection"]')
    expect(savedTest?.disabled).toBe(false)

    typeInto('#download-client-url', 'http://127.0.0.1:9091')
    await flushPromises()

    expect(sheet().querySelector('button[aria-label="Test connection"]')).toBeNull()
    const dirtyTest = sheet().querySelector<HTMLButtonElement>('button[aria-label="Save your changes before testing"]')
    expect(dirtyTest?.getAttribute('aria-disabled')).toBe('true')
    dirtyTest?.click()
    await flushPromises()
    expect(apiMock.mock.calls.some(([url, init]) => String(url).endsWith('/test') && init?.method === 'POST')).toBe(false)
  })
})
