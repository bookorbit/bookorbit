import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import BookDockBulkEditDialog from '../BookDockBulkEditDialog.vue'

const api = vi.fn<(...args: unknown[]) => Promise<Response>>()
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => api(...args) }))

let wrapper: VueWrapper

function mountDialog() {
  wrapper = mount(BookDockBulkEditDialog, {
    props: { selectionPayload: { fileIds: [3, 4] }, selectionCount: 2 },
    global: { stubs: { Teleport: true } },
  })
}

function fieldRow(label: string) {
  return wrapper.findAll('div.flex.items-center.gap-2').find((row) => row.find('label span').exists() && row.get('label span').text() === label)!
}

// The stubbed Teleport re-creates its content on every update, so elements are looked up afresh.
function fieldInput(label: string) {
  return fieldRow(label).get<HTMLInputElement>('label input')
}

async function enableAndType(label: string, value: string) {
  await fieldRow(label).get('input[type="checkbox"]').trigger('change')
  await fieldInput(label).setValue(value)
}

function applyButton() {
  return wrapper.findAll('button').find((button) => button.text().trim() === 'Apply')!
}

function sentBody() {
  const [, init] = api.mock.calls[0] as [string, RequestInit]
  return JSON.parse(init.body as string)
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  api.mockReset().mockResolvedValue({ ok: true, json: async () => ({ total: 2, updated: 2, failed: 0 }) } as Response)
})
afterEach(() => wrapper?.unmount())

describe('BookDockBulkEditDialog', () => {
  // Issue #1624: a hyphenated ISBN used to reach the server and fail its 13 character limit.
  it('applies pasted ISBNs cleaned instead of sending values the server would refuse', async () => {
    mountDialog()

    await enableAndType('ISBN-13', '978-3426226223')
    await enableAndType('ISBN-10', '\u200B0-8044-2957-x')
    expect(fieldInput('ISBN-13').element.value).toBe('9783426226223')
    expect(fieldInput('ISBN-10').element.value).toBe('080442957X')

    await applyButton().trigger('click')
    await flushPromises()

    expect(api).toHaveBeenCalledWith('/api/v1/book-dock/files/bulk-edit', expect.objectContaining({ method: 'POST' }))
    expect(sentBody()).toMatchObject({
      fileIds: [3, 4],
      fields: { isbn13: '9783426226223', isbn10: '080442957X' },
      enabledFields: ['isbn13', 'isbn10'],
    })
  })

  it('keeps an identifier field disabled until it is enabled', async () => {
    mountDialog()

    expect(fieldInput('ISBN-13').element.disabled).toBe(true)

    await fieldRow('ISBN-13').get('input[type="checkbox"]').trigger('change')
    expect(fieldInput('ISBN-13').element.disabled).toBe(false)
  })

  it('leaves text fields that are not identifiers untouched', async () => {
    mountDialog()

    await enableAndType('Publisher', ' Droemer - Knaur ')
    await applyButton().trigger('click')
    await flushPromises()

    expect(sentBody().fields).toEqual({ publisher: ' Droemer - Knaur ' })
  })
})
