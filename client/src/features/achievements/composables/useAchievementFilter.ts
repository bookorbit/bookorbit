import { computed, ref } from 'vue'
import type { DisplayItem, FilterState } from '../types'

export function useAchievementFilter(getAllItems: () => DisplayItem[]) {
  const activeFilter = ref<FilterState>('all')

  const filteredItems = computed((): DisplayItem[] => {
    const items = getAllItems()
    if (activeFilter.value === 'all') {
      return items
    }

    return items.filter((item) => {
      if (item.type === 'tiered') {
        switch (activeFilter.value) {
          case 'earned':
            return item.earnedCount > 0
          case 'locked':
            return item.earnedCount === 0
          case 'in-progress':
            return item.earnedCount > 0 && item.earnedCount < item.totalTiers
          default:
            return true
        }
      }

      const { achievement } = item

      switch (activeFilter.value) {
        case 'earned':
          return achievement.earned
        case 'locked':
          return !achievement.earned
        case 'in-progress':
          return !achievement.earned && achievement.currentProgress !== null && achievement.currentProgress > 0
        default:
          return true
      }
    })
  })

  function setFilter(filter: FilterState): void {
    activeFilter.value = filter
  }

  return { activeFilter, filteredItems, setFilter }
}
