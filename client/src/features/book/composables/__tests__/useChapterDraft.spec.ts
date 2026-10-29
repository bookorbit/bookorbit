// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useChapterDraft } from '../useChapterDraft'

const CHAPTERS = [
  { title: 'Opening', startMs: 0 },
  { title: 'Chapter 1', startMs: 10_000 },
  { title: 'Chapter 2', startMs: 20_000 },
]

function makeDraft(total: number | null = 30_000) {
  const draft = useChapterDraft(ref(total))
  draft.reset(CHAPTERS)
  return draft
}

function keyAt(draft: ReturnType<typeof makeDraft>, index: number): string {
  return draft.rows.value[index]!.key
}

describe('useChapterDraft', () => {
  it('starts clean on the first row and turns dirty on an edit', () => {
    const draft = makeDraft()

    expect(draft.isDirty.value).toBe(false)
    expect(draft.activeRow.value?.title).toBe('Opening')

    draft.updateTitle(keyAt(draft, 1), 'Chapter One')

    expect(draft.isDirty.value).toBe(true)
    expect(draft.chapters()[1]).toEqual({ title: 'Chapter One', startMs: 10_000 })
  })

  it('remembers where each row started when it was loaded, and not for rows added since', () => {
    const draft = makeDraft()
    const key = keyAt(draft, 1)

    draft.nudge(key, 400)
    draft.apply([...draft.rows.value, { key: 'added', title: 'New', startMs: 25_000 }])

    expect(draft.rows.value[1]!.startMs).toBe(10_400)
    expect(draft.savedStartOf(key)).toBe(10_000)
    expect(draft.savedStartOf('added')).toBeNull()
  })

  it('folds a run of keystrokes into one undo step, and starts a new one after settling', () => {
    const draft = makeDraft()
    const key = keyAt(draft, 1)

    draft.updateTitle(key, 'C')
    draft.updateTitle(key, 'Ch')
    draft.updateTitle(key, 'Cha')
    draft.settle()
    draft.updateTitle(key, 'Chapter')
    draft.undo()

    expect(draft.rows.value[1]!.title).toBe('Cha')
    draft.undo()
    expect(draft.rows.value[1]!.title).toBe('Chapter 1')
    expect(draft.isDirty.value).toBe(false)
    expect(draft.canUndo.value).toBe(false)

    draft.redo()
    expect(draft.rows.value[1]!.title).toBe('Cha')
  })

  it('collapses repeated nudges of one row into one step', () => {
    const draft = makeDraft()
    const key = keyAt(draft, 2)

    draft.nudge(key, 100)
    draft.nudge(key, 100)
    draft.nudge(key, 100)

    expect(draft.rows.value[2]!.startMs).toBe(20_300)
    draft.undo()
    expect(draft.rows.value[2]!.startMs).toBe(20_000)
  })

  it('keeps rows in time order when a start passes its neighbour, and keeps the row active', () => {
    const draft = makeDraft()
    const key = keyAt(draft, 1)
    draft.setActive(key)

    draft.updateStart(key, 25_000)

    expect(draft.rows.value.map((row) => row.title)).toEqual(['Opening', 'Chapter 2', 'Chapter 1'])
    expect(draft.activeKey.value).toBe(key)
    expect(draft.activeIndex.value).toBe(2)
  })

  it('reports issues and counts errors apart from warnings', () => {
    const draft = makeDraft(30_000)

    draft.updateTitle(keyAt(draft, 1), ' ')
    draft.updateStart(keyAt(draft, 2), 35_000)

    expect(draft.errorCount.value).toBe(2)
    expect(draft.issuesByKey.value.get(keyAt(draft, 1))?.map((issue) => issue.code)).toEqual(['emptyTitle'])
  })

  it('moves the active row to a neighbour when its row is removed, and drops it from the selection', () => {
    const draft = makeDraft()
    const removed = keyAt(draft, 1)
    draft.setActive(removed)
    draft.toggleSelected(removed)

    draft.apply(draft.rows.value.filter((row) => row.key !== removed))

    expect(draft.activeRow.value?.title).toBe('Chapter 2')
    expect(draft.selected.value.size).toBe(0)
  })

  it('selects a range with shift, and targets the selection or else every row', () => {
    const draft = makeDraft()
    draft.setActive(keyAt(draft, 0))

    expect(draft.targetKeys().size).toBe(3)
    draft.toggleSelected(keyAt(draft, 1), { range: true })

    expect([...draft.selected.value]).toEqual([keyAt(draft, 0), keyAt(draft, 1)])
    expect(draft.targetKeys().size).toBe(2)
    expect(draft.keysFromActive().size).toBe(3)
  })

  it('treats a reset as the new saved state and keeps the same chapter active', () => {
    const draft = makeDraft()
    draft.setActive(keyAt(draft, 2))
    draft.updateTitle(keyAt(draft, 2), 'Changed')

    draft.reset([...CHAPTERS.slice(0, 2), { title: 'Changed', startMs: 20_000 }])

    expect(draft.isDirty.value).toBe(false)
    expect(draft.canUndo.value).toBe(false)
    expect(draft.activeRow.value?.title).toBe('Changed')
  })

  it('keeps the chapter in the same place active when a reset undoes a moved start', () => {
    const draft = makeDraft()
    draft.setActive(keyAt(draft, 2))
    draft.nudge(keyAt(draft, 2), 100)

    draft.reset(CHAPTERS)

    expect(draft.activeIndex.value).toBe(2)
    expect(draft.activeRow.value?.startMs).toBe(20_000)
  })
})

it('acknowledges a saved baseline without dropping a later edit or undo history', () => {
  const draft = makeDraft()
  draft.updateTitle(keyAt(draft, 0), 'Saved')
  const saved = draft.chapters()
  const generation = draft.generation.value
  draft.updateTitle(keyAt(draft, 1), 'Newer')
  draft.acknowledge(saved, generation)
  expect(draft.rows.value[1].title).toBe('Newer')
  expect(draft.isDirty.value).toBe(true)
  expect(draft.canUndo.value).toBe(true)
})

it('retains the checkbox selection anchor when focus activates another row', () => {
  const draft = makeDraft()
  draft.toggleSelected(keyAt(draft, 0))
  draft.setActive(keyAt(draft, 2))
  draft.toggleSelected(keyAt(draft, 2), { range: true })
  expect(draft.selected.value.size).toBe(3)
})
