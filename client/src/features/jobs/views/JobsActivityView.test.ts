import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobCounts, JobList, JobListItem } from '@bookorbit/types'
import { toast } from 'vue-sonner'

import { ApiError } from '@/lib/api-json'
import * as jobsApi from '../api/jobs.api'
import type { JobsListener } from '../lib/jobs-socket'
import { JOBS_REFRESH_GAP_MS } from '../composables/useJobList'
import JobsActivityView from './JobsActivityView.vue'

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  listeners: [] as JobsListener[],
  route: null as null | { name: string; query: Record<string, string> },
  replace: vi.fn<(to: { query: Record<string, string> }) => Promise<void>>(),
}))

vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  mocks.route = reactive({ name: 'jobs-activity', query: {} })
  return { useRoute: () => mocks.route, useRouter: () => ({ replace: mocks.replace }) }
})

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

vi.mock('../lib/jobs-socket', () => ({
  listenToJobs: (listener: JobsListener) => {
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

function item(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'story-guide:1',
    type: 'story-guide',
    kind: 'build',
    shape: 'job',
    status: 'queued',
    reason: null,
    phase: null,
    done: 0,
    total: null,
    percent: null,
    position: 2,
    subject: { label: 'The Hound of the Baskervilles', byline: 'Arthur Conan Doyle', url: '/book/7', image: null },
    requester: { id: 4, name: 'Sam Whitfield' },
    cost: null,
    createdAt: new Date().toISOString(),
    startedAt: null,
    pausedAt: null,
    finishedAt: null,
    actions: ['pause', 'cancel'],
    actionNote: null,
    extra: null,
    ...overrides,
  }
}

function page(items: JobListItem[], next: string | null = null, counts: Partial<JobCounts> = {}): JobList {
  return { items, next, counts: { queue: items.length, needsYou: 0, failed: 0, running: 0, queued: 0, paused: 0, ...counts } }
}

async function mountView() {
  const wrapper = mount(JobsActivityView, { attachTo: document.body, global: { stubs } })
  await flushPromises()
  return wrapper
}

function rows(wrapper: Awaited<ReturnType<typeof mountView>>) {
  return wrapper.findAll('[data-testid="job-row"]')
}

describe('JobsActivityView', () => {
  beforeEach(() => {
    mocks.permissions.clear()
    mocks.listeners.length = 0
    if (mocks.route) mocks.route.query = {}
    mocks.replace.mockReset().mockImplementation((to) => {
      mocks.route!.query = to.query
      return Promise.resolve()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  // Registered last so it runs first: a mounted page still watches the shared route.
  enableAutoUnmount(afterEach)

  it("groups the viewer's queue into bands, with each job's place and what they may do", async () => {
    const list = vi
      .spyOn(jobsApi, 'listJobs')
      .mockResolvedValue(
        page(
          [
            item({ id: 'story-guide:run', status: 'running', position: null, phase: 'lines', done: 2, total: 8, actions: ['pause', 'cancel'] }),
            item({ id: 'story-guide:next', position: 1, actions: ['pause', 'prioritize', 'cancel'] }),
            item({ id: 'story-guide:later', position: 2 }),
            item({ id: 'story-guide:held', status: 'paused', reason: 'user', position: null, actions: ['resume', 'cancel'] }),
          ],
          null,
          { queue: 4, failed: 2 },
        ),
      )
    const wrapper = await mountView()

    expect(list).toHaveBeenCalledWith({ view: 'queue', type: null, scope: 'mine', cursor: null, limit: 50, counts: true })
    expect(wrapper.find('[data-testid="jobs-scope-everyone"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="jobs-view-failed"]').text()).toContain('2')
    expect(wrapper.find('[data-testid="jobs-view-history"]').text()).toBe('History')
    expect(wrapper.findAll('[data-band]').map((band) => band.attributes('data-testid'))).toEqual([
      'jobs-band-running',
      'jobs-band-next',
      'jobs-band-later',
      'jobs-band-paused',
    ])
    const [running, next, later, held] = rows(wrapper)
    expect(running!.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('25')
    expect(next!.text()).toContain('Next in story guides')
    expect(later!.text()).toContain('#2 in story guides')
    expect(held!.text()).toContain('Paused until someone resumes it.')
    // A queued job with three actions shows one and keeps the rest in a menu.
    expect(next!.find('[data-testid="job-action-pause"]').exists()).toBe(true)
    expect(next!.find('[data-testid="job-more"]').exists()).toBe(true)
    expect(running!.findAll('[data-testid^="job-action-"]').map((button) => button.attributes('data-testid'))).toEqual([
      'job-action-pause',
      'job-action-cancel',
    ])
  })

  it('leads a failed job with one labelled action', async () => {
    vi.spyOn(jobsApi, 'listJobs').mockResolvedValue(
      page([item({ status: 'failed', reason: 'unreadable', position: null, finishedAt: new Date().toISOString(), actions: ['dismiss', 'retry'] })]),
    )
    const wrapper = await mountView()
    await wrapper.find('[data-testid="jobs-view-failed"]').trigger('click')
    await flushPromises()

    const [failed] = rows(wrapper)
    expect(failed!.text()).toContain("The book's file couldn't be read.")
    expect(failed!.find('[data-testid="job-action-retry"]').text()).toContain('Try again')
    expect(failed!.find('[data-testid="job-action-dismiss"]').exists()).toBe(true)
    expect(wrapper.findAll('[data-band]')).toHaveLength(0)
  })

  it("lets a manager switch to everyone's jobs, which names who asked", async () => {
    mocks.permissions.add('manage_app_settings')
    const list = vi.spyOn(jobsApi, 'listJobs').mockResolvedValue(page([item({ requester: null })]))
    const wrapper = await mountView()
    await wrapper.find('[data-testid="jobs-scope-everyone"]').trigger('click')
    await flushPromises()

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'everyone', cursor: null, counts: true }))
    expect(wrapper.find('[data-testid="job-requester"]').text()).toBe('Deleted account')
    expect(wrapper.find('[data-testid="jobs-view-needs-you"]').text()).toContain('Needs review')
  })

  it('pages forward by cursor and back again', async () => {
    const list = vi
      .spyOn(jobsApi, 'listJobs')
      .mockResolvedValueOnce(page([item()], 'cursor-2', { queue: 51 }))
      .mockResolvedValueOnce({ items: [item({ id: 'story-guide:2' })], next: null })
      .mockResolvedValueOnce({ items: [item()], next: 'cursor-2' })
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="jobs-range"]').text()).toBe('1-1 of 51')

    await wrapper.find('[data-testid="jobs-next"]').trigger('click')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'cursor-2', counts: false }))
    expect(wrapper.find('[data-testid="jobs-range"]').text()).toBe('51-51 of 51')
    expect(wrapper.find('[data-testid="jobs-next"]').attributes('disabled')).toBeDefined()

    await wrapper.find('[data-testid="jobs-previous"]').trigger('click')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null }))
  })

  it('starts over from the first page when the server refuses a cursor', async () => {
    const list = vi
      .spyOn(jobsApi, 'listJobs')
      .mockResolvedValueOnce(page([item()], 'stale'))
      .mockRejectedValueOnce(new ApiError('refused', 400, null, null))
      .mockResolvedValueOnce(page([item()]))
    const wrapper = await mountView()
    await wrapper.find('[data-testid="jobs-next"]').trigger('click')
    await flushPromises()

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null, counts: true }))
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(rows(wrapper)).toHaveLength(1)
  })

  it('asks before cancelling, then acts and says what happened', async () => {
    vi.spyOn(jobsApi, 'listJobs').mockResolvedValue(page([item({ status: 'running', position: null })]))
    const act = vi.spyOn(jobsApi, 'actOnJobs').mockResolvedValue({ results: [{ id: 'story-guide:1', outcome: 'done', status: 'cancelled' }] })
    const wrapper = await mountView()
    await wrapper.find('[data-testid="job-action-cancel"]').trigger('click')
    await flushPromises()
    expect(act).not.toHaveBeenCalled()

    const confirm = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Cancel job')
    confirm!.click()
    await flushPromises()
    expect(act).toHaveBeenCalledWith({ action: 'cancel', ids: ['story-guide:1'] })
    expect(toast.success).toHaveBeenCalledWith('Cancelled 1 job.')
  })

  it('shows why a job offers nothing, when the server says', async () => {
    vi.spyOn(jobsApi, 'listJobs').mockResolvedValue(page([item({ actions: [], actionNote: 'something-new' })]))
    const wrapper = await mountView()
    await wrapper.find('[data-testid="job-note"]').trigger('click')
    expect(toast.info).toHaveBeenCalledWith("You can't change this job.")
  })

  it('rereads on a status change, but progress only while the page shows that type running', async () => {
    vi.useFakeTimers()
    const list = vi.spyOn(jobsApi, 'listJobs').mockResolvedValue(page([item()]))
    await mountView()
    const calls = list.mock.calls.length

    mocks.listeners[0]!.changed({ type: 'story-guide', state: false })
    await vi.advanceTimersByTimeAsync(JOBS_REFRESH_GAP_MS)
    expect(list.mock.calls.length).toBe(calls)

    mocks.listeners[0]!.changed({ type: 'story-guide', state: true })
    await vi.advanceTimersByTimeAsync(JOBS_REFRESH_GAP_MS)
    expect(list.mock.calls.length).toBe(calls + 1)
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ counts: true }))
  })

  it('filters by type among the types the viewer sees, and keeps the filter in the address', async () => {
    const list = vi.spyOn(jobsApi, 'listJobs').mockResolvedValue({ ...page([item()]), types: ['story-guide', 'bulk-run'], scopes: ['mine'] })
    const wrapper = await mountView()
    const select = wrapper.find<HTMLSelectElement>('[data-testid="jobs-type"]')
    expect(select.findAll('option').map((option) => option.text())).toEqual(['All types', 'Story guide', 'Bulk action'])
    expect(wrapper.find('[data-testid="jobs-scope-everyone"]').exists()).toBe(false)

    await select.setValue('bulk-run')
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'bulk-run', cursor: null, counts: true }))
    expect(mocks.replace).toHaveBeenLastCalledWith({ query: { type: 'bulk-run' } })

    await wrapper.find('[data-testid="jobs-view-history"]').trigger('click')
    await flushPromises()
    expect(mocks.replace).toHaveBeenLastCalledWith({ query: { view: 'history', type: 'bulk-run' } })
  })

  it('hides the type filter from someone who sees a single type', async () => {
    vi.spyOn(jobsApi, 'listJobs').mockResolvedValue({ ...page([item()]), types: ['story-guide'], scopes: ['mine'] })
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="jobs-type"]').exists()).toBe(false)
  })

  it('opens on the view and type in the address, and follows a link to another', async () => {
    mocks.route!.query = { view: 'failed', type: 'bulk-run' }
    const list = vi.spyOn(jobsApi, 'listJobs').mockResolvedValue({ ...page([]), types: ['story-guide', 'bulk-run'], scopes: ['mine'] })
    const wrapper = await mountView()
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ view: 'failed', type: 'bulk-run' }))
    expect(wrapper.find<HTMLSelectElement>('[data-testid="jobs-type"]').element.value).toBe('bulk-run')
    expect(wrapper.find('[data-testid="jobs-view-failed"]').attributes('aria-pressed')).toBe('true')

    mocks.route!.query = { type: 'bulk-run' }
    await flushPromises()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'queue', type: 'bulk-run' }))
  })

  it('drops a type from an old link that the viewer cannot see', async () => {
    mocks.route!.query = { type: 'library-scan' }
    const list = vi.spyOn(jobsApi, 'listJobs').mockResolvedValue({ ...page([item()]), types: ['story-guide', 'bulk-run'], scopes: ['mine'] })
    const wrapper = await mountView()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ type: null }))
    expect(mocks.replace).toHaveBeenLastCalledWith({ query: {} })
    expect(rows(wrapper)).toHaveLength(1)
  })

  it("offers everyone's jobs to whoever the server says may see them", async () => {
    vi.spyOn(jobsApi, 'listJobs').mockResolvedValue({ ...page([item()]), types: ['request-download'], scopes: ['mine', 'everyone'] })
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="jobs-scope-everyone"]').exists()).toBe(true)
  })

  it("shows the viewer's own jobs when a link asks for everyone's without the permission", async () => {
    mocks.route!.query = { scope: 'everyone' }
    const list = vi
      .spyOn(jobsApi, 'listJobs')
      .mockRejectedValueOnce(new ApiError('forbidden', 403, null, null))
      .mockResolvedValue({ ...page([item()]), types: ['story-guide'], scopes: ['mine'] })
    const wrapper = await mountView()
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'mine' }))
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(rows(wrapper)).toHaveLength(1)
  })

  it('says how many selected jobs each bulk action applies to, and acts only on those', async () => {
    vi.spyOn(jobsApi, 'listJobs').mockResolvedValue(
      page([
        item({ id: 'story-guide:1', actions: ['pause', 'cancel'] }),
        item({ id: 'bulk-run:2', type: 'bulk-run', kind: 'book-move', position: null, status: 'running', actions: ['cancel'] }),
      ]),
    )
    const act = vi.spyOn(jobsApi, 'actOnJobs').mockResolvedValue({ results: [{ id: 'story-guide:1', outcome: 'done', status: 'paused' }] })
    const wrapper = await mountView()
    await wrapper.find('[data-testid="jobs-select-all"]').setValue(true)
    await flushPromises()

    const pause = wrapper.find('[data-testid="jobs-bulk-pause"]')
    expect(pause.text()).toContain('Applies to 1 of 2 selected jobs')
    expect(wrapper.find('[data-testid="jobs-bulk-cancel"]').text()).not.toContain('Applies to')
    await pause.trigger('click')
    await flushPromises()
    expect(act).toHaveBeenCalledWith({ action: 'pause', ids: ['story-guide:1'] })
  })

  it('shows the empty state for a view with nothing in it', async () => {
    vi.spyOn(jobsApi, 'listJobs').mockResolvedValue(page([]))
    const wrapper = await mountView()
    expect(wrapper.find('[data-testid="jobs-empty-title"]').text()).toBe('Nothing is running or waiting.')
  })

  it('keeps the completed page visible while another view loads', async () => {
    mocks.route!.query = { view: 'history' }
    let finishLoad!: (value: JobList) => void
    const pending = new Promise<JobList>((resolve) => {
      finishLoad = resolve
    })
    const list = vi
      .spyOn(jobsApi, 'listJobs')
      .mockResolvedValueOnce(page([item({ status: 'completed', finishedAt: new Date().toISOString(), actions: [] })]))
      .mockReturnValueOnce(pending)
    const wrapper = await mountView()

    expect(wrapper.find('[data-band]').exists()).toBe(true)
    await wrapper.find('[data-testid="jobs-view-needs-you"]').trigger('click')
    await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(2))

    expect(wrapper.find('[data-testid="jobs-loading-skeleton"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="jobs-table"]').attributes('aria-busy')).toBe('true')
    expect(wrapper.find('[data-band]').exists()).toBe(true)
    expect(rows(wrapper)[0]!.text()).toContain('The Hound of the Baskervilles')

    finishLoad(page([item({ status: 'needs-you', reason: 'review', position: null, actions: [] })]))
    await flushPromises()

    expect(wrapper.find('[data-testid="jobs-table"]').attributes('aria-busy')).toBe('false')
    expect(wrapper.find('[data-band]').exists()).toBe(false)
    expect(rows(wrapper)[0]!.text()).toContain('Waiting on an answer.')
  })
})
