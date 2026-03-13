import { ref } from 'vue'
import type { MetadataScoreWeights } from '@projectx/types'
import { DEFAULT_METADATA_SCORE_WEIGHTS } from '@projectx/types'
import { api } from '@/lib/api'

const weights = ref<MetadataScoreWeights>({ ...DEFAULT_METADATA_SCORE_WEIGHTS })
let fetchPromise: Promise<void> | null = null

export function useMetadataScoreWeights() {
  function fetchWeights() {
    if (fetchPromise) return fetchPromise
    fetchPromise = api('/api/v1/metadata-score/weights')
      .then((res) => {
        if (res.ok)
          return res.json().then((data: MetadataScoreWeights) => {
            weights.value = data
          })
      })
      .catch(() => undefined)
    return fetchPromise
  }

  function resetFetchCache() {
    fetchPromise = null
  }

  return { weights, fetchWeights, resetFetchCache }
}
