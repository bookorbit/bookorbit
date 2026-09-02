import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import UsersPage from '../UsersPage.vue'
import UserRosterTable from '../components/UserRosterTable.vue'

const { apiMock, authState, permState, policyState } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: string, init?: RequestInit) => Promise<unknown>>(),
  authState: { userId: 1 },
  permState: { isSuperuser: true, denied: [] as string[] },
  policyState: { passwordLoginEnabled: true },
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))

vi.mock('@/components/ui/sheet', () => ({
  Sheet: { template: '<div><slot /></div>' },
  SheetContent: { template: '<div><slot /></div>' },
  SheetTitle: { template: '<h2><slot /></h2>' },
  SheetDescription: { template: '<p><slot /></p>' },
}))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isSuperuser: computed(() => permState.isSuperuser),
    hasPermission: vi.fn<(name: string) => boolean>((name) => !permState.denied.includes(name)),
  }),
}))

vi.mock('@/features/auth/composables/useAuth', () => ({
  useAuth: () => ({
    user: computed(() => ({ id: authState.userId })),
  }),
}))

vi.mock('@/features/auth/composables/useLoginOptions', () => ({
  useLoginOptions: () => ({
    loginOptions: computed(() => ({
      passwordLoginEnabled: policyState.passwordLoginEnabled,
      allowRegistration: false,
      oidcProviders: [],
    })),
    fetchLoginOptions: vi.fn<() => Promise<{ passwordLoginEnabled: boolean; allowRegistration: boolean; oidcProviders: never[] }>>(async () => ({
      passwordLoginEnabled: policyState.passwordLoginEnabled,
      allowRegistration: false,
      oidcProviders: [],
    })),
  }),
}))

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))

const USER = {
  id: 4,
  username: 'ada',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  active: true,
  isSuperuser: false,
  isDefaultPassword: false,
  permissions: ['library_download'],
  provisioningMethod: 'local',
  hasContentFilters: false,
  libraryAccessCount: 1,
  lastAuthenticatedAt: '2026-08-20T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
}

const EMPTY_SUMMARY = { total: 1, admins: 0, active: 1, inactive: 0, attention: 0 }

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

interface StubOptions {
  users?: unknown[]
  total?: number
  allowRegistration?: boolean
  summary?: Partial<typeof EMPTY_SUMMARY>
  attention?: unknown[]
}

function stubApi(overrides: StubOptions = {}) {
  apiMock.mockImplementation(async (input: string) => {
    if (input === '/api/v1/users/summary') return jsonResponse({ ...EMPTY_SUMMARY, ...overrides.summary })
    if (input === '/api/v1/users/attention') {
      const items = overrides.attention ?? []
      return jsonResponse({ items, total: items.length })
    }
    if (input.startsWith('/api/v1/users?')) {
      return jsonResponse({ users: overrides.users ?? [USER], total: overrides.total ?? 1 })
    }
    if (input === '/api/v1/libraries') return jsonResponse({ libraries: [{ id: 1, name: 'Novels' }] })
    if (input === '/api/v1/app-settings/default-library-access') return jsonResponse({ libraryIds: [] })
    if (input === '/api/v1/app-settings') {
      return jsonResponse([{ key: 'allow_registration', value: String(overrides.allowRegistration ?? false) }])
    }
    if (input === '/api/v1/app-settings/allow_registration') return jsonResponse({ key: 'allow_registration', value: 'true' })
    if (/\/api\/v1\/users\/\d+\/unlock$/.test(input)) return jsonResponse({})
    if (/\/api\/v1\/users\/\d+\/reset-password$/.test(input)) return jsonResponse({ resetUrl: 'https://example.test/reset' })
    if (/\/api\/v1\/users\/\d+\/superuser$/.test(input)) return jsonResponse({})
    return { ok: false, json: async () => ({}) }
  })
}

function selfRegistrationToggle(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('button[role="switch"][aria-label="Allow self-registration"]')
}

function listUrls(): string[] {
  return apiMock.mock.calls.map(([input]) => input).filter((url) => url.startsWith('/api/v1/users?'))
}

function searchInput(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('input[type="search"]')
}

function stateButton(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('[role="group"] button').find((button) => button.text().startsWith(label))
}

