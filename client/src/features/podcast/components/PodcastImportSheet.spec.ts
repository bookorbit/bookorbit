import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PodcastImportReport, PodcastImportScanStatus } from '@bookorbit/types'
import { api } from '@/lib/api'
import PodcastImportSheet from './PodcastImportSheet.vue'
import { jsonResponse } from '../test/fixtures'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() } }))
vi.mock('../composables/usePodcastEvents', () => ({
  usePodcastEvents: () => ({ onImportProgress: vi.fn<() => void>() }),
}))

/** The shared sheet teleports out of the wrapper, so the panel is rendered in place for these assertions. */
vi.mock('@/components/ui/sheet', () => {
  const passthrough = (tag: string) =>
    defineComponent({
      setup:
        (_props, { slots }) =>
        () =>
          h(tag, slots.default?.()),
    }) as ReturnType<typeof defineComponent>
  return {
    Sheet: passthrough('div'),
    SheetContent: passthrough('div'),
    SheetHeader: passthrough('div'),
    SheetTitle: passthrough('h2'),
    SheetDescription: passthrough('p'),
    SheetFooter: passthrough('div'),
  }
})

const apiMock = vi.mocked(api)

function report(overrides: Partial<PodcastImportReport> = {}): PodcastImportReport {
  return {
    libraryId: 5,
    dryRun: true,
    startedAt: '2026-07-31T10:00:00.000Z',
    finishedAt: '2026-07-31T10:00:04.000Z',
    filesDiscovered: 3,
    filesScanned: 3,
    alreadyAdopted: 0,
    attached: 0,
    counts: { matched: 1, ambiguous: 1, unmatched: 1, duplicates: 0, skipped: 0, suggestedFeeds: 0, unclaimedFolders: 0 },
    matched: [
      {
        path: 'Orbit Radio [7]/one.mp3',
        fileName: 'one.mp3',
        sizeBytes: 1024,
        episodeId: 101,
        podcastId: 7,
        podcastTitle: 'Orbit Radio',
        episodeTitle: 'Landing on the Moon',
        tier: 'exact',
        signals: ['episode_guid'],
        scope: 'folder_suffix',
        attached: false,
      },
    ],
    ambiguous: [
      {
        path: 'Orbit Radio [7]/two.mp3',
        fileName: 'two.mp3',
        sizeBytes: 2048,
        scope: 'title_similarity',
        reason: 'single_fuzzy_signal',
        candidates: [
          {
            episodeId: 202,
            podcastId: 7,
            podcastTitle: 'Orbit Radio',
            episodeTitle: 'Docking Practice',
            publishedAt: '2026-03-04T09:00:00.000Z',
            durationSeconds: 1800,
            signals: ['title_and_date'],
          },
        ],
      },
    ],
    unmatched: [{ path: 'loose/three.mp3', fileName: 'three.mp3', sizeBytes: 512, reason: 'show_unresolved', podcastId: null, podcastTitle: null }],
    duplicates: [],
    suggestedFeeds: [],
    unclaimedFolders: [],
    skipped: [],
    unreadableFolders: [],
    quota: { adoptBytes: '1024', headroomBytes: '999999', exceeded: false },
    blockedReason: null,
    truncated: false,
    ...overrides,
  }
}

function status(overrides: Partial<PodcastImportScanStatus> = {}): PodcastImportScanStatus {
  return {
    job: {
      id: 9,
      status: 'completed',
      dryRun: true,
      progressCurrent: 3,
      progressTotal: 3,
      lastError: null,
      createdAt: '2026-07-31T10:00:00.000Z',
      updatedAt: '2026-07-31T10:00:04.000Z',
    },
    report: report(),
    ...overrides,
  }
}

async function mountSheet(initial: PodcastImportScanStatus = status()) {
  apiMock.mockResolvedValue(jsonResponse(initial))
  const wrapper = mount(PodcastImportSheet, { props: { open: true, libraryId: 5 } })
  await flushPromises()
  return wrapper
}

