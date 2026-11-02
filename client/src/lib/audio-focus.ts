/**
 * Single-audible-source policy for the players that can produce sound at once: the two that share
 * the bottom edge and the chapter editor's preview. Deliberately unreactive: owners register an
 * imperative pause callback and the player that is about to produce sound claims focus, pausing
 * everyone else.
 */
export type AudioFocusOwner = 'tts' | 'media-overlay' | 'chapter-preview'

const owners = new Map<AudioFocusOwner, () => void>()

export function registerAudioFocusOwner(owner: AudioFocusOwner, pause: () => void): void {
  owners.set(owner, pause)
}

export function releaseAudioFocusOwner(owner: AudioFocusOwner): void {
  owners.delete(owner)
}

export function requestAudioFocus(owner: AudioFocusOwner): void {
  for (const [candidate, pause] of owners) {
    if (candidate === owner) continue
    pause()
  }
}