async function openUserAccess(wrapper: ReturnType<typeof mount>) {
  const roster = wrapper.findComponent(UserRosterTable)
  roster.vm.$emit('edit', roster.props('users')[0])
  await flushPromises()
  const access = wrapper.findAll('button').find((button) => button.text().trim().startsWith('Permissions'))
  await access?.trigger('click')
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useRealTimers()
  permState.isSuperuser = true
  permState.denied = []
  authState.userId = 1
  policyState.passwordLoginEnabled = true
  stubApi()
})

describe('UsersPage self-registration toggle', () => {
  it('reflects the stored setting', async () => {
    stubApi({ allowRegistration: true })
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(selfRegistrationToggle(wrapper).attributes('aria-checked')).toBe('true')
  })

  it('shows the setting as off when registration is closed', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(selfRegistrationToggle(wrapper).attributes('aria-checked')).toBe('false')
  })

  it('enables self-registration through the app-settings endpoint', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    await selfRegistrationToggle(wrapper).trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/app-settings/allow_registration', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'true' }),
    })
    expect(selfRegistrationToggle(wrapper).attributes('aria-checked')).toBe('true')
  })

  it('disables self-registration when toggled off', async () => {
    stubApi({ allowRegistration: true })
    const wrapper = mount(UsersPage)
    await flushPromises()

    await selfRegistrationToggle(wrapper).trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith(
      '/api/v1/app-settings/allow_registration',
      expect.objectContaining({ body: JSON.stringify({ value: 'false' }) }),
    )
  })

  it('warns that new accounts arrive without permissions once enabled', async () => {
    stubApi({ allowRegistration: true })
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(wrapper.text()).toContain('New accounts start with the default library access below and no other permissions.')
  })

  it('hides the setting from admins without the app-settings permission', async () => {
    permState.isSuperuser = false
    permState.denied = ['manage_app_settings']
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(selfRegistrationToggle(wrapper).exists()).toBe(false)
    expect(apiMock).not.toHaveBeenCalledWith('/api/v1/app-settings')
  })

  it('surfaces a save failure without flipping the switch', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    apiMock.mockResolvedValueOnce({ ok: false, json: async () => ({}) })
    await selfRegistrationToggle(wrapper).trigger('click')
    await flushPromises()

    expect(selfRegistrationToggle(wrapper).attributes('aria-checked')).toBe('false')
    expect(wrapper.text()).toContain('Failed to update the self-registration setting')
  })
})

describe('UsersPage defaults zone', () => {
  it('gathers both new-account settings under one heading, separated from the roster', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    const section = wrapper.find('section[aria-labelledby="new-account-defaults-heading"]')
    expect(section.exists()).toBe(true)
    expect(section.classes()).toContain('border-t')
    expect(section.text()).toContain('Defaults for new accounts')
    expect(section.text()).toContain('Allow self-registration')
    expect(section.text()).toContain('Starting libraries')
  })

  it('keeps the starting-library save disabled until something changes', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    const save = wrapper
      .find('section[aria-labelledby="new-account-defaults-heading"]')
      .findAll('button')
      .find((button) => button.text().trim() === 'Save')
    expect(save?.attributes('disabled')).toBeDefined()

    await wrapper.find('section[aria-labelledby="new-account-defaults-heading"] input[type="checkbox"]').setValue(true)
    await flushPromises()

    const enabled = wrapper
      .find('section[aria-labelledby="new-account-defaults-heading"]')
      .findAll('button')
      .find((button) => button.text().trim() === 'Save')
    expect(enabled?.attributes('disabled')).toBeUndefined()
  })
})

