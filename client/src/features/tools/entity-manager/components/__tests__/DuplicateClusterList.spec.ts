import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { DuplicateCluster } from '@bookorbit/types'

import DuplicateClusterList from '../DuplicateClusterList.vue'

function makeCluster(ids: number[], similarity: number, counts: number[] = []): DuplicateCluster {
  return {
    clusterId: `cluster-${ids[0]}`,
    entities: ids.map((id, index) => ({ id, name: `Entity ${id}`, bookCount: counts[index] ?? 1, bookTitles: [] })),
    averageSimilarity: similarity,
    suggestedTargetId: ids[0]!,
    pairDetails: [],
  }
}

function mountList(overrides: Partial<InstanceType<typeof DuplicateClusterList>['$props']> = {}) {
  return mount(DuplicateClusterList, {
    props: {
      clusters: [makeCluster([1, 2], 0.94), makeCluster([3, 4], 0.62)],
      activeKey: '1|2',
      page: 1,
      totalPages: 1,
      ...overrides,
    },
  })
}

describe('DuplicateClusterList', () => {
  it('leads each group with its best represented entity', () => {
    const wrapper = mountList({ clusters: [makeCluster([1, 2], 0.9, [1, 9])] })

    expect(wrapper.find('li').text()).toContain('Entity 2')
  })

  it('summarises how many other entities are in the group', () => {
    expect(mountList({ clusters: [makeCluster([1, 2, 3], 0.9)] }).text()).toContain('+ 2 others')
  })

  it('shows the similarity of each group so the list can be triaged without opening it', () => {
    const wrapper = mountList()

    expect(wrapper.text()).toContain('94%')
    expect(wrapper.text()).toContain('62%')
  })

  it('marks the group currently being reviewed', () => {
    const wrapper = mountList({ activeKey: '3|4' })
    const buttons = wrapper.findAll('button')

    expect(buttons[0]!.attributes('aria-current')).toBeUndefined()
    expect(buttons[1]!.attributes('aria-current')).toBe('true')
  })

  it('emits the stable member-derived key when a group is picked', async () => {
    const wrapper = mountList()

    await wrapper.findAll('button')[1]!.trigger('click')

    expect(wrapper.emitted('select')?.[0]).toEqual(['3|4'])
  })

  it('hides paging when every group fits on one page', () => {
    expect(mountList().find('[aria-label="Previous page"]').exists()).toBe(false)
  })

  it('emits page changes and stops at the ends', async () => {
    const wrapper = mountList({ page: 2, totalPages: 3 })

    await wrapper.find('[aria-label="Previous page"]').trigger('click')
    await wrapper.find('[aria-label="Next page"]').trigger('click')

    expect(wrapper.emitted('update:page')).toEqual([[1], [3]])
    expect(mountList({ page: 1, totalPages: 3 }).find('[aria-label="Previous page"]').attributes('disabled')).toBeDefined()
    expect(mountList({ page: 3, totalPages: 3 }).find('[aria-label="Next page"]').attributes('disabled')).toBeDefined()
  })
})
