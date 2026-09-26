import type { EpubMediaOverlayPlaylist, EpubMediaOverlayPlaylistItem } from '@bookorbit/types'

export type MediaOverlayResumePosition = {
  section: number
  fragment: string
}

export type MediaOverlayResumeState = {
  fragment: string | null
  sectionIndex: number | null
  positionSeconds: number | null
}

export function mediaOverlayItemFragment(item: EpubMediaOverlayPlaylistItem): string | null {
  if (!item.textHref) return null
  return item.textFragment ? `${item.textHref}#${item.textFragment}` : item.textHref
}

function sameFragment(a: string, b: string): boolean {
  if (a === b) return true
  const [aPath, aFragment] = a.split('#')
  const [bPath, bFragment] = b.split('#')
  if (aPath && bPath && aPath !== bPath) return false
  return !!aFragment && !!bFragment && aFragment === bFragment
}

function resolveByFragment(playlist: EpubMediaOverlayPlaylist, fragment: string): MediaOverlayResumePosition | null {
  for (const item of playlist.items) {
    const itemFragment = mediaOverlayItemFragment(item)
    if (itemFragment && sameFragment(itemFragment, fragment)) {
      return { section: item.sectionIndex, fragment: itemFragment }
    }
  }
  return null
}

function resolveBySeconds(playlist: EpubMediaOverlayPlaylist, positionSeconds: number): MediaOverlayResumePosition | null {
  if (!Number.isFinite(positionSeconds) || positionSeconds < 0) return null

  let elapsed = 0
  let lastKnown: MediaOverlayResumePosition | null = null

  for (const item of playlist.items) {
    const fragment = mediaOverlayItemFragment(item)
    const current = fragment ? { section: item.sectionIndex, fragment } : null
    const duration = item.durationSeconds
    const start = elapsed
    const end = duration != null && Number.isFinite(duration) && duration > 0 ? start + duration : null

    if (current && positionSeconds <= start) return current
    if (current && (end == null ? positionSeconds >= start : positionSeconds < end)) return current

    if (current) lastKnown = current
    if (end == null) break
    elapsed = end
  }

  return lastKnown
}

export function resolveMediaOverlayResume(playlist: EpubMediaOverlayPlaylist, state: MediaOverlayResumeState): MediaOverlayResumePosition | null {
  if (state.fragment && state.sectionIndex != null) {
    return { section: state.sectionIndex, fragment: state.fragment }
  }

  if (state.fragment) {
    const fromFragment = resolveByFragment(playlist, state.fragment)
    if (fromFragment) return fromFragment
  }

  if (state.positionSeconds != null && state.positionSeconds > 0) {
    return resolveBySeconds(playlist, state.positionSeconds)
  }

  return null
}