describe('UsersPage roster', () => {
  it('does not duplicate the shared settings page header', async () => {
    const wrapper = shallowMount(UsersPage)
    await flushPromises()

    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Manage user accounts and permission assignments.')
  })

  it('opens the create drawer from the primary action', async () => {
    const wrapper = shallowMount(UsersPage, {
      global: { stubs: { Button: { template: '<button><slot /></button>' }, teleport: false } },
    })
    await flushPromises()

    const createButton = wrapper.findAll('button').find((button) => button.text().includes('Create user'))
    expect(createButton).toBeDefined()
    expect(wrapper.find('user-form-drawer-stub').exists()).toBe(false)

    await createButton?.trigger('click')

    expect(wrapper.find('user-form-drawer-stub').exists()).toBe(true)
  })

  it('requests a bounded, sorted first page on mount', async () => {
    shallowMount(UsersPage)
    await flushPromises()

    const url = listUrls()[0]
    expect(url).toContain('page=0')
    expect(url).toContain('pageSize=25')
    expect(url).toContain('sortBy=username')
    expect(url).toContain('sortDir=asc')
  })

  it('fetches the counts and the attention band alongside the first page', async () => {
    shallowMount(UsersPage)
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/users/summary')
    expect(apiMock).toHaveBeenCalledWith('/api/v1/users/attention')
  })

  it('does not refetch libraries or the default-access config on every list request', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    const librariesBefore = apiMock.mock.calls.filter(([url]) => url === '/api/v1/libraries').length
    stateButton(wrapper, 'Inactive')?.trigger('click')
    await flushPromises()

    expect(apiMock.mock.calls.filter(([url]) => url === '/api/v1/libraries')).toHaveLength(librariesBefore)
  })

  it('sends the debounced search term to the server and resets to the first page', async () => {
    vi.useFakeTimers()
    const wrapper = mount(UsersPage)
    await vi.runOnlyPendingTimersAsync()
    await flushPromises()

    const urlsBefore = listUrls().length
    await searchInput(wrapper).setValue('ada')
    expect(listUrls()).toHaveLength(urlsBefore)

    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    const url = listUrls().at(-1)
    expect(url).toContain('search=ada')
    expect(url).toContain('page=0')
    vi.useRealTimers()
  })

  it('collapses a burst of keystrokes into a single request', async () => {
    vi.useFakeTimers()
    const wrapper = mount(UsersPage)
    await vi.runOnlyPendingTimersAsync()
    await flushPromises()

    const before = listUrls().length
    for (const term of ['a', 'ad', 'ada']) {
      await searchInput(wrapper).setValue(term)
      await vi.advanceTimersByTimeAsync(50)
    }
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()

    expect(listUrls().length - before).toBe(1)
    vi.useRealTimers()
  })

  it('filters by state from the toolbar and drops the param when cleared', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    await stateButton(wrapper, 'Inactive')?.trigger('click')
    await flushPromises()
    expect(listUrls().at(-1)).toContain('state=inactive')

    await stateButton(wrapper, 'All users')?.trigger('click')
    await flushPromises()
    expect(listUrls().at(-1)).not.toContain('state=')
  })

  it('sorts from the column headers and flips direction on a second click', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    const header = wrapper.findAll('thead th button').find((button) => button.text().startsWith('Last active'))
    await header?.trigger('click')
    await flushPromises()
    expect(listUrls().at(-1)).toContain('sortBy=lastActive')
    expect(listUrls().at(-1)).toContain('sortDir=desc')

    await header?.trigger('click')
    await flushPromises()
    expect(listUrls().at(-1)).toContain('sortDir=asc')
  })

  it('marks the sorted column for assistive technology', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    const userHeader = wrapper.findAll('thead th').find((th) => th.text().startsWith('User'))
    expect(userHeader?.attributes('aria-sort')).toBe('ascending')
  })

  it('renders pager controls only when there is more than one page', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()
    expect(wrapper.findAll('button').some((button) => button.text().trim() === 'Next')).toBe(false)
    expect(wrapper.text()).toContain('Showing 1 of 1 accounts')

    stubApi({ total: 60, summary: { total: 60, active: 60 } })
    const paged = mount(UsersPage)
    await flushPromises()
    expect(paged.text()).toContain('Page 1 of 3')
  })

  it('advances to the next page without losing the active filters', async () => {
    stubApi({ total: 60, summary: { total: 60, active: 60 } })
    const wrapper = mount(UsersPage)
    await flushPromises()

    await stateButton(wrapper, 'Active')?.trigger('click')
    await flushPromises()

    const nextButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Next')
    await nextButton?.trigger('click')
    await flushPromises()

    const url = listUrls().at(-1)
    expect(url).toContain('page=1')
    expect(url).toContain('state=active')
  })

  it('names access by the preset it matches rather than a raw permission count', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(wrapper.text()).toContain('Custom')
    expect(wrapper.text()).not.toContain('1 permission')
  })

  it('gives the row overflow menu an accessible name', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(wrapper.find('button[aria-label="More actions for Ada Lovelace"]').exists()).toBe(true)
  })

  it('reports a locked account with the time remaining, and only while it is locked', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()
    expect(wrapper.text()).not.toContain('Locked')

    stubApi({ users: [{ ...USER, lockedUntil: new Date(Date.now() - 60_000).toISOString() }] })
    const expired = mount(UsersPage)
    await flushPromises()
    expect(expired.text()).not.toContain('Locked')

    stubApi({ users: [{ ...USER, lockedUntil: new Date(Date.now() + 45 * 60_000).toISOString() }] })
    const locked = mount(UsersPage)
    await flushPromises()
    expect(locked.text()).toContain('Locked')
    expect(locked.text()).toContain('Unlocks')
  })

  it('flags an account that has never signed in ahead of one on its default password', async () => {
    stubApi({ users: [{ ...USER, lastAuthenticatedAt: null, isDefaultPassword: true }] })
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(wrapper.text()).toContain('Never signed in')
    expect(wrapper.text()).not.toContain('Default password')
  })

  it('shows a filtered empty state that differs from the unfiltered one', async () => {
    vi.useFakeTimers()
    stubApi({ users: [], total: 0, summary: { total: 0, active: 0 } })
    const wrapper = mount(UsersPage)
    await vi.runOnlyPendingTimersAsync()
    await flushPromises()
    expect(wrapper.text()).toContain('No users yet')

    await searchInput(wrapper).setValue('nobody')
    await vi.advanceTimersByTimeAsync(300)
    await flushPromises()
    expect(wrapper.text()).toContain('No users match')
    vi.useRealTimers()
  })

  it('surfaces a load failure through an alert', async () => {
    apiMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})

