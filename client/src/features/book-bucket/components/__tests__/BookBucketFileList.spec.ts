import { shallowMount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { BookBucketFile } from '@projectx/types'
import { ref } from 'vue'
import BookBucketFileList from '../BookBucketFileList.vue'

vi.mock('@/features/library/composables/useLibraries', () => ({
  useLibraries: () => ({
    libraries: ref([]),
    fetchLibraries: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  }),
}))

function makeFile(overrides: Partial<BookBucketFile> = {}): BookBucketFile {
  return {
    id: 1,
    fileName: 'example.epub',
    fileSize: 1024,
    format: 'epub',
    status: 'pending',
    embeddedMetadata: null,
    selectedMetadata: null,
    fetchedMetadata: null,
    targetLibraryId: null,
    targetFolderId: null,
    confidence: null,
    fetchedMetadataSources: null,
    errorMessage: null,
    metadataEditedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mountList(props: Partial<InstanceType<typeof BookBucketFileList>['$props']> = {}) {
  return shallowMount(BookBucketFileList, {
    props: {
      items: [],
      loading: false,
      initialized: true,
      isSelected: () => false,
      selectAll: false,
      ...props,
    },
  })
}

describe('BookBucketFileList', () => {
  it('shows the skeleton only during the initial load', () => {
    const wrapper = mountList({
      loading: true,
      initialized: false,
      items: [],
    })

    expect(wrapper.find('[data-test="book-bucket-loading-skeleton"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="book-bucket-empty-state"]').exists()).toBe(false)
  })

  it('keeps the empty state visible while a later tab refresh is loading', () => {
    const wrapper = mountList({
      loading: true,
      initialized: true,
      items: [],
      emptyMessage: 'No ready files',
    })

    expect(wrapper.find('[data-test="book-bucket-loading-skeleton"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="book-bucket-empty-state"]').text()).toContain('No ready files')
  })

  it('renders file rows after loading completes', () => {
    const wrapper = mountList({
      items: [makeFile()],
    })

    expect(wrapper.find('[data-test="book-bucket-loading-skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="book-bucket-empty-state"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('example.epub')
  })
})
