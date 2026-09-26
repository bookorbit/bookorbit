import type { TtsCurrentBook } from '../lib/tts-state'
import { createCoverFillArtworkUrl } from '@/features/book/lib/cover-fill-artwork'

export function useTtsMediaSession() {
  let artworkUrl: string | null = null
  let metadataRevision = 0

  function releaseArtwork() {
    metadataRevision++
    if (!artworkUrl) return
    URL.revokeObjectURL(artworkUrl)
    artworkUrl = null
  }

  function setMetadata(book: TtsCurrentBook) {
    if (!('mediaSession' in navigator)) return
    releaseArtwork()
    const revision = metadataRevision
    const metadata = (artwork: MediaImage[] = []) =>
      new MediaMetadata({
        title: book.title,
        artist: book.author ?? '',
        album: 'BookOrbit',
        artwork,
      })

    navigator.mediaSession.metadata = metadata()
    if (!book.coverUrl) return

    void createCoverFillArtworkUrl(book.coverUrl).then((nextArtworkUrl) => {
      if (!nextArtworkUrl) return
      if (revision !== metadataRevision) {
        URL.revokeObjectURL(nextArtworkUrl)
        return
      }
      artworkUrl = nextArtworkUrl
      navigator.mediaSession.metadata = metadata([{ src: nextArtworkUrl, sizes: '512x512', type: 'image/jpeg' }])
    })
  }

  function setPlaybackState(state: 'playing' | 'paused' | 'none') {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = state
  }

  function registerHandlers(handlers: { play: () => void; pause: () => void; previoustrack: () => void; nexttrack: () => void; stop: () => void }) {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.setActionHandler('play', handlers.play)
    navigator.mediaSession.setActionHandler('pause', handlers.pause)
    navigator.mediaSession.setActionHandler('previoustrack', handlers.previoustrack)
    navigator.mediaSession.setActionHandler('nexttrack', handlers.nexttrack)
    navigator.mediaSession.setActionHandler('stop', handlers.stop)
  }

  function clearHandlers() {
    if (!('mediaSession' in navigator)) return
    releaseArtwork()
    navigator.mediaSession.setActionHandler('play', null)
    navigator.mediaSession.setActionHandler('pause', null)
    navigator.mediaSession.setActionHandler('previoustrack', null)
    navigator.mediaSession.setActionHandler('nexttrack', null)
    navigator.mediaSession.setActionHandler('stop', null)
  }

  return {
    setMetadata,
    setPlaybackState,
    registerHandlers,
    clearHandlers,
  }
}
