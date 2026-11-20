import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServerFeature, StoryGuideInfo, StoryGuideStatus, StoryGuidesAppInfo } from '@bookorbit/types'
import type * as StoryGuideApi from '../api/story-guide.api'

const mocks = vi.hoisted(() => ({
  permissions: new Set<string>(),
  features: ['story-guides'] as string[],
  storyGuides: { building: true, served: true } as StoryGuidesAppInfo | null,
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => mocks.permissions.has(name) }),
}))

vi.mock('@/features/settings/composables/useAppInfo', async () => {
  const { ref } = await import('vue')
  return {
    useAppInfo: () => ({
      ensureAppInfo: () => Promise.resolve(),
      supportsFeature: (feature: ServerFeature) => mocks.features.includes(feature),
      storyGuides: ref(mocks.storyGuides),
    }),
  }
})

vi.mock('vue-sonner', () => ({ toast: { error: vi.fn<(message: string) => void>(), success: vi.fn<(message: string) => void>() } }))

vi.mock('../api/story-guide.api', () => ({
  getStoryGuideStatus: vi.fn<typeof StoryGuideApi.getStoryGuideStatus>(),
  buildStoryGuide: vi.fn<typeof StoryGuideApi.buildStoryGuide>(),
  retryStoryGuide: vi.fn<typeof StoryGuideApi.retryStoryGuide>(),
  cancelStoryGuide: vi.fn<typeof StoryGuideApi.cancelStoryGuide>(),
  deleteStoryGuide: vi.fn<typeof StoryGuideApi.deleteStoryGuide>(),
}))

import * as storyGuideApi from '../api/story-guide.api'
import StoryGuideCard from './StoryGuideCard.vue'

const MANAGER = ['library_generate_story_guide']
const ADMIN = ['library_generate_story_guide', 'manage_app_settings']

const GUIDE: StoryGuideInfo = {
  builtAt: `${new Date().getFullYear()}-11-09T12:00:00.000Z`,
  models: { fast: { connectionId: 1, model: 'gpt-6-luna' }, careful: { connectionId: 1, model: 'gpt-6.1-terra' } },
  coverage: 1,
  format: 1,
  outdated: false,
  modelsChanged: false,
}

function status(overrides: Partial<StoryGuideStatus> = {}): StoryGuideStatus {
  return {
    fileId: 812,
    textKey: 'a'.repeat(64),
    canManage: true,
    build: { allowed: true },
    guide: null,
    job: null,
    estimate: { words: 98_000, minutes: 6, cost: 0.1 },
    ...overrides,
  }
}

/** The status the server answers a manager without the settings permission: no dollars. */
function withoutCost(value: StoryGuideStatus): StoryGuideStatus {
  const next = structuredClone(value)
  if (next.estimate) delete next.estimate.cost
  if (next.updateEstimate) delete next.updateEstimate.cost
  return next
}

const stubs = {
  DropdownMenu: { template: '<div data-testid="menu-root"><slot /></div>' },
  DropdownMenuTrigger: { template: '<div><slot /></div>' },
  DropdownMenuContent: { template: '<div data-testid="menu-items"><slot /></div>' },
  DropdownMenuItem: { emits: ['select'], template: '<button type="button" role="menuitem" @click="$emit(\'select\')"><slot /></button>' },
  RouterLink: { props: ['to'], template: '<a :data-to="to.name"><slot /></a>' },
}

async function mountCard(value: StoryGuideStatus | null, permissions: string[] = ADMIN) {
  mocks.permissions = new Set(permissions)
  if (value) vi.mocked(storyGuideApi.getStoryGuideStatus).mockResolvedValue({ kind: 'fresh', status: value, etag: '"e"' })
  const wrapper = mount(StoryGuideCard, { props: { bookId: 7 }, attachTo: document.body, global: { stubs } })
  await flushPromises()
  return wrapper
}

function menuItems(wrapper: Awaited<ReturnType<typeof mountCard>>): string[] {
  return wrapper.findAll('[role="menuitem"]').map((item) => item.text())
}

function dialog(): HTMLElement | null {
  return document.body.querySelector('[data-testid="story-guide-confirmation"]')
}

function choose(label: string) {
  const button = [...(dialog()?.querySelectorAll('button') ?? [])].find((element) => element.textContent?.trim() === label)
  if (!button) throw new Error(`No dialog button "${label}"`)
  button.click()
}

