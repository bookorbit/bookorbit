import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoryGuideHistory, StoryGuideListItem, StoryGuideStatus } from '@bookorbit/types'
import { toast } from 'vue-sonner'

import * as storyGuideApi from '@/features/story-guide/api/story-guide.api'
import * as aiApi from '../api/ai.api'
import { STORY_GUIDE_SEARCH_DELAY_MS } from '../composables/useStoryGuideShelf'
import AiStoryGuidesView from './AiStoryGuidesView.vue'

const mocks = vi.hoisted(() => ({ permissions: new Set<string>() }))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(message: string) => void>(),
    success: vi.fn<(message: string) => void>(),
  },
}))

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
  AiStoryGuideSpeeds: true,
  AiStoryGuidesData: true,
}

function guide(overrides: Partial<StoryGuideListItem> = {}): StoryGuideListItem {
  return {
    key: 'key-7',
    bookId: 7,
    fileId: 70,
    title: 'The Hound of the Baskervilles',
    byline: 'Arthur Conan Doyle',
    image: '/api/v1/books/7/thumbnail',
    words: 59_000,
    kind: 'build',
    builtAt: new Date().toISOString(),
    seconds: 209,
    cost: 0.2,
    bytes: 18_000,
    coverage: 1,
    models: { fast: { connectionId: 1, model: 'haiku' }, careful: { connectionId: 1, model: 'sonnet' } },
    ...overrides,
  }
}

const HISTORY: StoryGuideHistory = {
  cost: 11.75,
  medianSeconds: 209,
  models: [
    { fast: 'sonnet', careful: 'sonnet', builds: 8, averageSeconds: 203, averageCost: 2.17 },
    { fast: 'gemini', careful: 'gemini', builds: 1, averageSeconds: 248, averageCost: null },
  ],
}

function status(job: StoryGuideStatus['job']): StoryGuideStatus {
  return { fileId: 70, textKey: 'key-7', canManage: true, build: { allowed: true }, guide: null, job }
}

function mockOverview(history: StoryGuideHistory = HISTORY) {
  vi.spyOn(aiApi, 'getStoryGuidesSummary').mockResolvedValue({ count: 13, bytes: 225_000 })
  vi.spyOn(aiApi, 'getStoryGuideHistory').mockResolvedValue(history)
}

async function mountView() {
  const wrapper = mount(AiStoryGuidesView, { attachTo: document.body, global: { stubs } })
  await flushPromises()
  return wrapper
}

function rows(wrapper: Awaited<ReturnType<typeof mountView>>) {
  return wrapper.findAll('[data-testid="ai-story-guide-row"]')
}

function clickDialogButton(text: string) {
  const button = [...document.body.querySelectorAll('[role="dialog"] button')].find((element) => element.textContent?.trim() === text)
  if (!button) throw new Error(`No dialog button "${text}"`)
  ;(button as HTMLButtonElement).click()
}

