import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@bookorbit/types'
import { i18n } from '@/i18n'
import { api } from '@/lib/api'
import MetadataReminderControls from './MetadataReminderControls.vue'

const user = ref<AuthUser | null>(null)
vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user }) }))
vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))

beforeEach(() => {
  i18n.global.locale.value = 'en'
  user.value = { id: 7, settings: {} } as AuthUser
  vi.mocked(api)
    .mockReset()
    .mockResolvedValue({ ok: true } as Response)
})

describe('metadata reminder controls', () => {
  it('saves checkbox changes automatically and restores defaults', async () => {
    const wrapper = mount(MetadataReminderControls)
    await wrapper.get('input[value="tags"]').setValue(false)
    await flushPromises()
    expect(user.value!.settings.metadataReminderPreferences!.fields).not.toContain('tags')
    expect(wrapper.get('[role="status"]').text()).toBe('Preferences saved.')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(user.value!.settings.metadataReminderPreferences!.fields).toContain('tags')
  })

  it('reverts a failed checkbox change and retries the requested selection', async () => {
    vi.mocked(api).mockResolvedValueOnce({ ok: false } as Response)
    const wrapper = mount(MetadataReminderControls)
    await wrapper.get('input[value="tags"]').setValue(false)
    await flushPromises()
    expect((wrapper.get('input[value="tags"]').element as HTMLInputElement).checked).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain('Could not save')
    await wrapper.get('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect((wrapper.get('input[value="tags"]').element as HTMLInputElement).checked).toBe(false)
  })
})
