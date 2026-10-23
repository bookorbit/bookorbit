import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookDetail, CoverMedium } from '@bookorbit/types'
import { api } from '@/lib/api'
import MetadataSearchDrawer from '../MetadataSearchDrawer.vue'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
const authUser = ref({ id: 3 })
vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user: authUser }) }))

const WorkspaceStub = defineComponent({
  props: ['searchDefaults', 'hasSearched'],
  emits: ['search'],
  template: '<div><slot name="search-options" /></div>',
})

const book = {
  id: 7,
  title: 'Dune',
  authors: [{ name: 'Frank Herbert' }],
  isbn13: '9780441172719',
  files: [],
  coverMedia: [],
  covers: { ebook: null, audio: null },
} as unknown as BookDetail

function mountDrawer(coverMedia: CoverMedium[] = []) {
  return mount(MetadataSearchDrawer, {
    props: { book: { ...book, coverMedia }, lockedFields: [] },
    global: {
      stubs: {
        Sheet: { template: '<div><slot /></div>' },
        SheetContent: { template: '<div><slot /></div>' },
        SheetTitle: { template: '<h2><slot /></h2>' },
        SheetDescription: { template: '<p><slot /></p>' },
        SheetClose: true,
        MetadataMatchShortcuts: true,
        MetadataMatchWorkspace: WorkspaceStub,
        Popover: { template: '<div><slot /></div>' },
        PopoverTrigger: { template: '<div><slot /></div>' },
        PopoverContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

function searchCalls() {
  return vi.mocked(api).mock.calls.filter(([url]) => String(url).includes('/metadata-fetch/stream'))
}

describe('MetadataSearchDrawer automatic search', () => {
  beforeEach(() => {
    authUser.value = { id: 3 }
    localStorage.clear()
    vi.mocked(api).mockReset()
    vi.mocked(api).mockImplementation(async (url) =>
      String(url).includes('/metadata-fetch/providers')
        ? new Response(JSON.stringify([{ key: 'google', label: 'Google Books', identifiable: true }]))
        : new Response(''),
    )
  })

  it('prefills the query without searching either medium until Search is requested', async () => {
    const wrapper = mountDrawer(['ebook', 'audio'])
    await flushPromises()

    expect(searchCalls()).toHaveLength(0)
    expect(wrapper.get('input[type="checkbox"]').element).toHaveProperty('checked', false)
    const workspace = wrapper.getComponent(WorkspaceStub)
    expect(workspace.props('searchDefaults')).toEqual({ title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719' })
    workspace.vm.$emit('search', { title: 'Dune revised', author: 'Frank Herbert', isbn: '' })
    await flushPromises()

    expect(searchCalls()).toHaveLength(2)
    expect(searchCalls()[0]![0]).toContain('title=Dune+revised')
    expect(searchCalls()[1]![0]).toContain('mediaKind=audiobook')
    wrapper.unmount()
  })

  it('remembers opting in on this browser and searches on the next opening', async () => {
    const wrapper = mountDrawer()
    await flushPromises()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(searchCalls()).toHaveLength(0)
    wrapper.unmount()

    const reopened = mountDrawer()
    await flushPromises()
    expect(searchCalls()).toHaveLength(1)
    expect(searchCalls()[0]![0]).toContain('isbn=9780441172719')
    await reopened.get('input[type="checkbox"]').setValue(false)
    await flushPromises()
    reopened.unmount()

    const manual = mountDrawer()
    await flushPromises()
    expect(searchCalls()).toHaveLength(1)
    manual.unmount()
  })

  it('keeps another account on manual search', async () => {
    const wrapper = mountDrawer()
    await flushPromises()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()
    wrapper.unmount()

    authUser.value = { id: 4 }
    const otherAccount = mountDrawer()
    await flushPromises()
    expect(otherAccount.get('input[type="checkbox"]').element).toHaveProperty('checked', false)
    expect(searchCalls()).toHaveLength(0)
    otherAccount.unmount()
  })

  it('does not start a delayed automatic search after the drawer closes', async () => {
    localStorage.setItem('bookorbit:3:metadata-search-auto-start', 'true')
    let resolveProviders!: (response: Response) => void
    vi.mocked(api).mockReturnValueOnce(
      new Promise<Response>((resolve) => {
        resolveProviders = resolve
      }),
    )
    const wrapper = mountDrawer()
    wrapper.unmount()
    resolveProviders(new Response('[]'))
    await flushPromises()
    expect(searchCalls()).toHaveLength(0)
  })
})
