import { computed, type Ref } from 'vue'

export function useEffectiveSeriesCollapse(preference: Ref<boolean>, selectionMode: Ref<boolean>) {
  return computed(() => preference.value && !selectionMode.value)
}
