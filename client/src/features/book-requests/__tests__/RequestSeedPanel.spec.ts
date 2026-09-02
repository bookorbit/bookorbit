import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookRequestItem, BookRequestSeedStatus } from '@bookorbit/types'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

vi.mock('@/lib/api', () => ({ api: apiMock }))

import RequestSeedPanel from '../components/RequestSeedPanel.vue'

/** The dialog only matters here as something that emits confirm, so it stays a stub. */
const ConfirmDialogStub = defineComponent({
  name: 'ConfirmDialogStub',
  props: { open: { type: Boolean, default: false } },
  emits: ['confirm', 'cancel'],
  template: '<div />',
})

function response(body: string, ok = true): Response {
  return { ok, status: ok ? 200 : 500, text: vi.fn<() => Promise<string>>().mockResolvedValue(body) } as unknown as Response
}

function seed(overrides: Partial<BookRequestSeedStatus> = {}): BookRequestSeedStatus {
  return {
    downloadId: 11,
    downloadClientId: 4,
    downloadClientName: 'qbit',
    clientHash: 'c9e15763f722f23e98a29decdfae341b98d53056',
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

  it('shows the ratio and the time against the goals the client was given', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.text()).toContain('Seeding')
    expect(wrapper.text()).toContain('1.25 of 2')
    expect(wrapper.text()).toContain('2 h of 72 h')
  })

  /** The goals are what the client stops on, so they are drawn as fractions rather than listed. */
  it('draws a meter for each goal the client reported', async () => {
    const wrapper = await mountPanel()

    const meters = wrapper.findAll('[data-testid="seed-meter"]')
    expect(meters).toHaveLength(2)
    expect(meters[0]!.find('div').attributes('style')).toContain('width: 62.5%')
    expect(meters[1]!.find('div').attributes('style')).toContain('width: 2.777')
  })

  /** A goal the client never stated leaves nothing for the figure to be a fraction of. */
  it('leaves a figure with no goal as a plain number', async () => {
    apiMock.mockResolvedValue(response(JSON.stringify(seed({ ratioGoal: null, seedingTimeGoalMinutes: null }))))

    const wrapper = await mountPanel()

    expect(wrapper.findAll('[data-testid="seed-meter"]')).toHaveLength(0)
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

  it('marks a release the automation picked, so a retry is explicable', async () => {
    const wrapper = await mountPanel({
      request: request({
        download: { id: 11, requestId: 7, source: 'torrent_file', status: 'imported', automated: true } as BookRequestItem['download'],
      }),
    })

    expect(wrapper.text()).toContain('picked this release automatically')
  })

  /** Deleting the seeded copy is the opt-in half of the action, never the default. */
  it('removes without deleting files unless the box is ticked', async () => {
    const wrapper = await mountPanel()

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Remove from client')!
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
      .find((button) => button.text() === 'Remove from client')!
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

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Remove from client')!
      .trigger('click')
    wrapper.getComponent(ConfirmDialogStub).vm.$emit('confirm')

    expect(wrapper.emitted('remove')?.[0]?.[0]).toMatchObject({ deleteFiles: true })
  })
})
