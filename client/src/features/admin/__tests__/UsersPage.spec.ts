import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { flushPromises, mount, shallowMount } from '@vue/test-utils'
import UsersPage from '../UsersPage.vue'

const { apiMock, permState } = vi.hoisted(() => ({
  apiMock: vi.fn<(input: string, init?: RequestInit) => Promise<unknown>>(),
  permState: { isSuperuser: true, denied: [] as string[] },
}))

vi.mock('@/lib/api', () => ({ api: apiMock }))

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({
    isSuperuser: computed(() => permState.isSuperuser),
    hasPermission: vi.fn<(name: string) => boolean>((name) => !permState.denied.includes(name)),
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
  permissions: ['library_download'],
  provisioningMethod: 'local',
  hasContentFilters: false,
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

function stubApi(overrides: { users?: unknown[]; total?: number; allowRegistration?: boolean } = {}) {
  apiMock.mockImplementation(async (input: string) => {
    if (input.startsWith('/api/v1/users')) {
      return jsonResponse({ users: overrides.users ?? [USER], total: overrides.total ?? 1 })
    }
    if (input === '/api/v1/libraries') return jsonResponse({ libraries: [] })
    if (input === '/api/v1/app-settings/default-library-access') return jsonResponse({ libraryIds: [] })
    if (input === '/api/v1/app-settings') {
      return jsonResponse([{ key: 'allow_registration', value: String(overrides.allowRegistration ?? false) }])
    }
    if (input === '/api/v1/app-settings/allow_registration') return jsonResponse({ key: 'allow_registration', value: 'true' })
    return { ok: false, json: async () => ({}) }
  })
}

function selfRegistrationToggle(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('section[aria-labelledby="self-registration-heading"] button[role="switch"]')
}

function listUrls(): string[] {
  return apiMock.mock.calls.map(([input]) => input).filter((url) => url.startsWith('/api/v1/users?'))
}

beforeEach(() => {
  vi.clearAllMocks()
  permState.isSuperuser = true
  permState.denied = []
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

    expect(wrapper.find('section[aria-labelledby="self-registration-heading"]').exists()).toBe(false)
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

describe('UsersPage', () => {
  it('visually separates account-level settings from the user list', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    for (const headingId of ['self-registration-heading', 'default-library-access-heading']) {
      const section = wrapper.find(`section[aria-labelledby="${headingId}"]`)
      expect(section.classes()).toContain('border-t')
      expect(section.classes()).toContain('pt-6')
    }
  })

  it('does not duplicate the shared settings page header', async () => {
    const wrapper = shallowMount(UsersPage)
    await flushPromises()

    expect(wrapper.find('h2').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Manage user accounts and permission assignments.')
  })

  it('opens the create drawer from the primary CTA', async () => {
    const wrapper = shallowMount(UsersPage, {
      global: {
        stubs: {
          Button: { template: '<button><slot /></button>' },
        },
      },
    })
    await flushPromises()

    const createButton = wrapper
      .find('form')
      .findAll('button')
      .find((button) => button.text().includes('Create user'))
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

  it('sends the search term to the server and resets to the first page', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    await wrapper.find('input[type="search"]').setValue('ada')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const url = listUrls().at(-1)
    expect(url).toContain('search=ada')
    expect(url).toContain('page=0')
  })

  it('filters by state from the toolbar and drops the param when cleared', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    const stateSelect = wrapper.findAll('select')[0]
    await stateSelect?.setValue('admins')
    await flushPromises()
    expect(listUrls().at(-1)).toContain('state=admins')

    await stateSelect?.setValue('')
    await flushPromises()
    expect(listUrls().at(-1)).not.toContain('state=')
  })

  it('renders a pager only when there is more than one page', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()
    expect(wrapper.find('nav').exists()).toBe(false)

    stubApi({ total: 60 })
    const paged = mount(UsersPage)
    await flushPromises()
    expect(paged.find('nav').exists()).toBe(true)
    expect(paged.text()).toContain('Page 1 of 3')
  })

  it('advances to the next page without losing the active filters', async () => {
    stubApi({ total: 60 })
    const wrapper = mount(UsersPage)
    await flushPromises()

    await wrapper.find('input[type="search"]').setValue('ada')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    const nextButton = wrapper.findAll('button').find((button) => button.text().trim() === 'Next')
    await nextButton?.trigger('click')
    await flushPromises()

    const url = listUrls().at(-1)
    expect(url).toContain('page=1')
    expect(url).toContain('search=ada')
  })

  it('gives every icon-only row action an accessible name', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(wrapper.find('button[aria-label="Edit Ada Lovelace"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Reset the password for Ada Lovelace"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Delete Ada Lovelace"]').exists()).toBe(true)
  })

  it('offers the unlock action only while the account is actually locked', async () => {
    const wrapper = mount(UsersPage)
    await flushPromises()
    expect(wrapper.find('button[aria-label="Unlock Ada Lovelace"]').exists()).toBe(false)

    stubApi({ users: [{ ...USER, lockedUntil: new Date(Date.now() - 60_000).toISOString() }] })
    const expired = mount(UsersPage)
    await flushPromises()
    expect(expired.find('button[aria-label="Unlock Ada Lovelace"]').exists()).toBe(false)

    stubApi({ users: [{ ...USER, lockedUntil: new Date(Date.now() + 60_000).toISOString() }] })
    const locked = mount(UsersPage)
    await flushPromises()
    expect(locked.find('button[aria-label="Unlock Ada Lovelace"]').exists()).toBe(true)
    expect(locked.text()).toContain('Locked')
  })

  it('clears the lockout through the unlock endpoint and reloads', async () => {
    stubApi({ users: [{ ...USER, lockedUntil: new Date(Date.now() + 60_000).toISOString() }] })
    const wrapper = mount(UsersPage)
    await flushPromises()

    await wrapper.find('button[aria-label="Unlock Ada Lovelace"]').trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/users/4/unlock', { method: 'POST' })
    expect(listUrls().length).toBeGreaterThan(1)
  })

  it('shows a filtered empty state that differs from the unfiltered one', async () => {
    stubApi({ users: [], total: 0 })
    const wrapper = mount(UsersPage)
    await flushPromises()
    expect(wrapper.text()).toContain('No users yet')

    await wrapper.find('input[type="search"]').setValue('nobody')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('No users match')
  })

  it('surfaces a load failure through an alert', async () => {
    apiMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    const wrapper = mount(UsersPage)
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
