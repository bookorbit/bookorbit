import { onMounted, ref } from 'vue'
import type { AchievementCatalogueResponse, AchievementCategoryGroup } from '@bookorbit/types'
import { fetchAchievements } from '../api/achievementsApi'

export function useAchievements() {
  const categories = ref<AchievementCategoryGroup[]>([])
  const totalEarned = ref(0)
  const totalAvailable = ref(0)
  const loading = ref(true)
  const error = ref(false)

  async function load() {
    loading.value = true
    error.value = false
    try {
      const data: AchievementCatalogueResponse = await fetchAchievements()
      categories.value = data.categories
      totalEarned.value = data.totalEarned
      totalAvailable.value = data.totalAvailable
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  onMounted(load)

  return { categories, totalEarned, totalAvailable, loading, error, reload: load }
}
