// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PODCAST_ERROR_CODES, type PodcastSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import { makeShow } from '../test/fixtures'
import { usePodcastMetadataEditor } from './usePodcastMetadataEditor'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

const apiMock = vi.mocked(api)

function show(overrides: Partial<PodcastSummary> = {}): PodcastSummary {
  return makeShow({
    author: 'Orbit Media',
    description: '<p>Space talk</p>',
    imageUrl: '/api/v1/podcasts/12/artwork',
    siteUrl: 'https://orbit.example',
    language: 'en',
    podcastType: 'episodic',
    categories: ['Science'],
    nextRefreshAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  })
}

function savedResponse(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('usePodcastMetadataEditor', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('sends only the fields the user changed', () => {
    const editor = usePodcastMetadataEditor()
    editor.load(show())

    editor.form.author = 'Orbit Studios'
    editor.form.explicit = true

    expect(editor.buildPayload()).toEqual({ author: 'Orbit Studios', explicit: true })
  })

  it('treats a cleared optional field as an explicit null', () => {
    const editor = usePodcastMetadataEditor()
    editor.load(show())

    editor.form.siteUrl = '   '

    expect(editor.buildPayload()).toEqual({ siteUrl: null })
  })

  it('ignores whitespace-only edits that would send nothing', () => {
    const editor = usePodcastMetadataEditor()
    editor.load(show())

    editor.form.title = ' Orbit Radio '

    expect(editor.isDirty.value).toBe(true)
    expect(editor.hasChanges.value).toBe(false)
    expect(editor.buildPayload()).toEqual({})
  })

  it('previews the lock a changed field gains on save', () => {
    const editor = usePodcastMetadataEditor()
    editor.load(show())

    expect(editor.willLock('author')).toBe(false)
    editor.form.author = 'Orbit Studios'

    expect(editor.willLock('author')).toBe(true)
    expect(editor.isLocked('author')).toBe(false)
    expect(editor.buildPayload()).toEqual({ author: 'Orbit Studios' })
  })

  it('sends the remaining lock set when a field is unlocked without being edited', () => {
    const editor = usePodcastMetadataEditor()
    editor.load(show({ lockedFields: ['title', 'author', 'imageUrl'] }))

    editor.toggleLock('author')

    expect(editor.buildPayload()).toEqual({ lockedFields: ['title', 'imageUrl'] })
  })

  it('adds categories once, ignoring case and blanks', () => {
    const editor = usePodcastMetadataEditor()
    editor.load(show())

    expect(editor.addCategory('  Technology ')).toBe(true)
    expect(editor.addCategory('technology')).toBe(false)
    expect(editor.addCategory('   ')).toBe(false)
    editor.removeCategory('Science')

    expect(editor.form.categories).toEqual(['Technology'])
    expect(editor.buildPayload()).toEqual({ categories: ['Technology'] })
  })

  it('adopts the saved values and lock set the server returns', async () => {
    apiMock.mockResolvedValue(
      savedResponse({
        id: 12,
        title: 'Orbit Radio',
        author: 'Orbit Studios',
        description: '<p>Space talk</p>',
        siteUrl: 'https://orbit.example',
        language: 'en',
        explicit: false,
        categories: ['Science'],
        lockedFields: ['author'],
      }),
    )
    const editor = usePodcastMetadataEditor()
    editor.load(show())
    editor.form.author = 'Orbit Studios'

    const result = await editor.save(12)

    expect(result?.lockedFields).toEqual(['author'])
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcasts/12/metadata', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body))).toEqual({ author: 'Orbit Studios' })
    expect(editor.isLocked('author')).toBe(true)
    expect(editor.isDirty.value).toBe(false)
  })

  it('reports a rejected save in the reader language rather than the server English', async () => {
    apiMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Podcast title cannot be empty' }), { status: 400 }))
    const editor = usePodcastMetadataEditor()
    editor.load(show())
    editor.form.title = 'Something else'

    await expect(editor.save(12)).resolves.toBeNull()
    expect(editor.error.value).toBe('Failed to update podcast')
    expect(editor.isDirty.value).toBe(true)
  })

  it('prefers the copy keyed off the server error code over the generic fallback', async () => {
    apiMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'A local show has no feed', errorCode: PODCAST_ERROR_CODES.localNoRefresh }), { status: 400 }),
    )
    const editor = usePodcastMetadataEditor()
    editor.load(show())
    editor.form.title = 'Something else'

    await expect(editor.save(12)).resolves.toBeNull()
    expect(editor.error.value).toBe('This show has no feed, so there is nothing to refresh.')
  })
})
