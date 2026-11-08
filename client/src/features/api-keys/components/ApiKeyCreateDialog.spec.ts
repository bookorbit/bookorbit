import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { Permission, PERMISSION_LABELS, type CreateApiKeyRequest } from '@bookorbit/types'
import ApiKeyCreateDialog from './ApiKeyCreateDialog.vue'

const LIBRARIES = [
  { id: 1, name: 'Fiction' },
  { id: 2, name: 'Comics' },
]

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ApiKeyCreateDialog, {
    props: {
      open: true,
      maxLifetimeDays: null,
      ownerIsSuperuser: false,
      ownerPermissions: [Permission.ApiKeys, Permission.KoboSync, Permission.OpdsAccess],
      libraries: LIBRARIES,
      ...props,
    },
    attachTo: document.body,
  })
}

function dialog(): HTMLElement {
  return document.body.querySelector<HTMLElement>('[role="dialog"]')!
}

function radios(name: string): HTMLInputElement[] {
  return [...dialog().querySelectorAll<HTMLInputElement>(`input[type="radio"][name$="-${name}"]`)]
}

function checkedValue(name: string): string | undefined {
  return radios(name).find((input) => input.checked)?.value
}

async function typeName(value: string) {
  const input = dialog().querySelector<HTMLInputElement>('input[type="text"]')!
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function submit() {
  dialog().querySelector('form')!.dispatchEvent(new Event('submit'))
  await flushPromises()
}

describe('ApiKeyCreateDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('starts on a read-only key for every library that expires in 90 days', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(checkedValue('access')).toBe('read')
    expect(checkedValue('libraries')).toBe('all')
    expect(checkedValue('expiry')).toBe('90')
    expect(radios('expiry').map((input) => input.value)).toEqual(['30', '90', '365', 'never'])

    await typeName('  Backup  ')
    await submit()

    const [request] = wrapper.emitted('submit')![0] as [CreateApiKeyRequest]
    expect(request).toEqual({ name: 'Backup', access: 'read', permissions: [], admin: false, libraryIds: null, expiresInDays: 90 })
    wrapper.unmount()
  })

  it('hides Never and longer presets under a server cap', async () => {
    const wrapper = mountDialog({ maxLifetimeDays: 90 })
    await flushPromises()

    expect(radios('expiry').map((input) => input.value)).toEqual(['30', '90'])
    wrapper.unmount()
  })

  it('offers only the permissions its owner holds, never the one that creates keys', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const labels = [...dialog().querySelectorAll('input[type="checkbox"]')].map((input) => input.closest('label')?.textContent?.trim())
    expect(labels).toEqual([PERMISSION_LABELS[Permission.KoboSync], PERMISSION_LABELS[Permission.OpdsAccess]])
    wrapper.unmount()
  })

  it('shows administrator access only to an administrator, and never alongside a library limit', async () => {
    const plain = mountDialog()
    await flushPromises()
    expect(dialog().textContent).not.toContain('Administrator access')
    plain.unmount()

    const wrapper = mountDialog({ ownerIsSuperuser: true })
    await flushPromises()
    const adminBox = [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) =>
      input.closest('label')?.textContent?.includes('Administrator access'),
    )!
    expect(adminBox.disabled).toBe(false)

    const some = radios('libraries').find((input) => input.value === 'some')!
    some.checked = true
    some.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(adminBox.disabled).toBe(true)

    const all = radios('libraries').find((input) => input.value === 'all')!
    all.checked = true
    all.dispatchEvent(new Event('change'))
    await flushPromises()
    adminBox.checked = true
    adminBox.dispatchEvent(new Event('change'))
    await flushPromises()
    expect(radios('libraries').find((input) => input.value === 'some')!.disabled).toBe(true)

    await typeName('Server automation')
    await submit()
    const [request] = wrapper.emitted('submit')![0] as [CreateApiKeyRequest]
    expect(request).toMatchObject({ admin: true, permissions: [], libraryIds: null })
    wrapper.unmount()
  })

  it('will not submit a library-limited key with no library chosen', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    await typeName('Comics only')

    const some = radios('libraries').find((input) => input.value === 'some')!
    some.checked = true
    some.dispatchEvent(new Event('change'))
    await flushPromises()
    await submit()
    expect(wrapper.emitted('submit')).toBeUndefined()

    const comics = [...dialog().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (input) => input.closest('label')?.textContent?.trim() === 'Comics',
    )!
    comics.checked = true
    comics.dispatchEvent(new Event('change'))
    await flushPromises()
    await submit()

    const [request] = wrapper.emitted('submit')![0] as [CreateApiKeyRequest]
    expect(request.libraryIds).toEqual([2])
    wrapper.unmount()
  })
})