async function openFromMenu(wrapper: Awaited<ReturnType<typeof mountCard>>, label: string) {
  const item = wrapper.findAll('[role="menuitem"]').find((element) => element.text() === label)
  if (!item) throw new Error(`No menu item "${label}"`)
  await item.trigger('click')
  await flushPromises()
}

describe('StoryGuideCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.features = ['story-guides']
    mocks.storyGuides = { building: true, served: true }
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  describe('by role', () => {
    it('shows readers nothing and asks the server nothing', async () => {
      const wrapper = await mountCard(null, [])
      expect(storyGuideApi.getStoryGuideStatus).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="story-guide-card"]').exists()).toBe(false)
    })

    it('shows nothing when the server says the account cannot manage guides', async () => {
      const wrapper = await mountCard(status({ canManage: false, build: { allowed: false }, guide: GUIDE }), MANAGER)
      expect(wrapper.find('[data-testid="story-guide-card"]').exists()).toBe(false)
    })

    it('shows nothing on a server without story guides', async () => {
      mocks.features = []
      mocks.storyGuides = null
      const wrapper = await mountCard(null)
      expect(storyGuideApi.getStoryGuideStatus).not.toHaveBeenCalled()
      expect(wrapper.html()).toBe('<!--v-if-->')
    })

    it('gives admins dollars and the settings link, and other managers neither', async () => {
      const paused = status({ job: { kind: 'build', state: 'paused', reason: 'budget' } })
      const admin = await mountCard(paused, ADMIN)
      expect(admin.find('[data-testid="story-guide-settings-hint"] a').attributes('data-to')).toBe('settings-admin-ai')
      admin.unmount()

      const manager = await mountCard(withoutCost(paused), MANAGER)
      expect(manager.find('[data-testid="story-guide-settings-hint"]').exists()).toBe(false)
      expect(manager.text()).toContain("Paused: this month's AI budget is used up.")
      manager.unmount()

      const adminCard = await mountCard(status(), ADMIN)
      expect(adminCard.find('[data-testid="story-guide-estimate"]').text()).toBe('About 6 minutes and $0.10')
      adminCard.unmount()

      const managerCard = await mountCard(withoutCost(status()), MANAGER)
      expect(managerCard.find('[data-testid="story-guide-estimate"]').text()).toBe('About 6 minutes')
    })
  })

  describe('states', () => {
    it('not built: the web card body, Build and its estimate, and Build in the menu', async () => {
      const wrapper = await mountCard(status())
      expect(wrapper.find('h3').text()).toBe('Story guide')
      expect(wrapper.find('[data-testid="story-guide-build-card"]').text()).toContain('Powers Constellations in the BookOrbit apps.')
      expect(wrapper.find('[data-testid="story-guide-build"]').text()).toBe('Build')
      expect(menuItems(wrapper)).toEqual(['Build story guide'])
      expect(wrapper.find('[data-testid="story-guide-built"]').exists()).toBe(false)
    })

    it('checking: says so, with no menu', async () => {
      const wrapper = await mountCard(status({ build: { allowed: false, reason: 'checking' }, estimate: undefined }))
      expect(wrapper.text()).toContain('Checking this book')
      expect(wrapper.find('[data-testid="story-guide-menu"]').exists()).toBe(false)
    })

    it('waiting: the books ahead, and Cancel build in the menu', async () => {
      const wrapper = await mountCard(status({ job: { kind: 'build', state: 'queued', position: 3 } }))
      const row = wrapper.find('[data-testid="story-guide-waiting"]')
      expect(row.findAll('p').map((line) => line.text())).toEqual(['Story guide waiting to start', '2 books ahead'])
      expect(menuItems(wrapper)).toEqual(['Cancel build'])
    })

    it('building: the phase, the time left and a progress bar', async () => {
      const wrapper = await mountCard(status({ job: { kind: 'build', state: 'running', phase: 'lines', done: 11, total: 34, minutesLeft: 1 } }))
      const row = wrapper.find('[data-testid="story-guide-progress"]')
      expect(row.text()).toContain('Writing descriptions, chapter 12 of 34')
      expect(row.text()).toContain('About 1 minute left')
      expect(row.find('[role="progressbar"]').attributes('aria-valuenow')).toBe('32')
      expect(menuItems(wrapper)).toEqual(['Cancel build'])
    })

    it('rebuilding beside the guide: its own title, and the guide still deletable', async () => {
      const wrapper = await mountCard(
        status({ guide: GUIDE, job: { kind: 'rebuild', state: 'running', phase: 'ties', done: 4, total: 8, minutesLeft: 2 } }),
      )
      expect(wrapper.find('[data-testid="story-guide-progress"]').text()).toContain('Rebuilding the story guide')
      expect(menuItems(wrapper)).toEqual(['Cancel build', 'Delete story guide'])
      expect(wrapper.find('[data-testid="story-guide-built"]').text()).toBe('Built Nov 9 with gpt-6-luna and gpt-6.1-terra')
    })

    it('built: a status row with when and how much, the models as a list, and Rebuild and Delete in the menu', async () => {
      const wrapper = await mountCard(status({ guide: GUIDE }))
      const built = wrapper.get('[data-testid="story-guide-built"]')
      expect(built.text()).toContain('Ready in the BookOrbit apps')
      expect(built.text()).toContain('Built Nov 9 · whole book')
      const models = wrapper.get('[data-testid="story-guide-models"]')
      expect(models.attributes('aria-label')).toBe('Models')
      expect(models.findAll('li').map((item) => item.text())).toEqual(['gpt-6-luna', 'gpt-6.1-terra'])
      expect(menuItems(wrapper)).toEqual(['Rebuild from scratch', 'Delete story guide'])
    })

    it('built over part of the book: the share it covers', async () => {
      const wrapper = await mountCard(status({ guide: { ...GUIDE, coverage: 0.92 } }))
      expect(wrapper.get('[data-testid="story-guide-built"]').text()).toContain('Built Nov 9 · 92% of the book')
    })

    it('outdated: the update row, and Update first in the menu', async () => {
      const wrapper = await mountCard(status({ guide: { ...GUIDE, outdated: true }, updateEstimate: { minutes: 2, cost: 0.03 } }))
      expect(wrapper.find('[data-testid="story-guide-update"]').text()).toContain('An improved story guide is available')
      expect(menuItems(wrapper)).toEqual(['Update story guide', 'Rebuild from scratch', 'Delete story guide'])
    })

    it('paused over the estimate: Continue and Cancel build on the row and in the menu', async () => {
      const wrapper = await mountCard(status({ job: { kind: 'build', state: 'paused', reason: 'over-estimate' } }))
      const notice = wrapper.find('[data-testid="story-guide-notice"]')
      expect(notice.text()).toContain('Paused: this build is costing more than expected.')
      expect(notice.findAll('button').map((button) => button.text())).toEqual(['Continue', 'Cancel build'])
      expect(menuItems(wrapper)).toEqual(['Continue', 'Cancel build'])
    })

    it('failed: the reason, the settings link for admins, Try again and Dismiss', async () => {
      const wrapper = await mountCard(status({ job: { kind: 'build', state: 'failed', reason: 'low-coverage' } }))
      const notice = wrapper.find('[data-testid="story-guide-notice"]')
      expect(notice.text()).toContain('The AI provider refused too much of this book. A different model may work.')
      expect(notice.text()).toContain("Change this in the server's AI settings.")
      expect(notice.findAll('button').map((button) => button.text())).toEqual(['Try again', 'Dismiss'])
      expect(menuItems(wrapper)).toEqual(['Try again', 'Dismiss'])
    })

    it.each([
      ['too-short', 'This book is too short for a story guide.'],
      ['too-long', "This book is longer than this server's limit of 250,000 words."],
      ['off', 'Story guides are turned off on this server.'],
    ] as const)('not available (%s): the reason, with no actions and no menu', async (reason, sentence) => {
      const wrapper = await mountCard(status({ build: { allowed: false, reason, limit: 250_000 }, estimate: undefined }))
      expect(wrapper.find('[data-testid="story-guide-notice"]').text()).toContain(sentence)
      expect(wrapper.find('[data-testid="story-guide-notice"] button').exists()).toBe(false)
      expect(wrapper.find('[data-testid="story-guide-menu"]').exists()).toBe(false)
    })

    it.each(['no-text-file', 'language'] as const)('not available (%s): nothing at all', async (reason) => {
      const wrapper = await mountCard(status({ build: { allowed: false, reason }, estimate: undefined }))
      expect(wrapper.find('[data-testid="story-guide-card"]').exists()).toBe(false)
    })
  })

  describe('confirmations', () => {
    it('Build asks first, then sends the build', async () => {
      vi.mocked(storyGuideApi.buildStoryGuide).mockResolvedValue(status({ job: { kind: 'build', state: 'queued', position: 1 } }))
      const wrapper = await mountCard(status())
      await wrapper.find('[data-testid="story-guide-build"]').trigger('click')
      await flushPromises()
      expect(dialog()?.textContent).toContain('Build a story guide?')
      expect(dialog()?.querySelector('[data-testid="story-guide-confirmation-estimate"]')?.textContent?.trim()).toBe('About 6 minutes and $0.10.')
      expect(storyGuideApi.buildStoryGuide).not.toHaveBeenCalled()
      choose('Build')
      await flushPromises()
      expect(storyGuideApi.buildStoryGuide).toHaveBeenCalledWith(7, 812, 'build')
      expect(dialog()).toBeNull()
      expect(wrapper.find('[data-testid="story-guide-waiting"]').exists()).toBe(true)
    })

    it('Cancel in a confirmation sends nothing', async () => {
      const wrapper = await mountCard(status())
      await openFromMenu(wrapper, 'Build story guide')
      choose('Cancel')
      await flushPromises()
      expect(dialog()).toBeNull()
      expect(storyGuideApi.buildStoryGuide).not.toHaveBeenCalled()
    })

    it('Update asks with the update estimate, from the row and from the menu', async () => {
      vi.mocked(storyGuideApi.buildStoryGuide).mockResolvedValue(status({ guide: GUIDE, job: { kind: 'update', state: 'queued', position: 1 } }))
      const wrapper = await mountCard(status({ guide: { ...GUIDE, outdated: true }, updateEstimate: { minutes: 2, cost: 0.03 } }))
      await wrapper.find('[data-testid="story-guide-update"] button').trigger('click')
      await flushPromises()
      expect(dialog()?.textContent).toContain('Update the story guide?')
      expect(dialog()?.textContent).toContain('About 2 minutes and $0.03.')
      choose('Cancel')
      await flushPromises()
      await openFromMenu(wrapper, 'Update story guide')
      choose('Update')
      await flushPromises()
      expect(storyGuideApi.buildStoryGuide).toHaveBeenCalledWith(7, 812, 'update')
    })

    it('Rebuild asks first, then sends a rebuild', async () => {
      vi.mocked(storyGuideApi.buildStoryGuide).mockResolvedValue(status({ guide: GUIDE, job: { kind: 'rebuild', state: 'queued', position: 1 } }))
      const wrapper = await mountCard(withoutCost(status({ guide: GUIDE })), MANAGER)
      await openFromMenu(wrapper, 'Rebuild from scratch')
      expect(dialog()?.textContent).toContain('Rebuild the story guide from scratch?')
      expect(dialog()?.textContent).toContain('About 6 minutes.')
      expect(dialog()?.textContent).not.toContain('$')
      choose('Rebuild')
      await flushPromises()
      expect(storyGuideApi.buildStoryGuide).toHaveBeenCalledWith(7, 812, 'rebuild')
    })

    it.each([
      ['Delete guide, keep fixes', 'keep'],
      ['Delete guide and fixes', 'delete'],
    ] as const)('Delete asks about fixes made for everyone: %s', async (label, fixes) => {
      vi.mocked(storyGuideApi.deleteStoryGuide).mockResolvedValue(status())
      const wrapper = await mountCard(status({ guide: GUIDE }))
      await openFromMenu(wrapper, 'Delete story guide')
      expect(dialog()?.textContent).toContain('Delete the story guide?')
      expect(dialog()?.textContent).toContain('Everyone who reads this book loses it.')
      choose(label)
      await flushPromises()
      expect(storyGuideApi.deleteStoryGuide).toHaveBeenCalledWith(7, 812, fixes)
      expect(wrapper.find('[data-testid="story-guide-build-card"]').exists()).toBe(true)
    })

    it('Delete stacks its three choices, the deletes first and Cancel last', async () => {
      const wrapper = await mountCard(status({ guide: GUIDE }))
      await openFromMenu(wrapper, 'Delete story guide')
      const labels = [...(dialog()?.querySelectorAll('button[data-choice]') ?? [])].map((button) => button.textContent?.trim())
      expect(labels).toEqual(['Delete guide, keep fixes', 'Delete guide and fixes', 'Cancel'])
      expect(document.activeElement?.textContent?.trim()).toBe('Cancel')
    })

    it('drops an open confirmation when the page moves to another book', async () => {
      const wrapper = await mountCard(status({ guide: GUIDE }))
      await openFromMenu(wrapper, 'Delete story guide')
      expect(dialog()).not.toBeNull()
      await wrapper.setProps({ bookId: 8 })
      await flushPromises()
      expect(dialog()).toBeNull()
      expect(storyGuideApi.deleteStoryGuide).not.toHaveBeenCalled()
    })

    it('starts Keep building? with no choice focused, since both send something', async () => {
      const wrapper = await mountCard(status({ job: { kind: 'build', state: 'paused', reason: 'over-estimate' } }))
      await wrapper.find('[data-testid="story-guide-notice"] [data-action="keepBuilding"]').trigger('click')
      await flushPromises()
      expect(document.activeElement).toBe(dialog())
    })

    it('hands focus back to the control that asked when the confirmation closes', async () => {
      const wrapper = await mountCard(status())
      const build = wrapper.find('[data-testid="story-guide-build"]')
      await build.trigger('click')
      await flushPromises()
      choose('Cancel')
      await flushPromises()
      expect(document.activeElement).toBe(build.element)

      await openFromMenu(wrapper, 'Build story guide')
      choose('Cancel')
      await flushPromises()
      expect(document.activeElement).toBe(wrapper.find('[data-testid="story-guide-menu"]').element)
    })

    it('Cancel build asks first and can keep building', async () => {
      vi.mocked(storyGuideApi.cancelStoryGuide).mockResolvedValue(status())
      const wrapper = await mountCard(status({ job: { kind: 'build', state: 'running', phase: 'text', done: 1, total: 2, minutesLeft: 4 } }))
      await openFromMenu(wrapper, 'Cancel build')
      expect(dialog()?.textContent).toContain('Cancel the build?')
      expect(dialog()?.textContent).toContain('Work done so far is kept for next time.')
      choose('Keep building')
      await flushPromises()
      expect(storyGuideApi.cancelStoryGuide).not.toHaveBeenCalled()
      await openFromMenu(wrapper, 'Cancel build')
      choose('Cancel build')
      await flushPromises()
      expect(storyGuideApi.cancelStoryGuide).toHaveBeenCalledWith(7, 812)
      expect(wrapper.find('[data-testid="story-guide-build-card"]').exists()).toBe(true)
    })

    it('Continue asks in dollars for admins and in budget terms for other managers', async () => {
      vi.mocked(storyGuideApi.retryStoryGuide).mockResolvedValue(status({ job: { kind: 'build', state: 'running', phase: 'lines' } }))
      const paused = status({ job: { kind: 'build', state: 'paused', reason: 'over-estimate' } })
      const admin = await mountCard(paused, ADMIN)
      await admin.find('[data-testid="story-guide-notice"] [data-action="keepBuilding"]').trigger('click')
      await flushPromises()
      expect(dialog()?.textContent).toContain('This build has cost $0.30, three times the estimate.')
      choose('Continue')
      await flushPromises()
      expect(storyGuideApi.retryStoryGuide).toHaveBeenCalledWith(7, 812)
      admin.unmount()

      const manager = await mountCard(withoutCost(paused), MANAGER)
      await openFromMenu(manager, 'Continue')
      expect(dialog()?.textContent).toContain('This build is using much more of the AI budget than expected.')
    })

    it('Try again and Dismiss go straight through', async () => {
      vi.mocked(storyGuideApi.retryStoryGuide).mockResolvedValue(status({ job: { kind: 'build', state: 'queued', position: 1 } }))
      vi.mocked(storyGuideApi.cancelStoryGuide).mockResolvedValue(status())
      const failed = status({ job: { kind: 'build', state: 'failed', reason: 'error' } })
      const wrapper = await mountCard(failed)
      await wrapper.find('[data-testid="story-guide-notice"] [data-action="retry"]').trigger('click')
      await flushPromises()
      expect(dialog()).toBeNull()
      expect(storyGuideApi.retryStoryGuide).toHaveBeenCalledWith(7, 812)
      wrapper.unmount()

      const again = await mountCard(failed)
      await openFromMenu(again, 'Dismiss')
      expect(dialog()).toBeNull()
      expect(storyGuideApi.cancelStoryGuide).toHaveBeenCalledWith(7, 812)
    })
  })
})
