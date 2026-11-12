import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AiJobList, AiJobListItem } from '@bookorbit/types'
import { toast } from 'vue-sonner'

import * as jobsApi from '../api/ai-jobs.api'
import type { AiJobsListener } from '../lib/ai-jobs-socket'
import { AI_JOBS_REFRESH_GAP_MS } from '../composables/useAiJobList'
import AiActivityView from './AiActivityView.vue'

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  listeners: [] as AiJobsListener[],
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

vi.mock('../lib/ai-jobs-socket', () => ({
  listenToAiJobs: (listener: AiJobsListener) => {
    mocks.listeners.push(listener)
    return () => {
      mocks.listeners.splice(mocks.listeners.indexOf(listener), 1)
    }
  },
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(message: string) => void>(),
    success: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
    warning: vi.fn<(message: string) => void>(),
  },
}))

const stubs = {
  RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' },
}

function item(overrides: Partial<AiJobListItem> = {}): AiJobListItem {
  return {
    id: 'job-1',
    feature: 'story-guides',
    kind: 'build',
    status: 'queued',
    reason: null,
    phase: null,
    done: 0,
    total: 0,
    position: 2,
    subject: { label: 'The Hound of the Baskervilles', byline: 'Arthur Conan Doyle', url: '/book/7', image: '/api/v1/books/7/thumbnail' },
    requester: { id: 4, name: 'Sam Whitfield' },
    cost: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    pausedAt: null,
    finishedAt: null,
    actions: ['cancel', 'pause'],
    ...overrides,
  }
}

function page(items: AiJobListItem[], counts: Partial<AiJobList['counts']> = {}): AiJobList {
  return { items, total: items.length, counts: { queue: items.length, failed: 0, history: 0, running: 0, queued: 0, paused: 0, ...counts } }
}

function actionButtons(row: ReturnType<typeof rows>[number]) {
  return row.findAll('[data-testid^="ai-job-action-"]')
}

async function mountView() {
  const wrapper = mount(AiActivityView, { attachTo: document.body, global: { stubs } })
  await flushPromises()
  return wrapper
}

function rows(wrapper: Awaited<ReturnType<typeof mountView>>) {
  return wrapper.findAll('[data-testid="ai-job-row"]')
}

