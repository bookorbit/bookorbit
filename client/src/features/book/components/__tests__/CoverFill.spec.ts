import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CoverFill from '../CoverFill.vue'

describe('CoverFill', () => {
  it('renders a blurred backdrop behind the complete cover', () => {
    const wrapper = mount(CoverFill, {
      props: {
        src: '/api/v1/books/42/cover?t=version',
        alt: 'A portrait cover',
        loading: 'eager',
      },
    })

    const images = wrapper.findAll('img')
    expect(images).toHaveLength(2)
    expect(images[0]?.attributes()).toMatchObject({ 'aria-hidden': 'true', alt: '', loading: 'eager' })
    expect(images[0]?.classes()).toEqual(expect.arrayContaining(['object-cover', 'blur-xl', 'scale-125']))
    expect(images[1]?.attributes()).toMatchObject({ alt: 'A portrait cover', loading: 'eager' })
    expect(images[1]?.classes()).toContain('object-contain')
  })
})
