import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { BOOK_FORMATS, READ_ALONG_FORMAT_PRIORITY } from '@bookorbit/types'
import FilterFormatPicker from './FilterFormatPicker.vue'

describe('FilterFormatPicker', () => {
  it('offers read-along beside the physical book formats', async () => {
    const wrapper = mount(FilterFormatPicker, { props: { modelValue: [] } })
    const buttons = wrapper.findAll('button')
    const readAlong = buttons.find((button) => button.attributes('aria-label') === 'Read-aloud EPUB')

    expect(buttons).toHaveLength(BOOK_FORMATS.length + 1)
    expect(readAlong).toBeDefined()
    await readAlong!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[[READ_ALONG_FORMAT_PRIORITY]]])
  })
})
