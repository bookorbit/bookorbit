import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { KeepAlive, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useCollections } from '@/features/collection/composables/useCollections'
import CollectionView from '../CollectionView.vue'

const { api, reload } = vi.hoisted(() => ({
  api: vi.fn<(url: string, options?: RequestInit) => Promise<Response>>(),
  reload: vi.fn<() => void>(),
}))

vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api }))
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => ({ params: { id: '7' }, path: '/collection/7', matched: [] }),
  useRouter: () => ({}),
}))
vi.mock('@/features/book/composables/useBookListPage', () => ({
  useBookListPage: () => ({ countFact: () => '', booksInitialized: false, reload }),
}))

enableAutoUnmount(afterEach)

it('reloads a cached collection once on return after its membership changes', async () => {
  const collection = { id: 7, name: 'Reading Queue', bookCount: 1 }
  api.mockImplementation(async (url, options) => {
    if (url === '/api/v1/collections') return Response.json([collection])
    if (url === '/api/v1/collections/8/books') return Response.json({ id: 8, bookCount: 1 })
    return Response.json({ ...collection, bookCount: options?.method === 'DELETE' ? 1 : 2 })
  })

  const showCollection = ref(true)
  const LibraryStub = defineComponent({ render: () => h('div') })
  const Shell = defineComponent({ render: () => h(KeepAlive, null, () => h(showCollection.value ? CollectionView : LibraryStub)) })

  mount(Shell, { shallow: true, global: { stubs: { KeepAlive: false, CollectionView: false } } })
  await flushPromises()

  const { addBooksToCollection, removeBooksFromCollection } = useCollections()
  await addBooksToCollection(8, { bookIds: [20] })
  expect(reload).not.toHaveBeenCalled()

  showCollection.value = false
  await nextTick()
  await addBooksToCollection(7, { bookIds: [20] })
  await removeBooksFromCollection(7, { bookIds: [10] })
  expect(reload).not.toHaveBeenCalled()

  showCollection.value = true
  await nextTick()
  expect(reload).toHaveBeenCalledOnce()

  showCollection.value = false
  await nextTick()
  showCollection.value = true
  await nextTick()
  expect(reload).toHaveBeenCalledOnce()

  await removeBooksFromCollection(7, { bookIds: [20] })
  expect(reload).toHaveBeenCalledTimes(2)
})