describe('AiActivityView', () => {
  beforeEach(() => {
    mocks.permissions.clear()
    mocks.listeners.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it("lists the viewer's jobs with their place, link and what they may do, and no choice of whose", async () => {
    const list = vi.spyOn(jobsApi, 'listAiJobs').mockResolvedValue(
      page(
        [
          item(),
          item({ id: 'job-2', status: 'paused', reason: 'user', position: null, actions: ['resume', 'cancel'] }),
          item({
            id: 'job-3',
            status: 'running',
            phase: 'lines',
            done: 2,
            total: 8,
            position: null,
            subject: { label: null, byline: null, url: null, image: null },
          }),
        ],
        { queue: 3, failed: 1, history: 5 },
      ),
    )
    const wrapper = await mountView()

    expect(list).toHaveBeenCalledWith({ view: 'queue', scope: 'mine', offset: 0, limit: 50 })
    expect(wrapper.find('[data-testid="ai-jobs-scope-all"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="ai-jobs-view-history"]').text()).toContain('5')
    const [queued, paused, running] = rows(wrapper)
    expect(queued!.find('a').attributes('href')).toBe('/book/7')
    expect(queued!.text()).toContain('Arthur Conan Doyle')
    expect(queued!.find('img').attributes('src')).toBe('/api/v1/books/7/thumbnail')
    expect(queued!.text()).toContain('Place 2 in the queue')
    expect(actionButtons(queued!).map((entry) => entry.attributes('aria-label'))).toEqual([
      'Pause The Hound of the Baskervilles',
      'Cancel The Hound of the Baskervilles',
    ])
    expect(actionButtons(paused!).map((entry) => entry.attributes('data-testid'))).toEqual(['ai-job-action-resume', 'ai-job-action-cancel'])
    expect(paused!.find('[data-testid="ai-job-reason"]').text()).toBe('Paused until someone resumes it.')
    expect(running!.text()).toContain('A book you can no longer open')
    expect(running!.text()).toContain('Writing descriptions, chapter 3 of 8')
    expect(running!.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
    expect(queued!.find('[data-testid="ai-job-requester"]').exists()).toBe(false)
  })

  it("lets a settings manager see everyone's jobs, with who asked", async () => {
    mocks.permissions.add('manage_app_settings')
    const list = vi.spyOn(jobsApi, 'listAiJobs').mockResolvedValue(page([item()]))
    const wrapper = await mountView()
    await wrapper.find('[data-testid="ai-jobs-scope-all"]').trigger('click')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith({ view: 'queue', scope: 'all', offset: 0, limit: 50 })
    expect(rows(wrapper)[0]!.find('[data-testid="ai-job-requester"]').text()).toBe('Sam Whitfield')
  })

  it('acts on the selected jobs that allow the action, then reads the list again', async () => {
    const list = vi
      .spyOn(jobsApi, 'listAiJobs')
      .mockResolvedValue(page([item(), item({ id: 'job-2', status: 'running', position: null }), item({ id: 'job-3', actions: ['cancel'] })]))
    const act = vi.spyOn(jobsApi, 'actOnAiJobs').mockResolvedValue({
      results: [
        { id: 'job-1', outcome: 'done', status: 'paused', reason: 'user' },
        { id: 'job-2', outcome: 'skipped', status: 'completed', reason: null },
      ],
    })
    const wrapper = await mountView()
    await wrapper.find('[data-testid="ai-jobs-select-all"]').trigger('change')
    expect(wrapper.find('[data-testid="ai-jobs-bulk"]').text()).toContain('3 jobs selected')

    await wrapper.find('[data-testid="ai-jobs-bulk-pause"]').trigger('click')
    await flushPromises()

    expect(act).toHaveBeenCalledWith({ action: 'pause', ids: ['job-1', 'job-2'] })
    expect(toast.success).toHaveBeenCalledWith('Paused 1 job.')
    expect(toast.warning).toHaveBeenCalledWith("1 job couldn't be changed. The list now shows where it stands.")
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('cancels only after confirming', async () => {
    vi.spyOn(jobsApi, 'listAiJobs').mockResolvedValue(page([item()]))
    const act = vi.spyOn(jobsApi, 'actOnAiJobs').mockResolvedValue({ results: [{ id: 'job-1', outcome: 'done', status: 'cancelled', reason: null }] })
    const wrapper = await mountView()
    await rows(wrapper)[0]!.find('[data-testid="ai-job-action-cancel"]').trigger('click')
    await flushPromises()
    expect(act).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Cancel this job?')
    const confirm = [...document.body.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.trim() === 'Cancel job')
    if (!confirm) throw new Error('No confirm button')
    ;(confirm as HTMLButtonElement).click()
    await flushPromises()
    expect(act).toHaveBeenCalledWith({ action: 'cancel', ids: ['job-1'] })
    expect(toast.success).toHaveBeenCalledWith('Cancelled 1 job.')
  })

  it('reads the list again when the socket says jobs changed, at most every two seconds', async () => {
    const list = vi.spyOn(jobsApi, 'listAiJobs').mockResolvedValue(page([item()]))
    await mountView()
    vi.useFakeTimers()
    for (const listener of mocks.listeners) listener.changed({ state: false })
    for (const listener of mocks.listeners) listener.changed({ state: true })
    await vi.advanceTimersByTimeAsync(AI_JOBS_REFRESH_GAP_MS)
    expect(list).toHaveBeenCalledTimes(2)
  })

  it('says when a view is empty, and offers a retry when the list cannot be read', async () => {
    const list = vi.spyOn(jobsApi, 'listAiJobs').mockRejectedValueOnce(new Error('down')).mockResolvedValue(page([]))
    const wrapper = await mountView()
    expect(wrapper.text()).toContain("Couldn't read the AI jobs.")
    const retry = wrapper.findAll('button').find((button) => button.text() === 'Retry')
    await retry!.trigger('click')
    await flushPromises()
    expect(list).toHaveBeenCalledTimes(2)
    expect(wrapper.find('[data-testid="ai-jobs-empty-title"]').text()).toBe('Nothing is queued, running or paused.')
  })

  it('lists finished jobs, each saying how it ended', async () => {
    const now = new Date()
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12).toISOString()
    vi.spyOn(jobsApi, 'listAiJobs').mockResolvedValue(
      page([
        item({ id: 'job-1', status: 'completed', position: null, actions: [], finishedAt: now.toISOString() }),
        item({ id: 'job-2', status: 'failed', reason: 'low-coverage', position: null, actions: [], finishedAt: yesterday }),
      ]),
    )
    const wrapper = await mountView()
    await wrapper.find('[data-testid="ai-jobs-view-history"]').trigger('click')
    await flushPromises()

    const [completed, failed] = rows(wrapper)
    expect(completed!.find('[data-testid="ai-job-status"]').text()).toBe('Completed')
    expect(failed!.find('[data-testid="ai-job-status"]').text()).toBe('Failed')
    expect(failed!.find('[data-testid="ai-job-reason"]').text()).toBe('The AI provider refused too much of the book.')
    expect(actionButtons(completed!)).toHaveLength(0)
  })
})
