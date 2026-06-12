import { nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useJumpRailGutter } from '../useJumpRailGutter'

describe('useJumpRailGutter', () => {
  it('reserves immediately when initially visible', () => {
    const visible = ref(true)
    const { gutterReserved } = useJumpRailGutter(visible)

    expect(gutterReserved.value).toBe(true)
  })

  it('reserves immediately on show and releases only after leave', async () => {
    const visible = ref(false)
    const { gutterReserved, releaseGutter } = useJumpRailGutter(visible)

    expect(gutterReserved.value).toBe(false)

    visible.value = true
    await nextTick()
    expect(gutterReserved.value).toBe(true)

    visible.value = false
    await nextTick()
    expect(gutterReserved.value).toBe(true)

    releaseGutter()
    expect(gutterReserved.value).toBe(false)
  })

  it('does not release while the rail is visible again', async () => {
    const visible = ref(true)
    const { gutterReserved, releaseGutter } = useJumpRailGutter(visible)

    visible.value = false
    await nextTick()
    visible.value = true
    await nextTick()

    releaseGutter()
    expect(gutterReserved.value).toBe(true)
  })
})