describe('UsersPage superuser access', () => {
  it('promotes an eligible account through an explicit confirmation', async () => {
    const wrapper = mount(UsersPage, { attachTo: document.body })
    await flushPromises()
    await openUserAccess(wrapper)

    const promote = wrapper.findAll('button').find((button) => button.text().trim() === 'Promote to superuser')
    expect(promote).toBeDefined()
    await promote?.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('Grant Ada Lovelace unrestricted server access.')
    const confirm = Array.from(document.body.querySelectorAll('button'))
      .filter((button) => button.textContent?.trim() === 'Promote to superuser')
      .at(-1)
    confirm?.click()
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/users/4/superuser', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isSuperuser: true }),
    })
    expect(wrapper.find('section[aria-labelledby="superuser-access-heading"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('offers demotion and preserves the distinction from the Admin permission preset', async () => {
    stubApi({ users: [{ ...USER, isSuperuser: true, permissions: ['manage_users'] }], summary: { admins: 1 } })
    const wrapper = mount(UsersPage)
    await flushPromises()
    await openUserAccess(wrapper)

    const panel = wrapper.find('section[aria-labelledby="superuser-access-heading"]')
    expect(panel.text()).toContain('Superuser access')
    expect(panel.text()).toContain('Its saved permissions, libraries, and restrictions will apply again after demotion.')
    expect(panel.findAll('button').some((button) => button.text().trim() === 'Remove superuser access')).toBe(true)
  })

  it('does not expose the privilege action to a permission-based administrator', async () => {
    permState.isSuperuser = false
    const wrapper = mount(UsersPage)
    await flushPromises()
    await openUserAccess(wrapper)

    expect(wrapper.find('section[aria-labelledby="superuser-access-heading"]').exists()).toBe(false)
  })

  it('explains why self and shared targets cannot be promoted', async () => {
    authState.userId = USER.id
    const selfWrapper = mount(UsersPage)
    await flushPromises()
    await openUserAccess(selfWrapper)
    expect(selfWrapper.text()).toContain('You cannot change your own superuser access.')
    expect(selfWrapper.findAll('button').some((button) => button.text().trim() === 'Promote to superuser')).toBe(false)

    authState.userId = 1
    stubApi({ users: [{ ...USER, provisioningMethod: 'shared' }] })
    const sharedWrapper = mount(UsersPage)
    await flushPromises()
    await openUserAccess(sharedWrapper)
    expect(sharedWrapper.text()).toContain('Shared accounts cannot be promoted to superuser.')
    expect(sharedWrapper.findAll('button').some((button) => button.text().trim() === 'Promote to superuser')).toBe(false)
  })

  it('keeps the confirmation open and shows localized copy when the transition fails', async () => {
    const wrapper = mount(UsersPage, { attachTo: document.body })
    await flushPromises()
    await openUserAccess(wrapper)
    await wrapper
      .findAll('button')
      .find((button) => button.text().trim() === 'Promote to superuser')
      ?.trigger('click')
    await flushPromises()

    apiMock.mockResolvedValueOnce({ ok: false, json: async () => ({ message: 'internal server wording' }) })
    const confirm = Array.from(document.body.querySelectorAll('button'))
      .filter((button) => button.textContent?.trim() === 'Promote to superuser')
      .at(-1)
    confirm?.click()
    await flushPromises()

    expect(document.body.textContent).toContain('Failed to update superuser access. Reload the account and try again.')
    expect(document.body.textContent).not.toContain('internal server wording')
    wrapper.unmount()
  })
})

