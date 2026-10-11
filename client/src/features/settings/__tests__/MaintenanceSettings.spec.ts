import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import { api } from '@/lib/api'
import { useBookUpload } from '@/features/library/composables/useBookUpload'
import { useAddBookFile } from '@/features/book/composables/useAddBookFile'
import { useAppInfo } from '../composables/useAppInfo'
import MaintenanceSettings from '../MaintenanceSettings.vue'

vi.mock('@/lib/api', () => ({
  api: vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(),
  getValidToken: vi.fn<() => Promise<string | null>>().mockResolvedValue(null),
}))
vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ isSuperuser: ref(true) }),
}))
vi.mock('@/features/migration/lib/migration-api', () => ({
  getWorkflowState: vi.fn<() => Promise<{ active: null }>>().mockResolvedValue({ active: null }),
}))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn<(message: string) => void>(), error: vi.fn<(message: string) => void>() } }))

const mockApi = vi.mocked(api)
let wrapper: VueWrapper

function makeFile(sizeMb: number): File {
  const file = new File(['audio'], 'audiobook.m4b')
  Object.defineProperty(file, 'size', { value: sizeMb * 1024 * 1024 })
  return file
}

async function mountSettings() {
  wrapper = mount(MaintenanceSettings, {
    global: { stubs: { MigrationModal: true, SettingsPageHeader: true, ToggleSwitch: true } },
  })
  await flushPromises()
}

async function saveLimit(sizeMb: number) {
  await wrapper.get('input[type="number"]').setValue(sizeMb)
  const save = wrapper.findAll('button').find((button) => button.text() === i18n.global.t('settings.admin.maintenance.save'))!
  await save.trigger('click')
  await flushPromises()
}

describe('MaintenanceSettings upload limit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    i18n.global.locale.value = 'en'
    useAppInfo().maxUploadSizeMb.value = 500
    mockApi.mockResolvedValue(new Response(JSON.stringify([{ key: 'max_upload_size_mb', value: '500' }])))
  })

  afterEach(() => wrapper?.unmount())

  it.each([
    ['library uploads', useBookUpload],
    ['additional book files', useAddBookFile],
  ] as const)('uses a newly saved higher limit for %s without a reload', async (_name, useUpload) => {
    const upload = useUpload()
    await mountSettings()
    mockApi.mockResolvedValueOnce(new Response(JSON.stringify({ key: 'max_upload_size_mb', value: '900' })))

    await saveLimit(900)
    upload.addFiles([makeFile(600)])

    expect(mockApi).toHaveBeenLastCalledWith('/api/v1/app-settings/max_upload_size_mb', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: '900' }),
    })
    expect(upload.files.value[0]?.status).toBe('pending')
    expect(upload.files.value[0]?.validationError).toBe(false)
  })

  it.each([
    ['library uploads', useBookUpload],
    ['additional book files', useAddBookFile],
  ] as const)('uses a newly saved lower limit for %s without a reload', async (_name, useUpload) => {
    const upload = useUpload()
    await mountSettings()
    mockApi.mockResolvedValueOnce(new Response(JSON.stringify({ key: 'max_upload_size_mb', value: '200' })))

    await saveLimit(200)
    upload.addFiles([makeFile(300)])

    expect(upload.files.value[0]?.status).toBe('error')
    expect(upload.files.value[0]?.validationError).toBe(true)
  })

  it('keeps the current limit when saving fails', async () => {
    await mountSettings()
    mockApi.mockResolvedValueOnce(new Response(null, { status: 500 }))

    await saveLimit(900)
    const upload = useBookUpload()
    upload.addFiles([makeFile(600)])

    expect(useAppInfo().maxUploadSizeMb.value).toBe(500)
    expect(upload.files.value[0]?.status).toBe('error')
  })

  it('uses the saved limit loaded by the settings page', async () => {
    mockApi.mockResolvedValueOnce(new Response(JSON.stringify([{ key: 'max_upload_size_mb', value: '900' }])))

    await mountSettings()
    const upload = useBookUpload()
    upload.addFiles([makeFile(600)])

    expect(upload.files.value[0]?.status).toBe('pending')
  })
})
