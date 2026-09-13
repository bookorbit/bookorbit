import { describe, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import type { DuplicateCluster } from '@bookorbit/types'

import { useDuplicateReview } from '../useDuplicateReview'

function makeCluster(ids: number[], similarity = 0.9): DuplicateCluster {
  return {
    clusterId: `cluster-${ids[0]}`,
    entities: ids.map((id) => ({ id, name: `Entity ${id}`, bookCount: 1, bookTitles: [] })),
    averageSimilarity: similarity,
    suggestedTargetId: ids[0]!,
    pairDetails: [],
  }
}

describe('useDuplicateReview', () => {
  it('opens the first group so the panel is never blank when results arrive', () => {
    const clusters = ref([makeCluster([1, 2]), makeCluster([3, 4])])

    const { activeKey } = useDuplicateReview(clusters)

    expect(activeKey.value).toBe('1|2')
  })

  it('keeps the current group selected when the list is refetched', async () => {
    const clusters = ref([makeCluster([1, 2]), makeCluster([3, 4])])
    const { activeKey, selectCluster } = useDuplicateReview(clusters)

    selectCluster('3|4')
    clusters.value = [makeCluster([1, 2]), makeCluster([3, 4])]
    await nextTick()

    expect(activeKey.value).toBe('3|4')
  })

  it('advances to the next group when the reviewed one is merged away', async () => {
    const clusters = ref([makeCluster([1, 2]), makeCluster([3, 4])])
    const { activeKey } = useDuplicateReview(clusters)

    clusters.value = [makeCluster([3, 4])]
    await nextTick()

    expect(activeKey.value).toBe('3|4')
  })

  it('clears the selection once nothing is left to review', async () => {
    const clusters = ref([makeCluster([1, 2])])
    const { activeKey, activeCluster } = useDuplicateReview(clusters)

    clusters.value = []
    await nextTick()

    expect(activeKey.value).toBeNull()
    expect(activeCluster.value).toBeNull()
  })

  it('identifies a group by its members so per-page server ids cannot collide', async () => {
    const clusters = ref([makeCluster([1, 2])])
    const { activeCluster } = useDuplicateReview(clusters)

    clusters.value = [{ ...makeCluster([1, 2]), clusterId: 'cluster-0' }]
    await nextTick()

    expect(activeCluster.value?.entities.map((entity) => entity.id)).toEqual([1, 2])
  })

  it('lets the reader drop back to the list on a narrow screen', () => {
    const clusters = ref([makeCluster([1, 2])])
    const { activeCluster, clearSelection } = useDuplicateReview(clusters)

    clearSelection()

    expect(activeCluster.value).toBeNull()
  })
})
