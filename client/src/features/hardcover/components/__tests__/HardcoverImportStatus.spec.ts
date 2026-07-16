import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  HardcoverImportApplyResult,
  HardcoverImportPreview,
  HardcoverSettings,
  HardcoverTokenValidationResult,
  ApplyHardcoverImportPayload,
  UpsertHardcoverSettingsPayload,
} from '@bookorbit/types'
import HardcoverImportStatus from '../HardcoverImportStatus.vue'

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(message: string) => void>(),
    error: vi.fn<(message: string) => void>(),
  },
}))

vi.mock('../../api/hardcover.api', () => ({
  fetchHardcoverSettings: vi.fn<() => Promise<HardcoverSettings>>(),
  upsertHardcoverSettings: vi.fn<(payload: UpsertHardcoverSettingsPayload) => Promise<HardcoverSettings>>(),
  disconnectHardcover: vi.fn<() => Promise<void>>(),
  validateHardcoverToken: vi.fn<(token?: string) => Promise<HardcoverTokenValidationResult>>(),
  previewHardcoverImport: vi.fn<() => Promise<HardcoverImportPreview>>(),
  applyHardcoverImport: vi.fn<(payload?: ApplyHardcoverImportPayload) => Promise<HardcoverImportApplyResult>>(),
}))

import { toast } from 'vue-sonner'
import { applyHardcoverImport, previewHardcoverImport } from '../../api/hardcover.api'
import { useHardcoverSettings } from '../../composables/useHardcoverSettings'

const mockPreview = vi.mocked(previewHardcoverImport)
const mockApply = vi.mocked(applyHardcoverImport)
const mockToast = vi.mocked(toast)

const PREVIEW: HardcoverImportPreview = {
  summary: {
    totalHardcoverBooks: 2,
    matchedBooks: 1,
    willUpdate: 1,
    needsReview: 0,
    conflicts: 1,
    unmatched: 0,
    skipped: 0,
    progressWillUpdate: 1,
    progressConflicts: 0,
    progressSkipped: 0,
  },
  rows: [
    {
      hardcoverUserBookId: 1000,
      hardcoverBookId: 10,
      hardcoverEditionId: 20,
      hardcoverReadId: 30,
      hardcoverTitle: 'Dune',
      hardcoverAuthors: ['Frank Herbert'],
      hardcoverStatusId: 3,
      hardcoverStatusLabel: 'Read',
      importedStatus: 'read',
      importedStartedAt: '2024-01-01',
      importedFinishedAt: '2024-01-10',
      importedProgressPercent: 100,
      localBookId: 42,
      localPrimaryFileId: 500,
      localTitle: 'Dune',
      localAuthors: ['Frank Herbert'],
      localReadStatus: null,
      localProgressPercent: null,
      matchMethod: 'isbn',
      confidence: 100,
      outcome: 'will_update',
      reason: 'Ready to import',
      progressOutcome: 'will_update',
      progressReason: 'Ready to import progress',
    },
  ],
}