describe('UsersPage attention band', () => {
  const LOCKED = {
    id: 9,
    username: 'tomf',
    name: 'Tom Feld',
    avatarUrl: null,
    provisioningMethod: 'local',
    reason: 'locked',
    lockedUntil: new Date(Date.now() + 45 * 60_000).toISOString(),
    createdAt: '2026-06-01T00:00:00.000Z',
    resetLinkExpiresAt: null,
  }
  const OIDC_NEVER = {
    ...LOCKED,
    id: 11,
    username: 'sam',
    name: 'Sam Whitfield',
    provisioningMethod: 'oidc',
    reason: 'neverSignedIn',
    lockedUntil: null,
  }

  it('stays out of the way when nothing needs repair', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(wrapper.find('section[aria-labelledby="user-attention-heading"]').exists()).toBe(false)
  })

  it('states the problem and offers the one action that fixes it', async () => {
    stubApi({ attention: [LOCKED], summary: { attention: 1 } })
    const wrapper = mount(UsersPage)
    await flushPromises()

    const band = wrapper.find('section[aria-labelledby="user-attention-heading"]')
    expect(band.text()).toContain('Tom Feld')
    expect(band.text()).toContain('is locked out after too many failed sign-ins')
    expect(band.findAll('button').some((button) => button.text().includes('Unlock now'))).toBe(true)
  })

  it('clears the lockout through the unlock endpoint and refreshes the band', async () => {
    stubApi({ attention: [LOCKED], summary: { attention: 1 } })
    const wrapper = mount(UsersPage)
    await flushPromises()

    const unlock = wrapper
      .find('section[aria-labelledby="user-attention-heading"]')
      .findAll('button')
      .find((button) => button.text().includes('Unlock now'))
    await unlock?.trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/users/9/unlock', { method: 'POST' })
    expect(apiMock.mock.calls.filter(([url]) => url === '/api/v1/users/attention').length).toBeGreaterThan(1)
  })

  it('explains itself instead of offering a reset link an OIDC account cannot use', async () => {
    stubApi({ attention: [OIDC_NEVER], summary: { attention: 1 } })
    const wrapper = mount(UsersPage)
    await flushPromises()

    const band = wrapper.find('section[aria-labelledby="user-attention-heading"]')
    expect(band.findAll('button').some((button) => button.text().includes('Send'))).toBe(false)
    expect(band.text()).toContain('OIDC users reset passwords in their identity provider.')
  })

  it('can be collapsed without losing the filter chip', async () => {
    stubApi({ attention: [LOCKED], summary: { attention: 1 } })
    const wrapper = mount(UsersPage)
    await flushPromises()

    const toggle = wrapper.find('section[aria-labelledby="user-attention-heading"] button[aria-expanded]')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')

    const chip = wrapper.findAll('button').find((button) => button.attributes('aria-label')?.includes('attention'))
    expect(chip).toBeDefined()
  })

  it('filters the roster down to the flagged accounts from the toolbar chip', async () => {
    stubApi({ attention: [LOCKED], summary: { attention: 1 } })
    const wrapper = mount(UsersPage)
    await flushPromises()

    const chip = wrapper.findAll('button').find((button) => button.attributes('aria-label')?.includes('attention'))
    await chip?.trigger('click')
    await flushPromises()

    expect(listUrls().at(-1)).toContain('state=attention')
  })
})
