import { onMounted, ref, watch } from 'vue'

import type { MetadataScoreDistribution } from '@projectx/types'
import { fetchMetadataScoreDistribution } from '../api/statistics.api'
import { useStatisticsConfig } from './useStatisticsConfig'

const EMPTY: MetadataScoreDistribution = {
  bins: [],
  unknownCount: 0,
  totalCount: 0,
  percentile25: null,
  percentile50: null,
  percentile75: null,
  percentile90: null,
}

export function useMetadataScoreDistribution() {
  const data = ref<MetadataScoreDistribution>(EMPTY)
  const loading = ref(true)
  const error = ref(false)

  const { filters } = useStatisticsConfig()

  async function load() {
    loading.value = true
    error.value = false
    try {
      data.value = await fetchMetadataScoreDistribution(filters.value)
    } catch {
      error.value = true
    } finally {
      loading.value = false
    }
  }

  watch(() => filters.value.libraryIds.join(','), load)
  onMounted(load)
  return { data, loading, error }
}
