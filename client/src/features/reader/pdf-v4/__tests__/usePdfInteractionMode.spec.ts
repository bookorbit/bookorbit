import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const activateTool = vi.hoisted(() => vi.fn<(toolId: string) => void>())
const activeToolId = ref<string | null>('pointer')

vi.mock('@embedpdf/vue/interaction', () => ({
  useInteraction: () => ({ activateTool }),
  useInteractionState: () => activeToolId,
}))

const { usePdfInteractionMode } = await import('../composables/usePdfInteractionMode')

describe('usePdfInteractionMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activateTool.mockImplementation(() => undefined)
    activeToolId.value = 'pointer'
  })

  it('reports panning from the active tool', () => {
    const mode = usePdfInteractionMode()
    expect(mode.isPanning.value).toBe(false)

    activeToolId.value = 'pan'
    expect(mode.isPanning.value).toBe(true)
  })

  it('toggles between the pan tool and text selection', () => {
    const mode = usePdfInteractionMode()

    mode.togglePan()
    expect(activateTool).toHaveBeenLastCalledWith('pan')

    activeToolId.value = 'pan'
    mode.togglePan()
    expect(activateTool).toHaveBeenLastCalledWith('pointer')
  })

  it('activates text selection directly', () => {
    activeToolId.value = 'pan'
    const mode = usePdfInteractionMode()

    mode.activateTextSelection()

    expect(activateTool).toHaveBeenCalledExactlyOnceWith('pointer')
  })

  it('keeps tool actions safe while no document is open', () => {
    activateTool.mockImplementation(() => {
      throw new Error('not-ready')
    })
    const mode = usePdfInteractionMode()

    expect(() => mode.togglePan()).not.toThrow()
    expect(() => mode.activateTextSelection()).not.toThrow()
  })
})
