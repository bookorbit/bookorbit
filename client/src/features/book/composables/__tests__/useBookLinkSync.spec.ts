import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookCard, BookLinksChangedEvent } from '@bookorbit/types'

const events = vi.hoisted(() => ({ linksChanged: null as ((event: BookLinksChangedEvent) => void) | null }))

vi.mock('../useBookEvents', () => ({
  useBookEvents: () => ({
    onBookLinksChanged: (callback: (event: BookLinksChangedEvent) => void) => {
      events.linksChanged = callback
      return () => undefined
    },
  }),
}))

import { useBookLinkSync } from '../useBookLinkSync'

function card(id: number, linkedIds: number[] = []): BookCard {
  return {
    id,
    linked:
      linkedIds.length > 0
        ? {
            groupId: 1,
            memberCount: linkedIds.length + 1,
            books: linkedIds.map((bookId) => ({ bookId, libraryId: 2, formats: ['m4b'], mediaKind: 'audiobook' })),
          }
        : undefined,
  } as unknown as BookCard
}

function setup(books: BookCard[], affectsScope?: (event: BookLinksChangedEvent) => boolean) {
  const refresh = vi.fn<() => void>()
  const scope = effectScope()
  scope.run(() => useBookLinkSync({ books: ref(books), refresh, affectsScope }))
  return { refresh, scope }
}

function emit(event: BookLinksChangedEvent) {
  events.linksChanged?.(event)
}

describe('useBookLinkSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    events.linksChanged = null
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reloads once, shortly after, when a change touches a loaded card', () => {
    const { refresh } = setup([card(1), card(2)])

    emit({ libraryId: 5, bookIds: [2, 90] })
    emit({ libraryId: 6, bookIds: [2, 90] })
    expect(refresh).not.toHaveBeenCalled()

    vi.advanceTimersByTime(300)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('reloads when a loaded card shows a linked book the change touches', () => {
    const { refresh } = setup([card(1, [40])])

    emit({ libraryId: 6, bookIds: [40] })
    vi.advanceTimersByTime(300)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('ignores a change elsewhere unless the view says it concerns its scope', () => {
    const scoped = setup([card(1)], (event) => event.libraryId === 5)

    emit({ libraryId: 9, bookIds: [70, 71] })
    vi.advanceTimersByTime(300)
    expect(scoped.refresh).not.toHaveBeenCalled()

    emit({ libraryId: 5, bookIds: [70, 71] })
    vi.advanceTimersByTime(300)
    expect(scoped.refresh).toHaveBeenCalledOnce()
  })

  it('drops a pending reload when the view goes away', () => {
    const { refresh, scope } = setup([card(1)])

    emit({ libraryId: 5, bookIds: [1] })
    scope.stop()
    vi.advanceTimersByTime(300)
    expect(refresh).not.toHaveBeenCalled()
  })
})
