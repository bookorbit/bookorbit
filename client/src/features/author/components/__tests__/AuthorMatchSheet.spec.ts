import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorDetail, AuthorMetadataCandidate, MetadataCandidateCacheInfo } from '@bookorbit/types'
import { i18n } from '@/i18n'
import AuthorMatchSheet from '../AuthorMatchSheet.vue'

type AuthorApi = typeof import('../../api/author')
type CandidateHandler = (candidate: AuthorMetadataCandidate, cache: MetadataCandidateCacheInfo | null) => void

const mocks = vi.hoisted(() => {
  class AuthorMetadataMatchError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
    }
  }
  return {
    AuthorMetadataMatchError,
    streamAuthorMetadataCandidates: vi.fn<(params: Record<string, unknown>, onCandidate: CandidateHandler) => Promise<void>>(),
    lookupAuthorMetadata: vi.fn<AuthorApi['lookupAuthorMetadata']>(),
    pinAuthorMetadataMatch: vi.fn<AuthorApi['pinAuthorMetadataMatch']>(),
    unpinAuthorMetadataMatch: vi.fn<AuthorApi['unpinAuthorMetadataMatch']>(),
    toastSuccess: vi.fn<(message: string) => void>(),
    toastError: vi.fn<(message: string) => void>(),
    toastWarning: vi.fn<(message: string) => void>(),
  }
})

vi.mock('../../api/author', () => ({
  AuthorMetadataMatchError: mocks.AuthorMetadataMatchError,
  streamAuthorMetadataCandidates: mocks.streamAuthorMetadataCandidates,
  lookupAuthorMetadata: mocks.lookupAuthorMetadata,
  pinAuthorMetadataMatch: mocks.pinAuthorMetadataMatch,
  unpinAuthorMetadataMatch: mocks.unpinAuthorMetadataMatch,
}))

vi.mock('vue-sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, warning: mocks.toastWarning },
}))

const Passthrough = defineComponent({ template: '<div><slot /></div>' })

const ConfirmDialogStub = defineComponent({
  name: 'ConfirmDialog',
  props: ['open', 'title', 'busy'],
  emits: ['confirm', 'cancel'],
  template: '<div v-if="open" data-test="confirm-dialog">{{ title }}</div>',
})

function author(overrides: Partial<AuthorDetail> = {}): AuthorDetail {
  return {
    id: 9,
    name: 'John Reid',
    sortName: null,
    description: 'American journalist.',
    imageUrl: null,
    bookCount: 3,
    lastAddedAt: null,
    birthDate: null,
    birthYear: null,
    deathDate: null,
    deathYear: null,
    website: null,
    genres: [],
    influences: [],
    metadataProvider: null,
    metadataProviderId: null,
    metadataProviderPinned: false,
    ...overrides,
  }
}

const scottish: AuthorMetadataCandidate = {
  provider: 'goodreads',
  providerId: '2222',
  name: 'John Reid',
  description: 'Scottish novelist.',
  birthYear: 1965,
}

function mountSheet(value: AuthorDetail = author()) {
  return mount(AuthorMatchSheet, {
    props: { author: value },
    global: {
      stubs: {
        Sheet: Passthrough,
        SheetContent: Passthrough,
        SheetTitle: Passthrough,
        SheetDescription: Passthrough,
        SheetClose: Passthrough,
        ConfirmDialog: ConfirmDialogStub,
      },
    },
  })
}

function rowButtons(wrapper: ReturnType<typeof mountSheet>) {
  return wrapper.findAll('ul button')
}

function buttonLabelled(wrapper: ReturnType<typeof mountSheet>, key: string) {
  const label = i18n.global.t(key)
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(label))
  expect(button, `no button labelled "${label}"`).toBeDefined()
  return button!
}

