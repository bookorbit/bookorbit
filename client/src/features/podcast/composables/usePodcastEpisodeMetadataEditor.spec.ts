// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastEpisodeSummary } from '@bookorbit/types'
import { api } from '@/lib/api'
import { usePodcastEpisodeMetadataEditor } from './usePodcastEpisodeMetadataEditor'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

const apiMock = vi.mocked(api)

function episode(overrides: Partial<PodcastEpisodeSummary> = {}): PodcastEpisodeSummary {
  return {
    id: 42,
    libraryId: 7,
    origin: 'feed',
    podcastId: 12,
    podcastTitle: 'Orbit Radio',
    podcastImageUrl: null,
    title: 'Orbital mechanics',
    subtitle: 'Part one',
    description: '<p>About the launch</p>',
    publishedAt: '2026-07-29T10:00:00.000Z',
    season: '2',
    episode: '14',
    episodeType: 'full',
    durationSeconds: 1800,
    audioFormat: 'mp3',
    explicit: false,
    chapters: [],
    transcripts: [],
    lockedFields: [],
    inFeed: true,
    mediaStatus: 'remote',
    localSizeBytes: null,
    checksum: null,
    positionSeconds: 0,
    progressPercent: 0,
    finished: false,
    pinned: false,
    queued: false,
    lastListenedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

function savedResponse(body: PodcastEpisodeSummary) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('usePodcastEpisodeMetadataEditor', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('sends only the fields the user changed', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())

    editor.form.subtitle = 'Part two'
    editor.form.explicit = true

    expect(editor.buildPayload()).toEqual({ subtitle: 'Part two', explicit: true })
  })

  it('treats a cleared optional field as an explicit null', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())

    editor.form.season = '   '
    editor.form.durationMinutes = ''

    expect(editor.buildPayload()).toEqual({ season: null, durationSeconds: null })
  })

  it('ignores whitespace-only edits that would send nothing', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())

    editor.form.title = ' Orbital mechanics '

    expect(editor.isDirty.value).toBe(true)
    expect(editor.hasChanges.value).toBe(false)
    expect(editor.buildPayload()).toEqual({})
  })

  it('converts the duration between the minutes the form shows and the seconds the API stores', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())

    expect(editor.form.durationMinutes).toBe('30')
    editor.form.durationMinutes = '45.5'

    expect(editor.buildPayload()).toEqual({ durationSeconds: 2730 })
  })

  it('flags a duration that is not a positive number instead of silently clearing it', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())

    editor.form.durationMinutes = '0'

    expect(editor.durationInvalid.value).toBe(true)
    editor.form.durationMinutes = '12'
    expect(editor.durationInvalid.value).toBe(false)
  })

  it('sends the published date as an instant and ignores a re-entered equivalent value', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())
    const loaded = editor.form.publishedAt

    editor.form.publishedAt = loaded
    expect(editor.buildPayload()).toEqual({})

    editor.form.publishedAt = ''
    expect(editor.buildPayload()).toEqual({ publishedAt: null })
  })

  it('keeps a feed episode type outside the iTunes set selectable without treating it as an edit', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode({ episodeType: 'Full Episode' }))

    expect(editor.foreignEpisodeType.value).toBe('Full Episode')
    expect(editor.buildPayload()).toEqual({})

    editor.form.episodeType = 'bonus'
    expect(editor.buildPayload()).toEqual({ episodeType: 'bonus' })
  })

  it('opens against a server whose episode payload predates the lock field', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    const withoutLocks = episode()
    delete (withoutLocks as { lockedFields?: string[] }).lockedFields

    expect(() => editor.load(withoutLocks)).not.toThrow()
    expect(editor.lockedFields.value).toEqual([])
    expect(editor.form.title).toBe('Orbital mechanics')
  })

  it('previews the lock a changed field gains on save', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())

    expect(editor.willLock('subtitle')).toBe(false)
    editor.form.subtitle = 'Part two'

    expect(editor.willLock('subtitle')).toBe(true)
    expect(editor.isLocked('subtitle')).toBe(false)
  })

  it('sends the remaining lock set when a field is unlocked without being edited', () => {
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode({ lockedFields: ['title', 'season', 'chapters'] }))

    editor.toggleLock('season')

    expect(editor.buildPayload()).toEqual({ lockedFields: ['title', 'chapters'] })
  })

  it('adopts the values and lock set the server returns', async () => {
    apiMock.mockResolvedValue(savedResponse(episode({ subtitle: 'Part two', lockedFields: ['subtitle'] })))
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())
    editor.form.subtitle = 'Part two'

    const result = await editor.save(42)

    expect(result?.lockedFields).toEqual(['subtitle'])
    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-episodes/42/metadata', expect.objectContaining({ method: 'PATCH' }))
    expect(JSON.parse(String(apiMock.mock.calls[0]?.[1]?.body))).toEqual({ subtitle: 'Part two' })
    expect(editor.isLocked('subtitle')).toBe(true)
    expect(editor.isDirty.value).toBe(false)
  })

  it('reports a rejected save in the reader language rather than the server English', async () => {
    apiMock.mockResolvedValue(new Response(JSON.stringify({ message: 'Podcast episode title cannot be empty' }), { status: 400 }))
    const editor = usePodcastEpisodeMetadataEditor()
    editor.load(episode())
    editor.form.title = 'Something else'

    await expect(editor.save(42)).resolves.toBeNull()
    expect(editor.error.value).toBe('Failed to update episode')
    expect(editor.isDirty.value).toBe(true)
  })
})
