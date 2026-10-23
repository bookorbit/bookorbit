import { onScopeDispose } from 'vue'
import { useThemeStore } from '@/stores/theme'

/** Lets the chosen style dress the app shell for as long as the calling component lives. */
export function useAppStyleScope(): void {
  const themeStore = useThemeStore()
  themeStore.setStyleScopeActive(true)
  onScopeDispose(() => themeStore.setStyleScopeActive(false))
}
