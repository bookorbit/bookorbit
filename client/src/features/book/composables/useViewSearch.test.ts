import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { nextTick } from 'vue'
import { useViewSearch } from './useViewSearch'

describe('useViewSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('initializes with empty query', () => {
    const { searchQuery, debouncedQuery } = useViewSearch()
    expect(searchQuery.value).toBe('')
    expect(debouncedQuery.value).toBe('')
  })

  it('does not update debouncedQuery immediately', async () => {
    const { searchQuery, debouncedQuery } = useViewSearch()
    searchQuery.value = 'hello'
    await nextTick()
    expect(debouncedQuery.value).toBe('')
  })

  it('updates debouncedQuery after 300ms', async () => {
    const { searchQuery, debouncedQuery } = useViewSearch()
    searchQuery.value = 'hello'
    await nextTick()
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(debouncedQuery.value).toBe('hello')
  })

  it('debounces rapid updates by resetting the 300ms timer', async () => {
    const { searchQuery, debouncedQuery } = useViewSearch()
    searchQuery.value = 'he'
    await nextTick()
    vi.advanceTimersByTime(200)
    searchQuery.value = 'hello'
    await nextTick()
    vi.advanceTimersByTime(200)
    expect(debouncedQuery.value).toBe('')
    vi.advanceTimersByTime(100)
    await nextTick()
    expect(debouncedQuery.value).toBe('hello')
  })

  it('clears both queries immediately', async () => {
    const { searchQuery, debouncedQuery, clearSearch } = useViewSearch()
    searchQuery.value = 'hello'
    await nextTick()
    vi.advanceTimersByTime(300)
    await nextTick()
    clearSearch()
    expect(searchQuery.value).toBe('')
    expect(debouncedQuery.value).toBe('')
  })

  it('cancels pending debounce on clear', async () => {
    const { searchQuery, debouncedQuery, clearSearch } = useViewSearch()
    searchQuery.value = 'hello'
    await nextTick()
    clearSearch()
    vi.advanceTimersByTime(300)
    await nextTick()
    expect(debouncedQuery.value).toBe('')
  })
})
