import { describe, expect, it, vi, beforeEach } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { DEFAULT_METADATA_SCORE_WEIGHTS } from '@bookorbit/types'
import { useScoreWeightsDraft } from '../useScoreWeightsDraft'
import { fieldsInGroup } from '../../lib/score-weights'

const requests: { url: string; method: string; body: Record<string, number> | undefined }[] = []
let patchOk = true
let getOk = true
/** Saved state differs from the shipped defaults so the two are never confused in an assertion. */
let stored: Record<string, number> = { ...DEFAULT_METADATA_SCORE_WEIGHTS, tags: 5 }

vi.mock('@/lib/api', () => ({
  api: vi.fn<(url: string, init?: RequestInit) => Promise<unknown>>((url, init) => {
    const method = init?.method ?? 'GET'
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (method === 'PATCH') return Promise.resolve({ ok: patchOk, status: patchOk ? 200 : 403, json: () => Promise.resolve({}) })
    return Promise.resolve({ ok: getOk, status: getOk ? 200 : 500, json: () => Promise.resolve(stored) })
  }),
}))

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(m: string) => void>(), error: vi.fn<(m: string) => void>() } }))

async function setup() {
  let draft!: ReturnType<typeof useScoreWeightsDraft>
  mount(
    defineComponent({
      setup() {
        draft = useScoreWeightsDraft()
        return () => null
      },
    }),
  )
  await draft.load()
  await nextTick()
  return draft
}

beforeEach(() => {
  requests.length = 0
  patchOk = true
  getOk = true
  stored = { ...DEFAULT_METADATA_SCORE_WEIGHTS, tags: 5 }
})

describe('useScoreWeightsDraft', () => {
  it('loads saved weights and starts clean', async () => {
    const draft = await setup()
    expect(draft.saved.value.tags).toBe(5)
    expect(draft.draft.value.tags).toBe(5)
    expect(draft.isDirty.value).toBe(false)
    expect(draft.changed.value).toEqual([])
  })

  it('clamps a weight the server sent out of range', async () => {
    stored = { ...DEFAULT_METADATA_SCORE_WEIGHTS, title: -3 }
    const draft = await setup()
    expect(draft.draft.value.title).toBe(0)
  })

  it('survives a failed load without wiping the editor', async () => {
    getOk = false
    const draft = await setup()
    expect(draft.loadFailed.value).toBe(true)
    expect(draft.draft.value.title).toBe(DEFAULT_METADATA_SCORE_WEIGHTS.title)
  })

  it('tracks dirty state and reverts on discard', async () => {
    const draft = await setup()
    draft.setWeight('title', 12)
    expect(draft.isDirty.value).toBe(true)
    expect(draft.changed.value).toEqual(['title'])
    draft.discard()
    expect(draft.isDirty.value).toBe(false)
    expect(draft.draft.value.title).toBe(DEFAULT_METADATA_SCORE_WEIGHTS.title)
  })

  it('keeps the totals of draft and saved apart', async () => {
    const draft = await setup()
    const before = draft.total.value
    draft.setWeight('title', draft.draft.value.title + 4)
    expect(draft.total.value).toBe(before + 4)
    expect(draft.savedTotal.value).toBe(before)
  })

  it('adjusts without dropping below zero', async () => {
    const draft = await setup()
    draft.setWeight('rating', 1)
    draft.adjustWeight('rating', -1)
    draft.adjustWeight('rating', -1)
    expect(draft.draft.value.rating).toBe(0)
  })

  it('switches a whole group off in one move', async () => {
    const draft = await setup()
    draft.setGroupScoring('providers', false)
    for (const field of fieldsInGroup('providers')) expect(draft.draft.value[field]).toBe(0)
    expect(draft.scoringCount.value).toBe(21 - 8)
  })

  it('restores the weights a group had rather than the shipped defaults', async () => {
    const draft = await setup()
    draft.setWeight('googleBooksId', 6)
    draft.setGroupScoring('providers', false)
    expect(draft.draft.value.googleBooksId).toBe(0)
    draft.setGroupScoring('providers', true)
    expect(draft.draft.value.googleBooksId).toBe(6)
  })

  it('falls back to defaults when a group is switched on without history', async () => {
    stored = Object.fromEntries(Object.keys(DEFAULT_METADATA_SCORE_WEIGHTS).map((field) => [field, 0]))
    const draft = await setup()
    draft.setGroupScoring('core', true)
    expect(draft.draft.value.title).toBe(DEFAULT_METADATA_SCORE_WEIGHTS.title)
  })

  it('resets one group without touching the rest', async () => {
    const draft = await setup()
    draft.setWeight('title', 1)
    draft.setWeight('tags', 9)
    draft.resetGroup('core')
    expect(draft.draft.value.title).toBe(DEFAULT_METADATA_SCORE_WEIGHTS.title)
    expect(draft.draft.value.tags).toBe(9)
  })

  it('resets every field to the shipped defaults', async () => {
    const draft = await setup()
    draft.resetToDefaults()
    expect(draft.draft.value.tags).toBe(DEFAULT_METADATA_SCORE_WEIGHTS.tags)
    // Saved still holds 5, so resetting is itself an unsaved change.
    expect(draft.isDirty.value).toBe(true)
  })

  it('sends the draft and clears dirty on save', async () => {
    const draft = await setup()
    draft.setWeight('title', 12)
    await expect(draft.save()).resolves.toBe(true)
    const patch = requests.find((request) => request.method === 'PATCH')
    expect(patch?.url).toBe('/api/v1/metadata-score/weights')
    expect(patch?.body?.title).toBe(12)
    expect(draft.isDirty.value).toBe(false)
    expect(draft.saved.value.title).toBe(12)
  })

  it('keeps the edit when the server rejects the save', async () => {
    patchOk = false
    const draft = await setup()
    draft.setWeight('title', 12)
    await expect(draft.save()).resolves.toBe(false)
    expect(draft.isDirty.value).toBe(true)
    expect(draft.draft.value.title).toBe(12)
    expect(draft.saved.value.title).toBe(DEFAULT_METADATA_SCORE_WEIGHTS.title)
  })

  it('does not send anything when nothing changed', async () => {
    const draft = await setup()
    await expect(draft.save()).resolves.toBe(false)
    expect(requests.some((request) => request.method === 'PATCH')).toBe(false)
  })
})
