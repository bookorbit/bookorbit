import { describe, it, expect, vi } from 'vitest'

const mockStorage: Record<string, string> = {}

vi.stubGlobal('localStorage', {
  getItem: (key: string) => mockStorage[key] ?? null,
  setItem: (key: string, value: string) => {
    mockStorage[key] = value
  },
  removeItem: (key: string) => {
    delete mockStorage[key]
  },
  clear: () => {
    Object.keys(mockStorage).forEach((k) => delete mockStorage[k])
  },
})

const breakpointMd = { value: true }
vi.mock('@vueuse/core', () => ({
  breakpointsTailwind: { sm: 640, md: 768, lg: 1024, xl: 1280, '2xl': 1536 },
  useBreakpoints: () => ({ md: breakpointMd }),
  watchDebounced: vi.fn<() => void>(),
}))

import { useEffectiveViewMode } from '@/composables/useEffectiveViewMode'

describe('useEffectiveViewMode', () => {
  it('returns same viewMode when on desktop', () => {
    breakpointMd.value = true
    const { viewMode, effectiveViewMode } = useEffectiveViewMode()
    viewMode.value = 'table'
    expect(effectiveViewMode.value).toBe('table')
  })

  it('forces grid on mobile when viewMode is table', () => {
    breakpointMd.value = false
    const { viewMode, effectiveViewMode } = useEffectiveViewMode()
    viewMode.value = 'table'
    expect(effectiveViewMode.value).toBe('grid')
  })

  it('keeps grid viewMode as-is on mobile', () => {
    breakpointMd.value = false
    const { viewMode, effectiveViewMode } = useEffectiveViewMode()
    viewMode.value = 'grid'
    expect(effectiveViewMode.value).toBe('grid')
  })

  it('keeps list viewMode as-is on mobile', () => {
    breakpointMd.value = false
    const { viewMode, effectiveViewMode } = useEffectiveViewMode()
    viewMode.value = 'list'
    expect(effectiveViewMode.value).toBe('list')
  })
})
