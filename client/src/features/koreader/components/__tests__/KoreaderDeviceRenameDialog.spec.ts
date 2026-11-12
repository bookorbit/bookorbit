import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import KoreaderDeviceRenameDialog from '../KoreaderDeviceRenameDialog.vue'

type DialogDevice = { deviceId: string; model: string; deviceName: string | null }

const mounted: ReturnType<typeof mount>[] = []

function mountDialog(device: DialogDevice | null, saving = false) {
  const wrapper = mount(KoreaderDeviceRenameDialog, { props: { device, saving } })
  mounted.push(wrapper)
  return wrapper
}

function nameInput(): HTMLInputElement {
  return document.body.querySelector<HTMLInputElement>('input[type="text"]')!
}

function bodyButton(text: string): HTMLButtonElement {
  return Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)!
}

function type(value: string): void {
  const input = nameInput()
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  mounted.splice(0).forEach((wrapper) => wrapper.unmount())
})

describe('KoreaderDeviceRenameDialog', () => {
  it('stays closed without a device', () => {
    mountDialog(null)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('labels the name field and describes it with the reported model', async () => {
    mountDialog({ deviceId: 'phone', model: 'blazer', deviceName: 'Pixel 8' })
    await flushPromises()

    const input = nameInput()
    expect(input.value).toBe('Pixel 8')
    expect(document.body.querySelector(`label[for="${input.id}"]`)?.textContent?.trim()).toBe('Name')
    expect(document.getElementById(input.getAttribute('aria-describedby')!)?.textContent).toContain('Reported model: blazer')
    expect(input.maxLength).toBe(100)
  })

  it('offers the retail name of a known model as the placeholder', async () => {
    mountDialog({ deviceId: 'kobo', model: 'Kobo_monza', deviceName: null })
    await flushPromises()

    expect(nameInput().placeholder).toBe('Kobo Libra Colour')
  })

  it('saves a trimmed name and only once it has changed', async () => {
    const wrapper = mountDialog({ deviceId: 'phone', model: 'blazer', deviceName: null })
    await flushPromises()
    expect(bodyButton('Save').disabled).toBe(true)

    type('  Pixel 8  ')
    await flushPromises()
    bodyButton('Save').click()
    await flushPromises()

    expect(wrapper.emitted('save')).toEqual([['Pixel 8']])
  })

  it('saves an emptied name as a request to show the model again', async () => {
    const wrapper = mountDialog({ deviceId: 'phone', model: 'blazer', deviceName: 'Pixel 8' })
    await flushPromises()

    type('   ')
    await flushPromises()
    bodyButton('Save').click()
    await flushPromises()

    expect(wrapper.emitted('save')).toEqual([['']])
  })

  it('cancels, but not while a save is in flight', async () => {
    const idle = mountDialog({ deviceId: 'phone', model: 'blazer', deviceName: null })
    await flushPromises()
    bodyButton('Cancel').click()
    expect(idle.emitted('cancel')).toHaveLength(1)
    idle.unmount()
    mounted.splice(0)

    const busy = mountDialog({ deviceId: 'phone', model: 'blazer', deviceName: null }, true)
    await flushPromises()
    expect(bodyButton('Cancel').disabled).toBe(true)
    expect(nameInput().disabled).toBe(true)
    expect(busy.emitted('cancel')).toBeUndefined()
  })
})
