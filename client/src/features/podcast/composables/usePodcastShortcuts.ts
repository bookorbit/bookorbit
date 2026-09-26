import { readonly, ref } from 'vue'

export interface PodcastShortcut {
  id: string
  keys: string[]
  group: 'playback' | 'navigation' | 'tools'
}

/** Kept in sync with the handler in `usePodcastKeyboardShortcuts`. */
export const PODCAST_SHORTCUTS: PodcastShortcut[] = [
  { id: 'togglePlayback', keys: ['Space'], group: 'playback' },
  { id: 'speedDown', keys: ['Shift', ','], group: 'playback' },
  { id: 'speedUp', keys: ['Shift', '.'], group: 'playback' },
  { id: 'mute', keys: ['M'], group: 'playback' },
  { id: 'skipBackward', keys: ['J', '←'], group: 'navigation' },
  { id: 'skipForward', keys: ['L', '→'], group: 'navigation' },
  { id: 'volumeUp', keys: ['↑'], group: 'navigation' },
  { id: 'volumeDown', keys: ['↓'], group: 'navigation' },
  { id: 'next', keys: ['N'], group: 'navigation' },
  { id: 'previous', keys: ['P'], group: 'navigation' },
  { id: 'bookmark', keys: ['B'], group: 'tools' },
  { id: 'help', keys: ['?'], group: 'tools' },
]

const open = ref(false)
const bookmarkComposerRequest = ref(0)

export function usePodcastShortcuts() {
  function openShortcuts(): void {
    open.value = true
  }

  function closeShortcuts(): void {
    open.value = false
  }

  function toggleShortcuts(): void {
    open.value = !open.value
  }

  function requestBookmarkComposer(): void {
    bookmarkComposerRequest.value++
  }

  return {
    open: readonly(open),
    bookmarkComposerRequest: readonly(bookmarkComposerRequest),
    openShortcuts,
    closeShortcuts,
    toggleShortcuts,
    requestBookmarkComposer,
  }
}
