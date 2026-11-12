import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MetadataFieldLabel from '../MetadataFieldLabel.vue'

describe('MetadataFieldLabel', () => {
  it('renders the lock button inside the control wrapper', () => {
    const wrapper = mount(MetadataFieldLabel, {
      props: {
        label: 'Title',
        field: 'title',
        locked: false,
      },
      slots: {
        default: '<input data-test="control" class="w-full pr-10" />',
      },
    })

    const button = wrapper.get('button[aria-label="Lock Title"]')
    const control = wrapper.get('[data-test="control"]')

    expect(button.classes()).toContain('absolute')
    expect(button.element.parentElement).toBe(control.element.parentElement)
  })

  it('emits the target field when toggled', async () => {
    const wrapper = mount(MetadataFieldLabel, {
      props: {
        label: 'Title',
        field: 'title',
        locked: true,
      },
      slots: {
        default: '<input class="w-full pr-10" />',
      },
    })

    await wrapper.get('button[aria-label="Unlock Title"]').trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([['title']])
  })

  it('places an action beside the label when one is given', () => {
    const wrapper = mount(MetadataFieldLabel, {
      props: { label: 'ISBN-13', field: 'isbn13', locked: false },
      slots: { default: '<input />', action: '<button data-test="action">Find</button>' },
    })

    const action = wrapper.get('[data-test="action"]')
    expect(action.element.parentElement?.querySelector('label')?.textContent).toBe('ISBN-13')
  })
})
