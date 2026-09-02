import { describe, expect, it } from 'vitest'

import { useSettingsDraft } from '../composables/useSettingsDraft'

interface Row {
  id: number | null
  name: string
}

describe('useSettingsDraft', () => {
  it('starts closed with nothing being edited', () => {
    const { draft, open, isDirty } = useSettingsDraft<Row>()

    expect(draft.value).toBeNull()
    expect(open.value).toBe(false)
    expect(isDirty.value).toBe(false)
  })

  it('opens on a record and reports it untouched', () => {
    const { draft, open, isDirty, start } = useSettingsDraft<Row>()

    start({ id: 1, name: 'Jackett' })

    expect(draft.value).toEqual({ id: 1, name: 'Jackett' })
    expect(open.value).toBe(true)
    expect(isDirty.value).toBe(false)
  })

  it('reports a typed change, and forgets it once marked pristine', () => {
    const { draft, isDirty, start, markPristine } = useSettingsDraft<Row>()
    start({ id: 1, name: 'Jackett' })

    draft.value!.name = 'Prowlarr'
    expect(isDirty.value).toBe(true)

    markPristine()
    expect(isDirty.value).toBe(false)
  })

  /** The sheet animates out, and unmounting the form it renders in the same tick skips that. */
  it('keeps the record after closing, so the sheet has something to animate out', () => {
    const { draft, open, start, close } = useSettingsDraft<Row>()
    start({ id: 1, name: 'Jackett' })

    close()

    expect(open.value).toBe(false)
    expect(draft.value).toEqual({ id: 1, name: 'Jackett' })
  })

  /** Otherwise the row behind a closed editor is refused a Test forever. */
  it('stops reporting dirty once the editor is closed', () => {
    const { draft, isDirty, start, close } = useSettingsDraft<Row>()
    start({ id: 1, name: 'Jackett' })
    draft.value!.name = 'Prowlarr'

    close()

    expect(isDirty.value).toBe(false)
  })

  it('replaces the record left behind when the next one opens', () => {
    const { draft, open, start, close } = useSettingsDraft<Row>()
    start({ id: 1, name: 'Jackett' })
    close()

    start({ id: 2, name: 'NZBHydra' })

    expect(open.value).toBe(true)
    expect(draft.value).toEqual({ id: 2, name: 'NZBHydra' })
  })
})