describe('PodcastImportSheet', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('loads the latest report and renders every group with its count', async () => {
    const wrapper = await mountSheet()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/podcast-libraries/5/import-scan/latest', undefined)
    expect(wrapper.text()).toContain('Landing on the Moon')
    expect(wrapper.text()).toContain('two.mp3')
    expect(wrapper.text()).toContain('three.mp3')
    expect(wrapper.text()).toContain('No show could be identified for this file')
  })

  it('starts a dry run without resolutions', async () => {
    const wrapper = await mountSheet()
    apiMock.mockClear()
    apiMock.mockResolvedValue(jsonResponse(status()))

    await wrapper.get('[data-testid="podcast-import-scan"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-libraries/5/import-scan',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ dryRun: true }) }),
    )
  })

  it('carries the episode a user picked for an ambiguous file into the apply run', async () => {
    const wrapper = await mountSheet()
    apiMock.mockClear()
    apiMock.mockResolvedValue(jsonResponse(status()))

    await wrapper.get('select').setValue('202')
    await wrapper.get('[data-testid="podcast-import-apply"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-libraries/5/import-scan',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ dryRun: false, resolutions: [{ path: 'Orbit Radio [7]/two.mp3', episodeId: 202 }] }),
      }),
    )
    expect(wrapper.emitted('applied')).toHaveLength(1)
  })

  it('does not offer to apply a report that already wrote', async () => {
    const wrapper = await mountSheet(status({ report: report({ dryRun: false, attached: 1 }) }))

    expect(wrapper.get('[data-testid="podcast-import-apply"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Adopted 1 files.')
  })

  it('shows the quota refusal instead of a success line when the run was blocked', async () => {
    const wrapper = await mountSheet(
      status({
        report: report({ dryRun: false, blockedReason: 'quota_exceeded', quota: { adoptBytes: '900', headroomBytes: '10', exceeded: true } }),
      }),
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('exceed this library')
  })

  it('subscribes to a suggested feed and tells the user to scan again', async () => {
    const wrapper = await mountSheet(
      status({
        report: report({
          counts: { matched: 0, ambiguous: 0, unmatched: 0, duplicates: 0, skipped: 0, suggestedFeeds: 1, unclaimedFolders: 0 },
          matched: [],
          ambiguous: [],
          unmatched: [],
          suggestedFeeds: [{ folderPath: 'Unknown Show', feedUrl: 'https://feeds.example/unknown.xml', source: 'feed_sidecar', fileCount: 4 }],
        }),
      }),
    )
    apiMock.mockClear()
    apiMock.mockResolvedValue(jsonResponse({ id: 11, title: 'Unknown Show' }))

    const subscribe = wrapper.findAll('button').find((button) => button.text().includes('Subscribe'))
    await subscribe!.trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-libraries/5/podcasts',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ source: 'feed', feedUrl: 'https://feeds.example/unknown.xml' }) }),
    )
    expect(wrapper.emitted('subscribed')).toHaveLength(1)
    expect(wrapper.text()).toContain('Scan again')
  })

  it('previews an unclaimed folder and turns it into a local show', async () => {
    const wrapper = await mountSheet(
      status({
        report: report({
          counts: { matched: 0, ambiguous: 0, unmatched: 0, duplicates: 0, skipped: 0, suggestedFeeds: 0, unclaimedFolders: 1 },
          matched: [],
          ambiguous: [],
          unmatched: [],
          unclaimedFolders: [
            { folderPath: 'Field Recordings', suggestedTitle: 'Dawn Chorus Diaries', suggestedAuthor: 'Ada', fileCount: 12, existingPodcastId: null },
          ],
        }),
      }),
    )
    expect(wrapper.text()).toContain('Dawn Chorus Diaries')
    expect(wrapper.text()).toContain('Ada')
    apiMock.mockClear()
    apiMock.mockResolvedValue(jsonResponse({ podcastId: 31, title: 'Dawn Chorus Diaries', created: true, jobId: 9 }))

    const create = wrapper.findAll('button').find((button) => button.text().includes('Create local show'))
    await create!.trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/podcast-libraries/5/podcasts',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ source: 'folder', folderPath: 'Field Recordings' }) }),
    )
    expect(wrapper.emitted('subscribed')).toHaveLength(1)
    expect(wrapper.text()).toContain('Scan again')
  })

  it('offers to add new episodes to a folder that is already a local show', async () => {
    const wrapper = await mountSheet(
      status({
        report: report({
          counts: { matched: 0, ambiguous: 0, unmatched: 0, duplicates: 0, skipped: 0, suggestedFeeds: 0, unclaimedFolders: 1 },
          matched: [],
          ambiguous: [],
          unmatched: [],
          unclaimedFolders: [
            { folderPath: 'Field Recordings', suggestedTitle: 'Dawn Chorus Diaries', suggestedAuthor: null, fileCount: 1, existingPodcastId: 31 },
          ],
        }),
      }),
    )

    expect(wrapper.findAll('button').some((button) => button.text().includes('Add new episodes'))).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text().includes('Create local show'))).toBe(false)
  })

  it('reports a scan that failed on the server', async () => {
    const wrapper = await mountSheet(
      status({
        job: {
          id: 9,
          status: 'failed',
          dryRun: false,
          progressCurrent: 1,
          progressTotal: 3,
          lastError: 'Podcast library storage folder not found',
          createdAt: '2026-07-31T10:00:00.000Z',
          updatedAt: '2026-07-31T10:00:04.000Z',
        },
        report: null,
      }),
    )

    expect(wrapper.get('[role="alert"]').text()).toBe('Podcast library storage folder not found')
  })
})
