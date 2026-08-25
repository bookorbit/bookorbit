import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BookDockDiscardDialog from '../BookDockDiscardDialog.vue'

const apiMock = vi.fn<(...args: unknown[]) => Promise<Response>>()

vi.mock('@/lib/api', () => ({
  api: (...args: unknown[]) => apiMock(...args),
}))

const ConfirmDialogStub = defineComponent({
  name: 'ConfirmDialog',
  props: {
    title: { type: String, required: true },
    description: { type: String, required: true },
    confirmLabel: { type: String, required: true },
    busy: Boolean,
  },
  emits: ['confirm', 'cancel'],
  template: `
    <div>
      <h2>{{ title }}</h2>
      <p>{{ description }}</p>
      <slot />
      <button type="button" :disabled="busy" @click="$emit('cancel')">Cancel</button>
      <button type="button" :disabled="busy" @click="$emit('confirm')">{{ confirmLabel }}</button>
    </div>
  `,
})

type SelectionPayload = {
  fileIds?: number[]
  selectAll?: boolean
  excludedIds?: number[]
  status?: string
  search?: string
}

function mountDialog(
  selectionCount = 2,
  selectionPayload: SelectionPayload = { selectAll: true, excludedIds: [9], status: 'ready', search: 'Dune' },
) {
  return mount(BookDockDiscardDialog, {
    props: {
      selectionPayload,
      selectionCount,
    },
    global: {
      stubs: { ConfirmDialog: ConfirmDialogStub },
    },
  })
}

describe('BookDockDiscardDialog', () => {
  beforeEach(() => {
    apiMock.mockReset()
  })

  it('warns that discarding permanently deletes the selected files from disk', () => {
    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('Discard the 2 selected files?')
    expect(wrapper.text()).toContain('This permanently deletes the 2 selected files from disk. This action cannot be undone.')
    expect(wrapper.text()).toContain('Delete 2 files')
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('uses singular warning copy for a row discard', () => {
    const wrapper = mountDialog(1, { fileIds: [42] })

    expect(wrapper.text()).toContain('Discard the selected file?')
    expect(wrapper.text()).toContain('This permanently deletes the selected file from disk. This action cannot be undone.')
    expect(wrapper.text()).toContain('Delete file')
  })

  it('closes without deleting when cancelled', async () => {
    const wrapper = mountDialog()

    const cancelButton = wrapper.findAll('button').find((button) => button.text() === 'Cancel')
    expect(cancelButton).toBeDefined()
    await cancelButton!.trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('discards the captured selection only after confirmation', async () => {
    apiMock.mockResolvedValue({ ok: true } as Response)
    const wrapper = mountDialog()

    const confirmButton = wrapper.findAll('button').find((button) => button.text() === 'Delete 2 files')
    expect(confirmButton).toBeDefined()
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(apiMock).toHaveBeenCalledWith('/api/v1/book-dock/files/discard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectAll: true, excludedIds: [9], status: 'ready', search: 'Dune' }),
    })
    expect(wrapper.emitted('discarded')).toHaveLength(1)
  })

  it('keeps the dialog open and reports a failed deletion', async () => {
    apiMock.mockResolvedValue({ ok: false } as Response)
    const wrapper = mountDialog()

    const confirmButton = wrapper.findAll('button').find((button) => button.text() === 'Delete 2 files')
    await confirmButton!.trigger('click')
    await flushPromises()

    expect(wrapper.emitted('discarded')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('The selected files could not be deleted. Try again.')
    expect(wrapper.text()).toContain('Discard the 2 selected files?')
  })
})
