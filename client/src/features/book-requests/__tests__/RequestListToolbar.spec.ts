import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import RequestListToolbar from '../components/RequestListToolbar.vue'
import { DEFAULT_LIST_STATE, REQUEST_LIST_VIEWS, type RequestListState, type RequestListView } from '../requestListQuery'

function render(state: Partial<RequestListState> = {}) {
  return mount(RequestListToolbar, {
    props: {
      state: { ...DEFAULT_LIST_STATE, ...state },
      counts: null,
      showRequester: true,
      requesterOptions: [],
      density: 'comfortable',
    },
  })
}

function viewButton(wrapper: ReturnType<typeof render>, view: RequestListView) {
  const buttons = wrapper.findAll('button[aria-pressed]').filter((button) => !button.attributes('aria-label'))
  return buttons[REQUEST_LIST_VIEWS.indexOf(view)]!
}

describe('RequestListToolbar', () => {
  it('drops a status filter the next view can never hold', async () => {
    const wrapper = render({ status: 'searching' })
    await viewButton(wrapper, 'needs_action').trigger('click')
    expect(wrapper.emitted('change')).toEqual([[{ view: 'needs_action', status: '' }]])
  })

  it('keeps a status filter the next view can hold', async () => {
    const wrapper = render({ status: 'failed' })
    await viewButton(wrapper, 'hidden').trigger('click')
    expect(wrapper.emitted('change')).toEqual([[{ view: 'hidden' }]])
  })

  it('marks the current view as pressed', () => {
    const wrapper = render({ view: 'closed' })
    expect(viewButton(wrapper, 'closed').attributes('aria-pressed')).toBe('true')
    expect(viewButton(wrapper, 'all').attributes('aria-pressed')).toBe('false')
  })
})
