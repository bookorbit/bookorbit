import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@bookorbit/types'
import { METADATA_REMINDER_FIELDS } from '@bookorbit/types'
import { api } from '@/lib/api'
import { useMetadataReminders } from './useMetadataReminders'

const user = ref<AuthUser | null>(null)
vi.mock('@/features/auth/composables/useAuth', () => ({ useAuth: () => ({ user }) }))
vi.mock('@/lib/api', () => ({ api: vi.fn<typeof api>() }))

function account(id = 7): AuthUser {
  return { id, settings: { timezone: 'UTC' } } as AuthUser
}

beforeEach(() => {
  user.value = account()
  vi.mocked(api)
    .mockReset()
    .mockResolvedValue({ ok: true } as Response)
})

describe('metadata reminder preferences', () => {
  it('uses defaults for older accounts and after signing out', () => {
    const reminders = useMetadataReminders()
    expect(reminders.fields.value).toEqual(METADATA_REMINDER_FIELDS)
    user.value = null
    expect(reminders.fields.value).toEqual(METADATA_REMINDER_FIELDS)
  })

  it('patches only this preference and preserves unrelated settings', async () => {
    const reminders = useMetadataReminders()
    expect(await reminders.saveFields(['isbn'])).toBe(true)
    expect(api).toHaveBeenCalledWith('/api/v1/users/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { metadataReminderPreferences: { fields: ['isbn'] } } }),
    })
    expect(user.value!.settings.timezone).toBe('UTC')
    expect(reminders.fields.value).toEqual(['isbn'])
  })

  it('restores saved preferences after an unsuccessful write', async () => {
    vi.mocked(api).mockResolvedValue({ ok: false } as Response)
    const reminders = useMetadataReminders()
    expect(await reminders.saveFields([])).toBe(false)
    expect(reminders.fields.value).toEqual(METADATA_REMINDER_FIELDS)
  })

  it('restores saved preferences after a network failure', async () => {
    vi.mocked(api).mockRejectedValue(new Error('Offline'))
    const reminders = useMetadataReminders()
    expect(await reminders.saveFields([])).toBe(false)
    expect(reminders.saving.value).toBe(false)
    expect(reminders.fields.value).toEqual(METADATA_REMINDER_FIELDS)
  })

  it('shares pending choices across consumers and prevents overlapping writes', async () => {
    let resolve!: (response: Response) => void
    vi.mocked(api).mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done
      }),
    )
    const reminders = useMetadataReminders()
    const saving = reminders.saveFields([])
    expect(useMetadataReminders().fields.value).toEqual([])
    expect(await reminders.saveFields(['isbn'])).toBe(false)
    expect(api).toHaveBeenCalledTimes(1)
    resolve({ ok: true } as Response)
    expect(await saving).toBe(true)
  })

  it('does not expose pending choices or apply stale responses to another account', async () => {
    let resolve!: (response: Response) => void
    vi.mocked(api).mockReturnValue(
      new Promise<Response>((done) => {
        resolve = done
      }),
    )
    const reminders = useMetadataReminders()
    const saving = reminders.saveFields([])
    user.value = account(8)
    expect(reminders.fields.value).toEqual(METADATA_REMINDER_FIELDS)
    resolve({ ok: true } as Response)
    expect(await saving).toBe(false)
    expect(user.value.settings.metadataReminderPreferences).toBeUndefined()
  })
})
