import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AnnotationHubOverview } from '@bookorbit/types'
import { i18n } from '@/i18n'
import HubSideRail from '../hub/HubSideRail.vue'

const stubs = {
  RouterLink: { template: '<a><slot /></a>' },
  AnnotationBookThumb: { template: '<div />' },
  AnnotationActivitySpark: { template: '<div />' },
}

function makeOverview(overrides: Partial<AnnotationHubOverview> = {}): AnnotationHubOverview {
  return {
    total: 12,
    books: 3,
    withNotes: 2,
    needsReview: 0,
    trashed: 46,
    originBreakdown: [],
    colorBreakdown: [],
    shelf: [],
    weeks: [],
    busiestWeek: null,
    longestQuietWeeks: 0,
    devices: [],
    ...overrides,
  }
}

function mountRail(overview: AnnotationHubOverview, trashOpen = false) {
  return mount(HubSideRail, {
    props: { overview, selectedColors: [], selectedBookId: 'all', selectedOrigin: 'all', trashOpen },
    global: { stubs },
  })
}

describe('HubSideRail', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'en'
  })

  it('names the trash toggle with its count and pressed state', async () => {
    const wrapper = mountRail(makeOverview(), true)
    const toggle = wrapper.get('header button[aria-pressed]')

    expect(toggle.attributes('aria-label')).toBe('Trash, 46 annotations')
    expect(toggle.attributes('aria-pressed')).toBe('true')

    await toggle.trigger('click')
    expect(wrapper.emitted('openTrash')).toHaveLength(1)
  })

  it('uses the singular for one trashed annotation', () => {
    const wrapper = mountRail(makeOverview({ trashed: 1 }))

    expect(wrapper.get('header button[aria-pressed]').attributes('aria-label')).toBe('Trash, 1 annotation')
  })
})