describe('AiStoryGuidesView', () => {
  beforeEach(() => {
    mocks.permissions.clear()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('shows the totals, the stored guides newest first, and what each build took', async () => {
    mockOverview()
    const list = vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({ items: [guide()], total: 1 })
    const wrapper = await mountView()

    expect(list).toHaveBeenCalledWith({ q: '', sort: 'built', direction: 'desc', offset: 0, limit: 50 })
    expect(wrapper.find('[data-testid="ai-story-guides-stored"]').text()).toBe('13')
    expect(wrapper.find('[data-testid="ai-story-guides-spent"]').text()).toBe('$11.75')
    expect(wrapper.find('[data-testid="ai-story-guides-typical"]').text()).toBe('3m 29s')
    const [row] = rows(wrapper)
    expect(row!.find('a').attributes('href')).toBe('/book/7')
    expect(row!.text()).toContain('Arthur Conan Doyle')
    expect(row!.text()).toContain('haiku + sonnet')
    expect(row!.text()).toContain('3m 29s')
    expect(row!.text()).toContain('$0.20')
  })

  it('averages past builds by model, naming a pair once when both slots used it', async () => {
    mockOverview()
    vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({ items: [guide()], total: 1 })
    const wrapper = await mountView()

    const models = wrapper.findAll('[data-testid="ai-story-guides-model"]')
    expect(models.map((entry) => entry.find('td').text())).toEqual(['sonnet', 'gemini'])
    expect(models[0]!.text()).toContain('3m 23s')
    expect(models[0]!.text()).toContain('$2.17')
  })

  it('says when no build was timed', async () => {
    mockOverview({ cost: 0, medianSeconds: null, models: [] })
    vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({ items: [], total: 0 })
    const wrapper = await mountView()

    expect(wrapper.find('[data-testid="ai-story-guides-typical"]').text()).toBe('Not timed yet')
    expect(wrapper.find('[data-testid="ai-story-guides-models"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-story-guides-empty"]').text()).toContain('No story guides yet.')
  })

  it('searches by title after a pause, and offers to clear a search that finds nothing', async () => {
    mockOverview()
    const list = vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({ items: [], total: 0 })
    const wrapper = await mountView()
    vi.useFakeTimers()

    await wrapper.find('[data-testid="ai-story-guides-search"]').setValue('  hound ')
    expect(list).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(STORY_GUIDE_SEARCH_DELAY_MS)
    expect(list).toHaveBeenLastCalledWith({ q: 'hound', sort: 'built', direction: 'desc', offset: 0, limit: 50 })
    expect(wrapper.find('[data-testid="ai-story-guides-empty"]').text()).toContain('No stored guide matches that title.')

    const clear = wrapper.findAll('button').find((button) => button.text() === 'Clear search')
    await clear!.trigger('click')
    await vi.advanceTimersByTimeAsync(STORY_GUIDE_SEARCH_DELAY_MS)
    expect(list).toHaveBeenLastCalledWith({ q: '', sort: 'built', direction: 'desc', offset: 0, limit: 50 })
  })

  it('sorts by a column, title A to Z first, and flips on a second click', async () => {
    mockOverview()
    const list = vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({ items: [guide()], total: 1 })
    const wrapper = await mountView()
    const title = () => wrapper.find('[data-testid="ai-story-guides-sort-title"]')

    expect(title().element.closest('th')!.getAttribute('aria-sort')).toBe('none')
    await title().trigger('click')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith({ q: '', sort: 'title', direction: 'asc', offset: 0, limit: 50 })
    expect(title().element.closest('th')!.getAttribute('aria-sort')).toBe('ascending')

    await title().trigger('click')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith({ q: '', sort: 'title', direction: 'desc', offset: 0, limit: 50 })

    await wrapper.find('[data-testid="ai-story-guides-sort-cost"]').trigger('click')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith({ q: '', sort: 'cost', direction: 'desc', offset: 0, limit: 50 })
  })

  it('offers Rebuild and Delete only with the build permission, and only for a guide whose book is still there', async () => {
    mockOverview()
    vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({
      items: [guide(), guide({ key: 'key-gone', bookId: null, fileId: null, title: null, byline: null, image: null })],
      total: 2,
    })
    const viewer = await mountView()
    expect(viewer.find('[data-testid="ai-story-guide-rebuild"]').exists()).toBe(false)
    viewer.unmount()

    mocks.permissions.add('library_generate_story_guide')
    const builder = await mountView()
    const [present, gone] = rows(builder)
    expect(present!.find('[data-testid="ai-story-guide-rebuild"]').attributes('aria-label')).toBe(
      'Rebuild the story guide for The Hound of the Baskervilles',
    )
    expect(gone!.text()).toContain('A book no longer in any library')
    expect(gone!.find('[data-testid="ai-story-guide-rebuild"]').exists()).toBe(false)
  })

  it('rebuilds only after confirming, saying what the last build cost', async () => {
    mocks.permissions.add('library_generate_story_guide')
    mockOverview()
    vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({ items: [guide()], total: 1 })
    const build = vi.spyOn(storyGuideApi, 'buildStoryGuide').mockResolvedValue(status({ kind: 'rebuild', state: 'queued' }))
    const wrapper = await mountView()

    await rows(wrapper)[0]!.find('[data-testid="ai-story-guide-rebuild"]').trigger('click')
    await flushPromises()
    expect(build).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Its last build cost $0.20.')
    clickDialogButton('Rebuild')
    await flushPromises()

    expect(build).toHaveBeenCalledWith(7, 70, 'rebuild')
    expect(toast.success).toHaveBeenCalledWith('Rebuild of The Hound of the Baskervilles queued.')
  })

  it('says so when the book cannot be rebuilt now', async () => {
    mocks.permissions.add('library_generate_story_guide')
    mockOverview()
    vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({ items: [guide()], total: 1 })
    vi.spyOn(storyGuideApi, 'buildStoryGuide').mockResolvedValue({ ...status(null), build: { allowed: false, reason: 'off' } })
    const wrapper = await mountView()

    await rows(wrapper)[0]!.find('[data-testid="ai-story-guide-rebuild"]').trigger('click')
    await flushPromises()
    clickDialogButton('Rebuild')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith("The Hound of the Baskervilles can't be rebuilt now. Its book page says why.")
  })

  it('deletes one guide after confirming, keeping fixes made for everyone, then reads the list again', async () => {
    mocks.permissions.add('library_generate_story_guide')
    mockOverview()
    const list = vi.spyOn(aiApi, 'listStoryGuides').mockResolvedValue({ items: [guide()], total: 1 })
    const remove = vi.spyOn(storyGuideApi, 'deleteStoryGuide').mockResolvedValue(status(null))
    const wrapper = await mountView()

    await rows(wrapper)[0]!.find('[data-testid="ai-story-guide-delete"]').trigger('click')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    clickDialogButton('Delete')
    await flushPromises()

    expect(remove).toHaveBeenCalledWith(7, 70, 'keep')
    expect(toast.success).toHaveBeenCalledWith('Story guide for The Hound of the Baskervilles deleted.')
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('offers a retry when the list cannot be read', async () => {
    mockOverview()
    const list = vi
      .spyOn(aiApi, 'listStoryGuides')
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ items: [guide()], total: 1 })
    const wrapper = await mountView()
    expect(wrapper.text()).toContain("Couldn't read the story guides.")

    const retry = wrapper.findAll('button').find((button) => button.text() === 'Retry')
    await retry!.trigger('click')
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    expect(rows(wrapper)).toHaveLength(1)
  })
})
