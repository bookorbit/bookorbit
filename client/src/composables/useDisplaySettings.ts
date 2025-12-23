import { ref, watch } from 'vue'
import { storage } from '@/services/storage'

export function useDisplaySettings() {
  const coverSize = ref(storage.get('coverSize', 150))
  const gridGap = ref(storage.get('gridGap', 16))
  const viewMode = ref<'grid' | 'list'>(storage.get('viewMode', 'grid'))

  watch(coverSize, (v) => storage.set('coverSize', v))
  watch(gridGap, (v) => storage.set('gridGap', v))
  watch(viewMode, (v) => storage.set('viewMode', v))

  return { coverSize, gridGap, viewMode }
}
