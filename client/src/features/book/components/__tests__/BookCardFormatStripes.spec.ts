import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import BookCardFormatStripes from '../BookCardFormatStripes.vue'

function visibleAt(wrapper: ReturnType<typeof mount>, tier: '' | '130' | '170' | '230') {
  // Each element's classes say from which cover width it shows; the base tier is under 130 px.
  return wrapper
    .findAll('[data-testid="card-format-stripe"], [data-testid="card-format-stripes-more"]')
    .filter((element) => {
      const classes = element.classes()
      const shownFrom = ['', '130', '170', '230'].filter((width) =>
        width === '' ? !classes.includes('hidden') : classes.includes(`@min-[${width}px]:inline-flex`),
      )
      const hiddenFrom = ['130', '170', '230'].filter((width) => classes.includes(`@min-[${width}px]:hidden`))
      const order = ['', '130', '170', '230']
      const at = order.indexOf(tier)
      const shown = shownFrom.some((width) => order.indexOf(width) <= at)
      const hidden = hiddenFrom.some((width) => order.indexOf(width) <= at)
      return shown && !hidden
    })
    .map((element) => element.text())
}

describe('BookCardFormatStripes', () => {
  it('fits more formats as the cover widens, folding the rest into a count', () => {
    const wrapper = mount(BookCardFormatStripes, { props: { ownKeys: ['epub', 'm4b', 'azw3', 'mobi', 'pdf', 'fb2'] } })

    expect(visibleAt(wrapper, '')).toEqual(['EPUB', '+5'])
    expect(visibleAt(wrapper, '130')).toEqual(['EPUB', '+5'])
    expect(visibleAt(wrapper, '170')).toEqual(['EPUB', 'M4B', '+4'])
    expect(visibleAt(wrapper, '230')).toEqual(['EPUB', 'M4B', 'AZW3', '+3'])
  })

  it('shows every format without a count when they all fit', () => {
    const wrapper = mount(BookCardFormatStripes, { props: { ownKeys: ['epub', 'mobi'] } })

    expect(visibleAt(wrapper, '')).toEqual(['EPUB', '+1'])
    expect(visibleAt(wrapper, '130')).toEqual(['EPUB', 'MOBI'])
    expect(visibleAt(wrapper, '230')).toEqual(['EPUB', 'MOBI'])
  })

  it('marks a linked book format and renders nothing without formats', () => {
    const linked = mount(BookCardFormatStripes, {
      props: {
        ownKeys: ['epub'],
        linked: { groupId: 1, memberCount: 2, books: [{ bookId: 9, libraryId: 2, formats: ['m4b'], mediaKind: 'audiobook' }] },
      },
    })
    expect(linked.findAll('[data-testid="card-format-stripe"]').map((stripe) => stripe.attributes('data-linked'))).toEqual([undefined, 'true'])
    expect(linked.find('[data-testid="card-format-stripe-linked"]').exists()).toBe(true)

    expect(mount(BookCardFormatStripes, { props: { ownKeys: [] } }).html()).toBe('<!--v-if-->')
  })
})
