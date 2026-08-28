import { ref, watch } from 'vue'
import { storage } from '@/services/storage'

import { ENTITY_ROW_DENSITIES, type EntityRowDensity } from '../types'

const STORAGE_KEY = 'bookorbit:entity-manager:density'

function readStoredDensity(): EntityRowDensity {
  const stored = storage.get<string>(STORAGE_KEY, 'comfortable')
  return (ENTITY_ROW_DENSITIES as readonly string[]).includes(stored) ? (stored as EntityRowDensity) : 'comfortable'
}

export function useEntityRowDensity() {
  const density = ref<EntityRowDensity>(readStoredDensity())

  watch(density, (value) => storage.set(STORAGE_KEY, value))

  return { density }
}
