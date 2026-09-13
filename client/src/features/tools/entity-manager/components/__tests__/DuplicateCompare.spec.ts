import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import type { ClusterEntity, DuplicateCluster } from '@bookorbit/types'

import DuplicateCompare from '../DuplicateCompare.vue'

function makeEntity(id: number, overrides: Partial<ClusterEntity> = {}): ClusterEntity {
  return { id, name: `Entity ${id}`, bookCount: 1, bookTitles: [], ...overrides }
}

function makeCluster(overrides: Partial<DuplicateCluster> = {}): DuplicateCluster {
  return {
    clusterId: 'cluster-0',
    entities: [makeEntity(1, { bookCount: 3, bookTitles: ['A Title'] }), makeEntity(2, { bookCount: 0 })],
    averageSimilarity: 0.94,
    suggestedTargetId: 1,
    pairDetails: [{ idA: 1, idB: 2, similarity: 0.94, reasons: [] }],
    ...overrides,
  }
}

function mountCompare(overrides: Partial<InstanceType<typeof DuplicateCompare>['$props']> = {}) {
  return mount(DuplicateCompare, {
    props: { cluster: makeCluster(), operationLoading: false, ...overrides },
  })
}

describe('DuplicateCompare', () => {
  it('preselects the suggested target so the safe choice needs no interaction', async () => {
    const wrapper = mountCompare()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Merge 1 into target'))!
      .trigger('click')

    expect(wrapper.emitted('merge')?.[0]).toEqual([1, [2], false])
  })

  it('recomputes the merge sources when a different entity is chosen to keep', async () => {
    const wrapper = mountCompare()

    await wrapper.findAll('input[type="radio"]')[1]!.setValue(true)
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Merge 1 into target'))!
      .trigger('click')

    expect(wrapper.emitted('merge')?.[0]).toEqual([2, [1], false])
  })

  it('makes the whole card the click target rather than a strip inside it', () => {
    const wrapper = mountCompare()
    const labels = wrapper.findAll('label')

    expect(labels).toHaveLength(2)
    labels.forEach((label) => {
      expect(label.find('input[type="radio"]').exists()).toBe(true)
      expect(label.text()).toContain('Entity')
    })
  })

  it('groups the choices as radios so only one survives and arrow keys work', () => {
    const wrapper = mountCompare()
    const radios = wrapper.findAll('input[type="radio"]')

    expect(radios.map((radio) => radio.attributes('name'))).toEqual(['duplicate-merge-target', 'duplicate-merge-target'])
    expect(radios.filter((radio) => (radio.element as HTMLInputElement).checked)).toHaveLength(1)
  })

  it('keeps the dismiss control outside the card label so it cannot also select the card', async () => {
    const wrapper = mountCompare()
    const dismiss = wrapper.findAll('[aria-label="Dismiss all pairs for this entity"]')[1]!

    expect(dismiss.element.closest('label')).toBeNull()

    await dismiss.trigger('click')
    expect(wrapper.emitted('dismissEntity')?.[0]).toEqual([2])
  })

  it('passes the write-to-files choice through with the merge', async () => {
    const wrapper = mountCompare()

    await wrapper.find('[role="switch"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Merge 1 into target'))!
      .trigger('click')

    expect(wrapper.emitted('merge')?.[0]).toEqual([1, [2], true])
  })

  it('labels exactly one card as the one being kept', () => {
    const wrapper = mountCompare()

    expect(wrapper.text().match(/Keep this one/g)).toHaveLength(1)
    expect(wrapper.text().match(/Merge away/g)).toHaveLength(1)
  })

  it('warns when a record has no books rather than showing an empty list', () => {
    expect(mountCompare().text()).toContain('No books linked to this record')
  })

  it('emits a dismissal for a single entity', async () => {
    const wrapper = mountCompare()

    await wrapper.findAll('[aria-label="Dismiss all pairs for this entity"]')[0]!.trigger('click')

    expect(wrapper.emitted('dismissEntity')?.[0]).toEqual([1])
  })

  it('emits a whole-group dismissal from Not a match', async () => {
    const wrapper = mountCompare()

    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Not a match'))!
      .trigger('click')

    expect(wrapper.emitted('dismissCluster')).toHaveLength(1)
  })

  it('hides the pair breakdown for a plain two-entity group', () => {
    expect(mountCompare().text()).not.toContain('Pair details')
  })

  it('shows the pair breakdown once a group has more than one pair', async () => {
    const cluster = makeCluster({
      entities: [makeEntity(1), makeEntity(2), makeEntity(3)],
      pairDetails: [
        { idA: 1, idB: 2, similarity: 0.94, reasons: [] },
        { idA: 2, idB: 3, similarity: 0.81, reasons: [] },
      ],
    })
    const wrapper = mountCompare({ cluster })

    expect(wrapper.text()).toContain('Pair details')

    await wrapper.findAll('[aria-label="Dismiss this pair"]')[1]!.trigger('click')
    expect(wrapper.emitted('dismissPair')?.[0]).toEqual([2, 3])
  })

  it('reports how many entities the merge will remove', () => {
    const cluster = makeCluster({ entities: [makeEntity(1), makeEntity(2), makeEntity(3)] })

    expect(mountCompare({ cluster }).text()).toContain('2 entities will be merged and removed')
  })

  it('blocks merging while another operation is in flight', () => {
    const wrapper = mountCompare({ operationLoading: true })
    const merge = wrapper.findAll('button').find((button) => button.text().includes('Merge 1 into target'))!

    expect(merge.attributes('disabled')).toBeDefined()
  })

  it('offers a way back to the list for narrow screens', async () => {
    const wrapper = mountCompare()

    await wrapper.find('[aria-label="Back to groups"]').trigger('click')

    expect(wrapper.emitted('back')).toHaveLength(1)
  })
})
