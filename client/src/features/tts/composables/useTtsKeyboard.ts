import { onMounted, onUnmounted } from 'vue'

interface TtsKeyboardActions {
  togglePlayPause: () => void
  prevBlock: () => void
  nextBlock: () => void
  increaseSpeed: () => void
  decreaseSpeed: () => void
}

export function useTtsKeyboard(isActive: () => boolean, actions: TtsKeyboardActions) {
  function handleKeydown(event: KeyboardEvent) {
    if (!isActive()) return
    const target = event.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return

    switch (event.key) {
      case ' ':
        event.preventDefault()
        actions.togglePlayPause()
        break
      case 'ArrowLeft':
        event.preventDefault()
        actions.prevBlock()
        break
      case 'ArrowRight':
        event.preventDefault()
        actions.nextBlock()
        break
      case '+':
      case '=':
        actions.increaseSpeed()
        break
      case '-':
        actions.decreaseSpeed()
        break
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

  return {}
}
