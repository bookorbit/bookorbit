import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ApiKeyRevealDialog from './ApiKeyRevealDialog.vue'

const TOKEN = 'bok_' + 'x'.repeat(49)

function tokenField(): HTMLInputElement | null {
  return document.body.querySelector<HTMLInputElement>('[data-testid="api-key-token"]')
}

describe('ApiKeyRevealDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the token once and leaves the page holding nothing after it closes', async () => {
    const wrapper = mount(ApiKeyRevealDialog, { props: { token: TOKEN, keyName: 'Backup' }, attachTo: document.body })
    await flushPromises()

    expect(tokenField()?.value).toBe(TOKEN)
    expect(document.body.textContent).toContain('This is the only time the key is shown.')
    expect(document.body.textContent).not.toContain('?api_key=')

    const done = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Done')!
    done.click()
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.setProps({ token: null })
    await flushPromises()
    expect(tokenField()).toBeNull()
    expect(document.body.innerHTML).not.toContain(TOKEN)
    wrapper.unmount()
  })

  it('shows both headers in its examples without repeating the token', async () => {
    const wrapper = mount(ApiKeyRevealDialog, { props: { token: TOKEN, keyName: 'Backup' }, attachTo: document.body })
    await flushPromises()

    const examples = [...document.body.querySelectorAll('pre')].map((pre) => pre.textContent ?? '')
    expect(examples.some((example) => example.includes('Authorization: Bearer $BOOKORBIT_API_KEY'))).toBe(true)
    expect(examples.some((example) => example.includes('X-Api-Key: $BOOKORBIT_API_KEY'))).toBe(true)
    expect(examples.join('\n')).not.toContain(TOKEN)
    wrapper.unmount()
  })
})
