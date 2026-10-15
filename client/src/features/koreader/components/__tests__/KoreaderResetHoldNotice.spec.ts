import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { KoreaderResetHeldDevice } from '@bookorbit/types'

import KoreaderResetHoldNotice from '../KoreaderResetHoldNotice.vue'

type Release = (deviceId: string) => Promise<boolean>

function held(overrides: Partial<KoreaderResetHeldDevice> = {}): KoreaderResetHeldDevice {
  return { device: 'Kindle', deviceId: 'kindle-1', percentage: 26.67, updatedAt: '2026-10-12T00:00:00.000Z', ...overrides }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mountNotice(devices: KoreaderResetHeldDevice[], release: Release) {
  return mount(KoreaderResetHoldNotice, { props: { held: devices, release } })
}

function rows(wrapper: ReturnType<typeof mountNotice>) {
  return wrapper.findAll('[data-testid="koreader-reset-hold"]')
}

describe('KoreaderResetHoldNotice', () => {
  it('names every held device with its position', () => {
    const wrapper = mountNotice([held(), held({ device: 'Kobo Libra', deviceId: 'kobo-1', percentage: 50 })], vi.fn<Release>())

    const text = rows(wrapper).map((row) => row.text())
    expect(text).toHaveLength(2)
    expect(text[0]).toContain('Kindle still has the old position (27%)')
    expect(text[1]).toContain('Kobo Libra still has the old position (50%)')
  })

  it('renders nothing for an empty list', () => {
    const wrapper = mountNotice([], vi.fn<Release>())
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it.each([
    [0.4, '1%'],
    [99.6, '99%'],
    [99.4, '99%'],
    [0, '0%'],
    [100, '100%'],
    [140, '100%'],
    [-3, '0%'],
  ])('never rounds a held position of %s to the start or the end (%s)', (percentage, expected) => {
    const wrapper = mountNotice([held({ percentage })], vi.fn<Release>())
    expect(wrapper.text()).toContain(`old position (${expected})`)
  })

  it('releases the device it belongs to and reports success', async () => {
    const release = vi.fn<Release>().mockResolvedValue(true)
    const wrapper = mountNotice([held(), held({ device: 'Kobo', deviceId: 'kobo-1' })], release)

    await rows(wrapper)[1]!.get('button').trigger('click')
    await flushPromises()

    expect(release).toHaveBeenCalledExactlyOnceWith('kobo-1')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('disables only the pending button and ignores repeat clicks until the release settles', async () => {
    const pending = deferred<boolean>()
    const release = vi.fn<Release>().mockReturnValue(pending.promise)
    const wrapper = mountNotice([held(), held({ device: 'Kobo', deviceId: 'kobo-1' })], release)

    const [first, second] = rows(wrapper).map((row) => row.get('button'))
    await first!.trigger('click')
    await first!.trigger('click')

    expect(release).toHaveBeenCalledTimes(1)
    expect(first!.attributes('disabled')).toBeDefined()
    expect(first!.text()).toBe('Releasing...')
    expect(second!.attributes('disabled')).toBeUndefined()
    expect(second!.text()).toBe("Use this device's position")

    pending.resolve(true)
    await flushPromises()

    expect(first!.attributes('disabled')).toBeUndefined()
    expect(first!.text()).toBe("Use this device's position")
  })

  it('keeps the hold and says so when the server refuses the release', async () => {
    const release = vi.fn<Release>().mockResolvedValue(false)
    const wrapper = mountNotice([held()], release)

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toBe('Could not use this position. Try again.')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('treats a failed request like a refusal instead of leaving the button stuck', async () => {
    const release = vi.fn<Release>().mockRejectedValue(new Error('offline'))
    const wrapper = mountNotice([held()], release)

    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
  })

  it('clears the failure when the release is retried', async () => {
    const release = vi.fn<Release>().mockResolvedValueOnce(false).mockResolvedValueOnce(true)
    const wrapper = mountNotice([held()], release)

    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)

    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(release).toHaveBeenCalledTimes(2)
  })

  it('marks the warning icon decorative', () => {
    const wrapper = mountNotice([held()], vi.fn<Release>())
    expect(wrapper.get('svg').attributes('aria-hidden')).toBe('true')
  })
})
