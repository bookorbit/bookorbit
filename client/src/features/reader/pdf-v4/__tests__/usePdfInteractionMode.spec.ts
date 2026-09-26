import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockUsePan = vi.hoisted(() => vi.fn<() => unknown>())
const mockUseInteractionManager = vi.hoisted(() => vi.fn<() => unknown>())

vi.mock('@embedpdf/plugin-pan/vue', () => ({ usePan: mockUsePan }))
vi.mock('@embedpdf/plugin-interaction-manager/vue', () => ({ useInteractionManager: mockUseInteractionManager }))

const { usePdfInteractionMode } = await import('../composables/usePdfInteractionMode')

describe('usePdfInteractionMode', () => {
  const togglePan = vi.fn<() => void>()
  const disablePan = vi.fn<() => void>()
  const activate = vi.fn<(mode: string) => void>()
  const isPanning = ref(true)

  beforeEach(() => {
    vi.clearAllMocks()
    mockUsePan.mockReturnValue({
      isPanning,
      provides: ref({ togglePan, disablePan }),
    })
    mockUseInteractionManager.mockReturnValue({
      provides: ref({ activate }),
    })
  })

  it('activates pointer mode directly when selecting text on a touch device', () => {
    const mode = usePdfInteractionMode(ref('document-1'))

    mode.activateTextSelection()

    expect(activate).toHaveBeenCalledExactlyOnceWith('pointerMode')
    expect(disablePan).not.toHaveBeenCalled()
    expect(mode.isPanning).toBe(isPanning)
  })

  it('toggles pan through the document-scoped pan capability', () => {
    const mode = usePdfInteractionMode(ref('document-1'))

    mode.togglePan()

    expect(togglePan).toHaveBeenCalledOnce()
  })

  it('keeps tool actions safe while the document capabilities are unavailable', () => {
    mockUsePan.mockReturnValue({ isPanning, provides: ref(null) })
    mockUseInteractionManager.mockReturnValue({ provides: ref(null) })
    const mode = usePdfInteractionMode(ref('document-1'))

    expect(() => mode.togglePan()).not.toThrow()
    expect(() => mode.activateTextSelection()).not.toThrow()
  })
})
