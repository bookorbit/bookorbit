import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { AuthorDetail } from '@bookorbit/types'
import AuthorHeader from './AuthorHeader.vue'

const author: AuthorDetail = {
  id: 7,
  name: 'Author',
  sortName: null,
  description: null,
  imageUrl: null,
  bookCount: 24,
  lastAddedAt: '2026-01-01T00:00:00.000Z',
}

describe('AuthorHeader', () => {
  it('does not shrink when the book list exceeds the scroll viewport', () => {
    const wrapper = mount(AuthorHeader, {
      props: { author },
    })

    expect(wrapper.get('section').classes()).toContain('shrink-0')
  })
})