describe('AuthorMatchSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.streamAuthorMetadataCandidates.mockImplementation(async (_params, onCandidate) => {
      onCandidate({ provider: 'goodreads', providerId: '1111', name: 'John Reid', description: 'American journalist.' }, null)
      onCandidate({ provider: 'goodreads', providerId: '2222', name: 'John Reid' }, null)
    })
    mocks.lookupAuthorMetadata.mockResolvedValue({ candidate: scottish, cache: null })
  })

  it('searches the author name on open and lists the matches', async () => {
    const wrapper = mountSheet()
    await flushPromises()

    expect(mocks.streamAuthorMetadataCandidates.mock.calls[0]![0]).toEqual(expect.objectContaining({ q: 'John Reid' }))
    expect(rowButtons(wrapper)).toHaveLength(2)
    expect(wrapper.get('[role="status"]').text()).toBe(i18n.global.t('author.match.results.count', { count: 2 }))
  })

  it('pins the chosen person after confirming and hands back the updated author', async () => {
    const updated = author({
      description: 'Scottish novelist.',
      metadataProvider: 'goodreads',
      metadataProviderId: '2222',
      metadataProviderPinned: true,
    })
    mocks.pinAuthorMetadataMatch.mockResolvedValue(updated)

    const wrapper = mountSheet()
    await flushPromises()
    await rowButtons(wrapper)[1]!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Scottish novelist.')
    await buttonLabelled(wrapper, 'author.match.detail.use').trigger('click')
    expect(wrapper.find('[data-test="confirm-dialog"]').exists()).toBe(true)

    await wrapper.getComponent(ConfirmDialogStub).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.pinAuthorMetadataMatch).toHaveBeenCalledWith(9, { provider: 'goodreads', providerId: '2222' })
    expect(wrapper.emitted('updated')?.[0]).toEqual([updated])
    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(mocks.toastSuccess).toHaveBeenCalled()
  })

  it('says the provider is down on a 503 and keeps the sheet open', async () => {
    mocks.pinAuthorMetadataMatch.mockRejectedValue(new mocks.AuthorMetadataMatchError(503, 'down'))

    const wrapper = mountSheet()
    await flushPromises()
    await rowButtons(wrapper)[1]!.trigger('click')
    await flushPromises()
    await buttonLabelled(wrapper, 'author.match.detail.use').trigger('click')
    await wrapper.getComponent(ConfirmDialogStub).vm.$emit('confirm')
    await flushPromises()

    expect(mocks.toastError).toHaveBeenCalledWith(i18n.global.t('author.match.toast.providerDown', { provider: 'Goodreads' }))
    expect(wrapper.emitted('updated')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('marks the current pinned match and offers to unpin it', async () => {
    mocks.lookupAuthorMetadata.mockResolvedValue({ candidate: scottish, cache: null })
    mocks.unpinAuthorMetadataMatch.mockResolvedValue(author({ metadataProvider: 'goodreads', metadataProviderId: '2222' }))

    const wrapper = mountSheet(author({ metadataProvider: 'goodreads', metadataProviderId: '2222', metadataProviderPinned: true }))
    await flushPromises()

    const rows = rowButtons(wrapper)
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain(i18n.global.t('author.match.results.current'))

    await rows[0]!.trigger('click')
    await flushPromises()
    await buttonLabelled(wrapper, 'author.match.detail.unpin').trigger('click')
    await flushPromises()

    expect(mocks.unpinAuthorMetadataMatch).toHaveBeenCalledWith(9)
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })

  it('offers to unpin when the stored provider match no longer resolves', async () => {
    mocks.lookupAuthorMetadata.mockResolvedValue(null)
    mocks.unpinAuthorMetadataMatch.mockResolvedValue(author({ metadataProvider: 'goodreads', metadataProviderId: '9999' }))

    const wrapper = mountSheet(author({ metadataProvider: 'goodreads', metadataProviderId: '9999', metadataProviderPinned: true }))
    await flushPromises()

    await buttonLabelled(wrapper, 'author.match.detail.unpin').trigger('click')
    await flushPromises()

    expect(mocks.unpinAuthorMetadataMatch).toHaveBeenCalledWith(9)
    expect(wrapper.emitted('updated')).toHaveLength(1)
  })

  it('explains a pasted reference it does not recognise', async () => {
    const wrapper = mountSheet()
    await flushPromises()

    const reference = wrapper.get(`input[placeholder="${i18n.global.t('author.match.reference.placeholder')}"]`)
    await reference.setValue('John Reid the Scottish one')
    await wrapper.findAll('form')[1]!.trigger('submit')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe(i18n.global.t('author.match.reference.unrecognised'))
    expect(reference.attributes('aria-invalid')).toBe('true')
  })
})