describe('HardcoverImportStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useHardcoverSettings().settings.value = null
    mockPreview.mockResolvedValue(PREVIEW)
    mockApply.mockResolvedValue({
      ...PREVIEW.summary,
      applied: 1,
      progressApplied: 1,
      failed: 0,
    })
  })

  it('previews and applies Hardcover read status import', async () => {
    const wrapper = mount(HardcoverImportStatus, {
      global: {
        stubs: { Teleport: true },
      },
    })

    const previewButton = wrapper.findAll('button').find((button) => button.text().includes('Preview'))
    await previewButton!.trigger('click')
    await flushPromises()

    expect(mockPreview).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Ready')
    expect(wrapper.text()).toContain('Conflicts')
    expect(wrapper.text()).toContain('Dune')

    const importButton = wrapper.findAll('button').find((button) => button.text().includes('Import ready'))
    await importButton!.trigger('click')
    await flushPromises()

    expect(mockApply).toHaveBeenCalledTimes(1)
    expect(mockApply).toHaveBeenCalledWith({ importProgress: true })
    expect(mockToast.success).toHaveBeenCalledWith('1 read status imported, 1 progress update')
  })

  it('applies read status without progress when the checkbox is off', async () => {
    const wrapper = mount(HardcoverImportStatus, {
      global: {
        stubs: { Teleport: true },
      },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Preview'))!
      .trigger('click')
    await flushPromises()
    await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(false)
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Import ready'))!
      .trigger('click')
    await flushPromises()

    expect(mockApply).toHaveBeenCalledWith({ importProgress: false })
    expect(mockToast.success).toHaveBeenCalledWith('1 read status imported')
  })

  it('applies the selected rows from the review modal', async () => {
    const wrapper = mount(HardcoverImportStatus, {
      global: {
        stubs: { Teleport: true },
      },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Preview'))!
      .trigger('click')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Import selected'))!
      .trigger('click')
    await flushPromises()

    expect(mockApply).toHaveBeenCalledWith({ hardcoverUserBookIds: [1000], importProgress: true })
  })

  it('opens, closes, and clears review state', async () => {
    const wrapper = mount(HardcoverImportStatus, {
      global: {
        stubs: { Teleport: true },
      },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Preview'))!
      .trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Hardcover import review')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Close'))!
      .trigger('click')
    expect(wrapper.text()).not.toContain('Hardcover import review')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Review matches'))!
      .trigger('click')
    expect(wrapper.text()).toContain('Hardcover import review')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Clear'))!
      .trigger('click')
    expect(wrapper.text()).not.toContain('Ready')
  })

  it('shows preview and apply errors', async () => {
    mockPreview.mockRejectedValueOnce(new Error('No token'))
    mockApply.mockRejectedValueOnce(new Error('Apply failed'))
    const wrapper = mount(HardcoverImportStatus, {
      global: {
        stubs: { Teleport: true },
      },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Preview'))!
      .trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('No token')

    mockPreview.mockResolvedValueOnce(PREVIEW)
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Preview'))!
      .trigger('click')
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Import ready'))!
      .trigger('click')
    await flushPromises()

    expect(mockToast.error).toHaveBeenCalledWith('Apply failed')
  })

  it('shows import unavailable reasons from Hardcover settings', () => {
    const { settings } = useHardcoverSettings()
    settings.value = {
      tokenConfigured: false,
      enabled: false,
      effectiveEnabled: false,
      disabledReason: 'missing_token',
      bookSyncMode: 'all_eligible',
      autoSyncOnStatusChange: false,
      autoSyncOnProgressUpdate: false,
      autoSyncOnRatingChange: false,
      privacySettingId: 1,
      lastSyncedAt: null,
    }

    const wrapper = mount(HardcoverImportStatus, {
      global: {
        stubs: { Teleport: true },
      },
    })

    expect(wrapper.text()).toContain('Connect Hardcover before importing.')
    expect(
      wrapper
        .findAll('button')
        .find((button) => button.text().includes('Preview'))!
        .attributes('disabled'),
    ).toBeDefined()
  })

  it('summarizes plural progress conflicts and failed imports', async () => {
    const preview: HardcoverImportPreview = {
      ...PREVIEW,
      summary: {
        ...PREVIEW.summary,
        willUpdate: 2,
        progressWillUpdate: 2,
        progressConflicts: 2,
      },
      rows: [
        PREVIEW.rows[0]!,
        {
          ...PREVIEW.rows[0]!,
          hardcoverUserBookId: 1001,
          hardcoverBookId: 11,
          localBookId: 43,
          progressOutcome: 'conflict',
        },
      ],
    }
    mockPreview.mockResolvedValue(preview)
    mockApply.mockResolvedValue({
      ...preview.summary,
      applied: 2,
      progressApplied: 0,
      failed: 1,
    })

    const wrapper = mount(HardcoverImportStatus, {
      global: {
        stubs: { Teleport: true },
      },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Preview'))!
      .trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('2 progress updates available, 2 conflicts')

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Import ready'))!
      .trigger('click')
    await flushPromises()

    expect(mockToast.success).toHaveBeenCalledWith('2 read statuses imported, no progress updates')
  })
})
