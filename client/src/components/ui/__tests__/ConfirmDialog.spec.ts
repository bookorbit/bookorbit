import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'

function confirmButton() {
  return [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Purge')
}

function phraseInput() {
  return document.body.querySelector<HTMLInputElement>('input[type="text"]')
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(ConfirmDialog, {
    props: {
      open: true,
      title: 'Purge show',
      description: 'This deletes every downloaded file.',
      confirmLabel: 'Purge',
      ...props,
    },
    attachTo: document.body,
  })
}

describe('ConfirmDialog', () => {
  it('confirms immediately when no confirmation phrase is required', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(phraseInput()).toBeNull()
    confirmButton()?.click()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('blocks confirmation until the phrase matches exactly', async () => {
    const wrapper = mountDialog({ confirmationPhrase: 'Orbit Radio' })
    await flushPromises()

    const input = phraseInput()
    expect(input).not.toBeNull()
    expect(confirmButton()?.disabled).toBe(true)

    input!.value = 'Orbit'
    input!.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(confirmButton()?.disabled).toBe(true)

    input!.value = '  Orbit Radio  '
    input!.dispatchEvent(new Event('input'))
    await flushPromises()

    expect(confirmButton()?.disabled).toBe(false)
    confirmButton()?.click()

    expect(wrapper.emitted('confirm')).toHaveLength(1)
    wrapper.unmount()
  })

  it('clears a typed phrase when the dialog is reopened', async () => {
    const wrapper = mountDialog({ confirmationPhrase: 'Orbit Radio' })
    await flushPromises()

    const input = phraseInput()!
    input.value = 'Orbit Radio'
    input.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(confirmButton()?.disabled).toBe(false)

    await wrapper.setProps({ open: false })
    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(phraseInput()?.value).toBe('')
    expect(confirmButton()?.disabled).toBe(true)
    wrapper.unmount()
  })

  it('elevates its stacking layer to z-[70] so it renders above drawers and sheets', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    const content = document.body.querySelector<HTMLDivElement>('[role="dialog"]')
    const overlay = document.body.querySelector<HTMLDivElement>('.fixed.inset-0')

    expect(content?.className).toContain('z-[70]')
    expect(overlay?.className).toContain('z-[70]')

    wrapper.unmount()
  })

  it('can be confirmed when rendered alongside a sheet overlay', async () => {
    // Simulate an underlying drawer/sheet overlay rendered at z-50
    const sheetOverlay = document.createElement('div')
    sheetOverlay.setAttribute('data-slot', 'sheet-overlay')
    sheetOverlay.className = 'fixed inset-0 z-50 bg-black/15'
    document.body.appendChild(sheetOverlay)

    const wrapper = mountDialog()
    await flushPromises()

    confirmButton()?.click()
    await flushPromises()

    expect(wrapper.emitted('confirm')).toHaveLength(1)

    wrapper.unmount()
    sheetOverlay.remove()
  })
})
