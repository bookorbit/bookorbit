import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRequestItem, BookRequestSeedStatus } from '@bookorbit/types'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

vi.mock('@/lib/api', () => ({ api: apiMock }))

import RequestSeedPanel from '../components/RequestSeedPanel.vue'

/** The dialog only matters here as something that emits confirm and shows what it holds. */
const ConfirmDialogStub = defineComponent({
  name: 'ConfirmDialogStub',
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: '' },
    description: { type: String, default: '' },
    cancelLabel: { type: String, default: '' },
  },
  emits: ['confirm', 'cancel'],
  template: '<div><slot /></div>',
})

const REMOVE = 'Remove from client...'

function response(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 500, text: vi.fn<() => Promise<string>>().mockResolvedValue(body) } as unknown as Response
}

function seed(overrides: Partial<BookRequestSeedStatus> = {}): BookRequestSeedStatus {
  return {
    downloadId: 11,
    downloadClientId: 4,
    downloadClientName: 'qbit',
    clientKey: 'c9e15763f722f23e98a29decdfae341b98d53056',
    alwaysDeletesRemote: false,
    seeding: true,
    ratio: 1.25,
    ratioGoal: 2,
    seedingTimeSeconds: 7200,
    seedingTimeGoalMinutes: 4320,
    uploadedBytes: 1024 * 1024,
    ...overrides,
  }
}

function request(overrides: Partial<BookRequestItem> = {}): BookRequestItem {
  return {
    id: 7,
    title: 'Dune',
    status: 'available',
    authors: ['Frank Herbert'],
    subscribers: [],
    download: { id: 11, requestId: 7, source: 'torrent_file', status: 'imported', automated: false, releaseTitle: 'Dune [EPUB]' },
    ...overrides,
  } as BookRequestItem
}

async function mountPanel(props: Partial<{ request: BookRequestItem; busy: boolean; canManage: boolean }> = {}) {
  const wrapper = mount(RequestSeedPanel, {
    props: { request: request(), busy: false, canManage: true, ...props },
    global: { stubs: { ConfirmDialog: ConfirmDialogStub } },
  })
  await flushPromises()
  return wrapper
}

