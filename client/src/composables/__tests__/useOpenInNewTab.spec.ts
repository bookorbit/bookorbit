import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { useOpenInNewTab } from '../useOpenInNewTab'

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn<(to: unknown) => { href: string }>(() => ({ href: '/books/3' })) }))

vi.mock('vue-router', () => ({ useRouter: () => ({ resolve: resolveMock }) }))

describe('useOpenInNewTab', () => {
  let openSpy: MockInstance<typeof window.open>

  beforeEach(() => {
    resolveMock.mockClear()
    openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
  })

  afterEach(() => {
    openSpy.mockRestore()
  })

  it('opens the resolved href in a detached tab', () => {
    const { openInNewTab } = useOpenInNewTab()

    openInNewTab({ name: 'book-detail', params: { bookId: 3 } })

    expect(resolveMock).toHaveBeenCalledWith({ name: 'book-detail', params: { bookId: 3 } })
    expect(openSpy).toHaveBeenCalledWith('/books/3', '_blank', 'noopener,noreferrer')
  })

  it('opens a tab and cancels the click when it asked for one', () => {
    const { openInNewTabIfRequested } = useOpenInNewTab()
    const event = new MouseEvent('click', { button: 0, ctrlKey: true, cancelable: true })

    expect(openInNewTabIfRequested(event, '/books/3')).toBe(true)
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(true)
  })

  it('leaves a plain click alone', () => {
    const { openInNewTabIfRequested } = useOpenInNewTab()
    const event = new MouseEvent('click', { button: 0, cancelable: true })

    expect(openInNewTabIfRequested(event, '/books/3')).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
  })

  it('does nothing when there is nowhere to go', () => {
    const { openInNewTabIfRequested } = useOpenInNewTab()

    expect(openInNewTabIfRequested(new MouseEvent('click', { ctrlKey: true }), null)).toBe(false)
    expect(openSpy).not.toHaveBeenCalled()
  })
})
