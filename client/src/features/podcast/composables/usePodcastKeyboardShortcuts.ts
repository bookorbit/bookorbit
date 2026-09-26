import { onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { usePodcastPlayer } from './usePodcastPlayer'
import { usePodcastShortcuts } from './usePodcastShortcuts'

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]'
const COMPOSITE_SELECTOR = '[role="menu"], [role="listbox"], [role="dialog"], [role="grid"], [role="tablist"], [role="alertdialog"]'
const ACTIVATABLE_SELECTOR = 'button, a[href], [role="button"], summary'
const PLAYER_SURFACE_SELECTOR = '[data-podcast-mini-player]'

export function usePodcastKeyboardShortcuts() {
  const route = useRoute()
  const player = usePodcastPlayer()
  const { toggleShortcuts, requestBookmarkComposer } = usePodcastShortcuts()

  /**
   * Space and the arrows scroll the page everywhere else, so they only reach the player when the player
   * route is open or focus sits inside the mini player. Letter shortcuts stay available wherever playback is.
   */
  function ownsNavigationKeys(target: HTMLElement | null): boolean {
    return route.name === 'podcast-player' || Boolean(target?.closest(PLAYER_SURFACE_SELECTOR))
  }

  function handleShortcut(event: KeyboardEvent): void {
    if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return
    if (!player.episode.value || route.meta?.public === true) return
    const target = event.target as HTMLElement | null
    if (target?.closest(EDITABLE_SELECTOR) || target?.closest(COMPOSITE_SELECTOR)) return

    if (event.key === '?') {
      event.preventDefault()
      toggleShortcuts()
      return
    }
    if (event.key === 'j') {
      player.skipBackward()
      return
    }
    if (event.key === 'l') {
      player.skipForward()
      return
    }
    if (event.key === 'n') {
      void player.playNext()
      return
    }
    if (event.key === 'p') {
      void player.playPrevious()
      return
    }
    if (event.key === 'm') {
      player.toggleMute()
      return
    }
    if (event.key === '>' || (event.key === '.' && event.shiftKey)) {
      player.stepPlaybackRate(1)
      return
    }
    if (event.key === '<' || (event.key === ',' && event.shiftKey)) {
      player.stepPlaybackRate(-1)
      return
    }
    if (event.key === 'b' && route.name === 'podcast-player') {
      event.preventDefault()
      requestBookmarkComposer()
      return
    }
    if (!ownsNavigationKeys(target)) return
    if (event.code === 'Space') {
      if (target?.closest(ACTIVATABLE_SELECTOR)) return
      event.preventDefault()
      player.togglePlayback()
      return
    }
    if (event.key === 'ArrowLeft') player.skipBackward()
    else if (event.key === 'ArrowRight') player.skipForward()
    else if (event.key === 'ArrowUp') {
      event.preventDefault()
      player.setVolume(player.volume.value + 0.05)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      player.setVolume(player.volume.value - 0.05)
    }
  }

  onMounted(() => window.addEventListener('keydown', handleShortcut))
  onUnmounted(() => window.removeEventListener('keydown', handleShortcut))

  return { handleShortcut }
}