describe('RequestSeedPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMock.mockResolvedValue(response(JSON.stringify(seed())))
  })

  it('reads the seed state live when a request is opened', async () => {
    await mountPanel()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/admin/book-requests/7/seed')
  })

  it('keeps the seed readout when the parent refreshes the same request', async () => {
    const wrapper = await mountPanel()

    await wrapper.setProps({ request: { ...request(), title: 'Dune Messiah' } })
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('1.25 of 2')
  })

  /** A running transfer is the status card's to show; the seed row is what is left after it. */
  it('stays out of the way while the transfer is still running', async () => {
    apiMock.mockResolvedValue(response(JSON.stringify(seed({ seeding: false, ratio: 0, seedingTimeSeconds: 0, uploadedBytes: 0 }))))

    const wrapper = await mountPanel({
      request: request({ download: { ...request().download!, status: 'downloading' } }),
    })

    expect(wrapper.text()).toBe('')
  })

  it('re-reads the seed state when the download advances', async () => {
    apiMock
      .mockResolvedValueOnce(response(JSON.stringify(seed({ seeding: false, ratio: 0, seedingTimeSeconds: 0, uploadedBytes: 0 }))))
      .mockResolvedValueOnce(response(JSON.stringify(seed())))
    const wrapper = await mountPanel({
      request: request({ download: { ...request().download!, status: 'downloading' } }),
    })

    await wrapper.setProps({ request: request() })
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Seeding')
    expect(wrapper.text()).not.toContain('Stopped')
  })

  it('shows the ratio and the time against the goals the client was given', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Seeding')
    expect(wrapper.text()).toContain('1.25 of 2')
    expect(wrapper.text()).toContain('2 h of 72 h')
  })

  it('states what the torrent has uploaded beside the two goals', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Uploaded')
  })

  /** A goal the client never stated leaves nothing for the figure to be a fraction of. */
  it('leaves a figure with no goal as a plain number', async () => {
    apiMock.mockResolvedValue(response(JSON.stringify(seed({ ratioGoal: null, seedingTimeGoalMinutes: null }))))

    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('1.25')
    expect(wrapper.text()).not.toContain('1.25 of')
  })

  it('says the torrent is gone rather than reporting a seed at zero', async () => {
    apiMock.mockResolvedValue(response(''))

    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('no longer has this torrent')
    expect(wrapper.text()).not.toContain('Ratio')
  })

  it('asks nothing of the client for a request that was never grabbed', async () => {
    await mountPanel({ request: request({ download: null }) })

    expect(apiMock).not.toHaveBeenCalled()
  })

  it('does not render torrent controls or read seed state for a direct HTTP download', async () => {
    const wrapper = await mountPanel({
      request: request({
        download: { id: 11, requestId: 7, source: 'direct_url', status: 'imported', automated: false } as BookRequestItem['download'],
      }),
    })

    expect(apiMock).not.toHaveBeenCalled()
    expect(wrapper.text()).toBe('')
  })

  /** The drawer's status card says "still seeding" in a failure sentence, so it has to learn it. */
  it('tells the drawer whether the client is still seeding', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.emitted('seeding')?.at(-1)).toEqual([true])
  })

  it('offers to keep seeding as the way out of the removal', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.getComponent(ConfirmDialogStub).props('cancelLabel')).toBe('Keep seeding')
  })

  /** Deleting the seeded copy is the opt-in half of the action, never the default. */
  it('removes without deleting files unless the box is ticked', async () => {
    const wrapper = await mountPanel()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === REMOVE)!
      .trigger('click')
    wrapper.getComponent(ConfirmDialogStub).vm.$emit('confirm')

    expect(wrapper.emitted('remove')?.[0]?.[0]).toEqual({ request: expect.objectContaining({ id: 7 }), downloadId: 11, deleteFiles: false })
  })

  /**
   * The parent owns the call, so the panel only learns it finished when `busy` drops. Without the
   * re-read it goes on offering to remove a torrent the client no longer has.
   */
  it('re-reads the client once the removal it asked for has finished', async () => {
    const wrapper = await mountPanel()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === REMOVE)!
      .trigger('click')
    wrapper.getComponent(ConfirmDialogStub).vm.$emit('confirm')

    apiMock.mockResolvedValue(response(''))
    await wrapper.setProps({ busy: true })
    await wrapper.setProps({ busy: false })
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('no longer has this torrent')
  })

  it('leaves the seed state alone while some other action on the request is running', async () => {
    const wrapper = await mountPanel()

    await wrapper.setProps({ busy: true })
    await wrapper.setProps({ busy: false })
    await flushPromises()

    expect(apiMock).toHaveBeenCalledTimes(1)
  })

  it('carries the delete-files choice through to the removal', async () => {
    const wrapper = await mountPanel()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === REMOVE)!
      .trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    wrapper.getComponent(ConfirmDialogStub).vm.$emit('confirm')

    expect(wrapper.emitted('remove')?.[0]?.[0]).toMatchObject({ deleteFiles: true })
  })

  /**
   * A cloud client cannot hand a torrent back: the removal deletes the item and its files there
   * whatever the operator chooses. Offering the choice would promise a copy nothing can keep.
   */
  it('warns that a cloud client deletes the files and offers no choice about it', async () => {
    apiMock.mockResolvedValue(response(JSON.stringify(seed({ alwaysDeletesRemote: true }))))
    const wrapper = await mountPanel()

    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)

    await wrapper
      .findAll('button')
      .find((button) => button.text() === REMOVE)!
      .trigger('click')

    expect(wrapper.getComponent(ConfirmDialogStub).props('description')).toContain('deletes it and its files there for good')
    wrapper.getComponent(ConfirmDialogStub).vm.$emit('confirm')
    expect(wrapper.emitted('remove')?.[0]?.[0]).toMatchObject({ deleteFiles: true })
  })
})
