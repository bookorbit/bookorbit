import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { JumpBucket, SortSpec } from '@bookorbit/types'

const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>()

vi.mock('@/lib/api', () => ({
  api: (url: string, init?: RequestInit) => fetchMock(url, init),
}))

import { useJumpBuckets } from '../useJumpBuckets'
import type { BookWindowQuery } from '../useBookWindow'

const LETTER_BUCKETS: JumpBucket[] = [
  { key: '#', label: '#', index: 0 },
  { key: 'A', label: 'A', index: 3 },
  { key: 'C', label: 'C', index: 10 },
  { key: 'Z', label: 'Z', index: 40 },
]

function mockBucketsResponse(buckets: JumpBucket[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ buckets, total: 50 }),
  })
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

function makeBuckets(
  overrides: Partial<{
    endpointValue: string | null
    sort: SortSpec[]
    enabledValue: boolean
  }> = {},
) {
  const endpoint = ref<string | null>(overrides.endpointValue ?? '/api/v1/libraries/1/books/jump-buckets')
  const query = ref<BookWindowQuery>({ sort: overrides.sort ?? [{ field: 'title', dir: 'asc' }] })
  const enabled = ref(overrides.enabledValue ?? true)
  const firstVisibleIndex = ref(0)
  const composable = useJumpBuckets({ endpoint, query, enabled, firstVisibleIndex })
  return { ...composable, endpoint, query, enabled, firstVisibleIndex }
}

describe('useJumpBuckets', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('fetches buckets for an eligible sort', async () => {
    mockBucketsResponse(LETTER_BUCKETS)
    const { buckets, kind } = makeBuckets()
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(buckets.value).toEqual(LETTER_BUCKETS)
    expect(kind.value).toBe('letter')
  })

  it('does not fetch when the sort is ineligible', async () => {
    const { buckets, kind } = makeBuckets({ sort: [{ field: 'addedAt', dir: 'desc' }] })
    await flush()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(buckets.value).toEqual([])
    expect(kind.value).toBeNull()
  })

  it('does not fetch while disabled and fetches once enabled', async () => {
    mockBucketsResponse(LETTER_BUCKETS)
    const { buckets, enabled } = makeBuckets({ enabledValue: false })
    await flush()
    expect(fetchMock).not.toHaveBeenCalled()

    enabled.value = true
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(buckets.value).toEqual(LETTER_BUCKETS)
  })

  it('serves repeated queries from the cache', async () => {
    mockBucketsResponse(LETTER_BUCKETS)
    const { query } = makeBuckets()
    await flush()

    query.value = { sort: [{ field: 'author', dir: 'asc' }] }
    await flush()
    query.value = { sort: [{ field: 'title', dir: 'asc' }] }
    await flush()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refresh bypasses the cache for the current query', async () => {
    mockBucketsResponse(LETTER_BUCKETS)
    const { refresh } = makeBuckets()
    await flush()

    refresh()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('derives the active bucket from the first visible index', async () => {
    mockBucketsResponse(LETTER_BUCKETS)
    const { activeBucket, firstVisibleIndex } = makeBuckets()
    await flush()

    expect(activeBucket.value?.key).toBe('#')

    firstVisibleIndex.value = 3
    expect(activeBucket.value?.key).toBe('A')

    firstVisibleIndex.value = 9
    expect(activeBucket.value?.key).toBe('A')

    firstVisibleIndex.value = 10
    expect(activeBucket.value?.key).toBe('C')

    firstVisibleIndex.value = 500
    expect(activeBucket.value?.key).toBe('Z')
  })

  it('clears buckets when the endpoint becomes null', async () => {
    mockBucketsResponse(LETTER_BUCKETS)
    const { buckets, endpoint } = makeBuckets()
    await flush()
    expect(buckets.value).toHaveLength(4)

    endpoint.value = null
    await flush()
    expect(buckets.value).toEqual([])
  })
})
