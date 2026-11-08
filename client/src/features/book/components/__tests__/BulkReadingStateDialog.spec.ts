import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import BulkReadingStateDialog from '../BulkReadingStateDialog.vue'

const dialogStubs = {
  DialogRoot: { props: ['open'], template: '<div v-if="open"><slot /></div>' },
  DialogPortal: { template: '<div><slot /></div>' },
  DialogOverlay: { template: '<div />' },
  DialogContent: { template: '<section><slot /></section>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  DialogDescription: { template: '<p><slot /></p>' },
}

function mountDialog() {
  return mount(BulkReadingStateDialog, {
    props: { open: true, bookCount: 3 },
    global: { plugins: [i18n], stubs: dialogStubs },
  })
}

describe('BulkReadingStateDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-05T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults completed books to an explicit undated finish', async () => {
    const wrapper = mountDialog()
    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')

    expect(wrapper.get<HTMLSelectElement>('#bulk-reading-status').element.value).toBe('read')
    expect(checkboxes[1]!.element.checked).toBe(true)
    expect(wrapper.get<HTMLSelectElement>('#bulk-finished-at-mode').element.value).toBe('clear')

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ status: 'read', finishedAt: null }])
  })

  it('submits explicit start and finish dates', async () => {
    const wrapper = mountDialog()
    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    await checkboxes[0]!.setValue(true)
    await wrapper.get<HTMLInputElement>('#bulk-started-at').setValue('2026-10-01')
    await wrapper.get<HTMLSelectElement>('#bulk-finished-at-mode').setValue('set')
    await wrapper.get<HTMLInputElement>('#bulk-finished-at').setValue('2026-10-20')

    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('confirm')?.[0]).toEqual([{ status: 'read', startedAt: '2026-10-01', finishedAt: '2026-10-20' }])
  })

  it('blocks a finish date before the selected start date', async () => {
    const wrapper = mountDialog()
    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    await checkboxes[0]!.setValue(true)
    await wrapper.get<HTMLInputElement>('#bulk-started-at').setValue('2026-10-20')
    await wrapper.get<HTMLSelectElement>('#bulk-finished-at-mode').setValue('set')
    await wrapper.get<HTMLInputElement>('#bulk-finished-at').setValue('2026-10-01')

    expect(wrapper.get('[role="alert"]').text()).toContain('on or after')
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true)
  })

  it('blocks reading dates for statuses that clear the reading lifecycle', async () => {
    const wrapper = mountDialog()
    const checkboxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]')
    await wrapper.get<HTMLSelectElement>('#bulk-reading-status').setValue('unread')
    await checkboxes[0]!.setValue(true)
    await wrapper.get<HTMLInputElement>('#bulk-started-at').setValue('2026-10-01')

    expect(wrapper.get('[role="alert"]').text()).toContain('cannot be set')
    expect(wrapper.get<HTMLButtonElement>('button[type="submit"]').element.disabled).toBe(true)
  })
})
