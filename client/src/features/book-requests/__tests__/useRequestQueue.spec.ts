// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import type { BookRequestItem } from '@bookorbit/types'
import { useRequestQueue } from '../composables/useRequestQueue'

function row(id: number, companionId?: number): BookRequestItem {
  return { id, companion: companionId === undefined ? null : ({ id: companionId } as BookRequestItem) } as BookRequestItem
}

describe('useRequestQueue', () => {
  /** The drawer can be open on the audiobook while the row it belongs to is led by the ebook. */
  it("places either half of a pair at the pair's row, and steps to the rows around it", () => {
    const queue = useRequestQueue(ref([row(1), row(10, 11), row(2)]), ref(11))

    expect(queue.position.value).toBe(2)
    expect(queue.previousId.value).toBe(1)
    expect(queue.nextId.value).toBe(2)
  })

  it('hides the position of a request the list is not showing', () => {
    const queue = useRequestQueue(ref([row(1)]), ref(99))

    expect(queue.position.value).toBe(0)
    expect(queue.hasNext.value).toBe(false)
  })
})
