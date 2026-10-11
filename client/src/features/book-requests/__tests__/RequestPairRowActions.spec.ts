import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookRequestItem } from '@bookorbit/types'
import RequestPairRowActions from '../components/RequestPairRowActions.vue'

function request(overrides: Partial<BookRequestItem>): BookRequestItem {
  return {
    id: 10,
    userId: 4,
    mediaKind: 'ebook',
    status: 'approved',
    dismissed: false,
    download: null,
    fulfillerUserId: null,
    title: 'Dune',
    ...overrides,
  } as BookRequestItem
}

function primaryButton(row: BookRequestItem) {
  const wrapper = mount(RequestPairRowActions, { props: { row, canManage: true, canSelfFulfil: false, currentUserId: 4, busy: false } })
  return wrapper.findAll('button')[0]!
}

describe('RequestPairRowActions', () => {
  it('offers to choose releases while both halves are waiting on one', () => {
    const button = primaryButton({ ...request({}), companion: request({ id: 11, mediaKind: 'audiobook' }) })

    expect(button.text()).toBe('Choose releases')
  })

  it('names the one half still waiting once the other is on its way', () => {
    const button = primaryButton({ ...request({ status: 'downloading' }), companion: request({ id: 11, mediaKind: 'audiobook' }) })

    expect(button.text()).toBe('Find an audiobook release')
  })

  it('opens the picker on the half that leads the row', async () => {
    const wrapper = mount(RequestPairRowActions, {
      props: {
        row: { ...request({}), companion: request({ id: 11, mediaKind: 'audiobook' }) },
        canManage: true,
        canSelfFulfil: false,
        currentUserId: 4,
        busy: false,
      },
    })

    await wrapper.findAll('button')[0]!.trigger('click')

    expect(wrapper.emitted('grab')?.[0]?.[0]).toEqual(expect.objectContaining({ id: 10 }))
  })
})
