import { computed, ref } from 'vue'

export type TtsMiniPlayerMode = 'micro' | 'mini' | 'expanded'

const mode = ref<TtsMiniPlayerMode>('mini')
const isReaderFooterVisible = ref(false)

export function useTtsMiniPlayerUi() {
  const isExpanded = computed(() => mode.value === 'expanded')

  function setMode(nextMode: TtsMiniPlayerMode) {
    mode.value = nextMode
  }

  function setExpanded(expanded: boolean) {
    mode.value = expanded ? 'expanded' : 'mini'
  }

  function toggleExpanded() {
    mode.value = mode.value === 'expanded' ? 'mini' : 'expanded'
  }

  function setReaderFooterVisible(visible: boolean) {
    isReaderFooterVisible.value = visible
  }

  return {
    mode,
    isExpanded,
    isReaderFooterVisible,
    setMode,
    setExpanded,
    toggleExpanded,
    setReaderFooterVisible,
  }
}
