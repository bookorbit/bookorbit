import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ResetLinkModal from '../ResetLinkModal.vue'

const copyToClipboardMock = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>())
const resolveResetLinkUrlMock = vi.hoisted(() => vi.fn<(resetUrl: string, currentOrigin: string) => string>())

vi.mock('@/lib/clipboard', () => ({
  copyToClipboard: copyToClipboardMock,
}))
vi.mock('../lib/reset-link', () => ({ resolveResetLinkUrl: resolveResetLinkUrlMock }))

describe('ResetLinkModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    copyToClipboardMock.mockResolvedValue(true)
    resolveResetLinkUrlMock.mockImplementation((resetUrl) => resetUrl)
  })

  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('shows copied feedback after a successful copy', async () => {
    const wrapper = mount(ResetLinkModal, {
      props: { resetUrl: 'http://bookorbit.test/reset' },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Copy')
      ?.trigger('click')

    expect(copyToClipboardMock).toHaveBeenCalledWith('http://bookorbit.test/reset')
    expect(wrapper.text()).toContain('Copied!')

    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.text()).toContain('Copy')
    expect(wrapper.text()).not.toContain('Copied!')
  })

  it('shows failure feedback when copy fails', async () => {
    copyToClipboardMock.mockResolvedValue(false)
    const wrapper = mount(ResetLinkModal, {
      props: { resetUrl: 'http://bookorbit.test/reset' },
    })

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Copy')
      ?.trigger('click')

    expect(wrapper.text()).toContain('Copy failed')

    await vi.advanceTimersByTimeAsync(2000)
    expect(wrapper.text()).toContain('Copy')
    expect(wrapper.text()).not.toContain('Copy failed')
  })

  it('displays and copies the resolved public URL', async () => {
    resolveResetLinkUrlMock.mockReturnValue('https://books.example.test/reset-password?token=abc')
    const wrapper = mount(ResetLinkModal, {
      props: { resetUrl: 'http://172.18.0.4:3000/reset-password?token=abc' },
    })

    expect(resolveResetLinkUrlMock).toHaveBeenCalledWith('http://172.18.0.4:3000/reset-password?token=abc', window.location.origin)
    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('https://books.example.test/reset-password?token=abc')

    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Copy')
      ?.trigger('click')
    expect(copyToClipboardMock).toHaveBeenCalledWith('https://books.example.test/reset-password?token=abc')
  })
})
