import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick, ref, type Ref } from 'vue'
import { useSettingsNavStatus } from '../useSettingsNavStatus'

const harness = vi.hoisted(() => ({
  fetchCount: 0,
  subscribed: [] as number[],
  setLibraries: (() => {}) as (ids: number[]) => void,
  setScanning: (() => {}) as (ids: number[]) => void,
  reset: (() => {}) as () => void,
}))

vi.mock('@/features/library/composables/useLibraries', async () => {
  const { ref: makeRef } = await import('vue')
  const libraries = makeRef<{ id: number }[]>([])
  harness.setLibraries = (ids) => {
    libraries.value = ids.map((id) => ({ id }))
  }
  return {
    useLibraries: () => ({
      libraries,
      fetchLibraries: () => {
        harness.fetchCount += 1
      },
    }),
  }
})

vi.mock('@/features/scanner/composables/useScanProgress', async () => {
  const { ref: makeRef } = await import('vue')
  const scanning = makeRef<number[]>([])
  harness.setScanning = (ids) => {
    scanning.value = ids
  }
  return {
    useScanProgress: () => ({
      subscribeLibrary: (id: number) => harness.subscribed.push(id),
      isScanning: (id: number) => scanning.value.includes(id),
    }),
  }
})

/** The mocked composables share one module-level ref, so a leftover mount keeps watching it. */
const mounted: { unmount: () => void }[] = []

function mountStatus(enabled: Ref<boolean>) {
  const seen = { isLibraryScanning: ref(false) }
  const wrapper = mount(
    defineComponent({
      setup() {
        seen.isLibraryScanning = useSettingsNavStatus(enabled).isLibraryScanning as Ref<boolean>
        return () => null
      },
    }),
  )
  mounted.push(wrapper)
  return { wrapper, seen }
}

describe('useSettingsNavStatus', () => {
  afterEach(() => {
    while (mounted.length) mounted.pop()?.unmount()
  })

  beforeEach(() => {
    harness.fetchCount = 0
    harness.subscribed = []
    harness.setLibraries([])
    harness.setScanning([])
  })

  it('stays inert while the libraries row is hidden', async () => {
    harness.setLibraries([1, 2])
    harness.setScanning([1])
    const { seen } = mountStatus(ref(false))
    await nextTick()

    expect(harness.fetchCount).toBe(0)
    expect(harness.subscribed).toEqual([])
    expect(seen.isLibraryScanning.value).toBe(false)
  })

  it('loads the libraries and joins their scan rooms once enabled', async () => {
    harness.setLibraries([4, 7])
    mountStatus(ref(true))
    await nextTick()

    expect(harness.fetchCount).toBeGreaterThan(0)
    expect(harness.subscribed).toEqual([4, 7])
  })

  it('reports a scan running on any visible library', async () => {
    harness.setLibraries([4, 7])
    const { seen } = mountStatus(ref(true))
    await nextTick()
    expect(seen.isLibraryScanning.value).toBe(false)

    harness.setScanning([7])
    await nextTick()
    expect(seen.isLibraryScanning.value).toBe(true)
  })

  it('subscribes to libraries that arrive after the first render', async () => {
    mountStatus(ref(true))
    await nextTick()
    expect(harness.subscribed).toEqual([])

    harness.setLibraries([9])
    await nextTick()
    expect(harness.subscribed).toEqual([9])
  })

  it('starts working when the row becomes visible later', async () => {
    const enabled = ref(false)
    harness.setLibraries([3])
    mountStatus(enabled)
    await nextTick()
    expect(harness.subscribed).toEqual([])

    enabled.value = true
    await nextTick()
    expect(harness.subscribed).toEqual([3])
  })
})
