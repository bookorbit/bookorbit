import type { PodcastEpisodeSummary, PodcastPlaybackPreferences } from '@bookorbit/types'
import { apiJson } from '@/lib/api-json'
import { cyclePlaybackRate, isPlaybackRateInRange, stepPlaybackRate } from '../lib/podcast-playback-rates'
import type { createPodcastPlayerState } from './podcast-player-state'
import type { createPodcastPlayerPersistence } from './podcast-player-persistence'

type PodcastPlayerState = ReturnType<typeof createPodcastPlayerState>
type PodcastPlayerPersistence = ReturnType<typeof createPodcastPlayerPersistence>

/** One entry per show, so the map is bounded even for a library with a rate set on everything. */
const MAX_PER_SHOW_RATES = 1000

export interface PodcastPlayerPreferenceDeps {
  state: PodcastPlayerState
  persistence: PodcastPlayerPersistence
  defaults: PodcastPlaybackPreferences
  engine: { setRate: (rate: number) => void; setVolume: (volume: number) => void }
  onPositionStateChanged: () => void
}

/**
 * Rate and volume: the two settings that are both live playback controls and stored preferences.
 * The per-show rate override is an LRU because a user who sets one show to 1.5x expects it to stick,
 * while a map that grows with the library would eventually be too large to write back.
 */
export function createPodcastPlayerPreferences(deps: PodcastPlayerPreferenceDeps) {
  const { state, persistence, defaults, engine } = deps
  const { playbackRate, volume, defaultPlaybackRate, skipBackwardSeconds, skipForwardSeconds, podcastPlaybackRates, preferencesLoaded, episode } =
    state
  let volumeBeforeMute: number | null = null

  function setPlaybackRate(rate: number, persist = true): void {
    const next = Number(rate)
    if (!isPlaybackRateInRange(next)) return
    playbackRate.value = next
    engine.setRate(next)
    deps.onPositionStateChanged()
    if (!persist) return
    const activePodcastId = episode.value?.podcastId
    if (activePodcastId) {
      const key = String(activePodcastId)
      const rates = { ...podcastPlaybackRates.value }
      if (!(key in rates) && Object.keys(rates).length >= MAX_PER_SHOW_RATES) delete rates[Object.keys(rates)[0]!]
      rates[key] = next
      podcastPlaybackRates.value = rates
    } else {
      defaultPlaybackRate.value = next
    }
    persistPreferences()
  }

  function cycleRate(): void {
    setPlaybackRate(cyclePlaybackRate(playbackRate.value))
  }

  function stepRate(direction: -1 | 1): void {
    const nextRate = stepPlaybackRate(playbackRate.value, direction)
    if (nextRate !== undefined) setPlaybackRate(nextRate)
  }

  function clearPlaybackRateOverride(): void {
    const podcastId = episode.value?.podcastId
    if (!podcastId) return
    const rates = { ...podcastPlaybackRates.value }
    delete rates[String(podcastId)]
    podcastPlaybackRates.value = rates
    setPlaybackRate(defaultPlaybackRate.value, false)
    persistPreferences()
  }

  function setVolume(value: number, persist = true): void {
    const next = Math.max(0, Math.min(1, Number(value)))
    if (!Number.isFinite(next)) return
    volume.value = next
    engine.setVolume(next)
    if (persist) persistPreferences()
  }

  /** Muting is a session state, so neither silence nor the restored level is written back as the stored preference. */
  function toggleMute(): void {
    if (volume.value > 0) {
      volumeBeforeMute = volume.value
      setVolume(0, false)
      return
    }
    const restored = volumeBeforeMute && volumeBeforeMute > 0 ? volumeBeforeMute : defaults.volume
    volumeBeforeMute = null
    setVolume(restored, false)
  }

  function applyEpisodePlaybackRate(activeEpisode: PodcastEpisodeSummary): void {
    setPlaybackRate(podcastPlaybackRates.value[String(activeEpisode.podcastId)] ?? defaultPlaybackRate.value, false)
  }

  async function loadPreferences(): Promise<void> {
    if (preferencesLoaded.value) return
    const activeGeneration = persistence.preferenceLoadGeneration()
    const body = await apiJson<{ settings: PodcastPlaybackPreferences }>(
      '/api/v1/user-preferences/podcast-playback',
      undefined,
      'podcast.errors.loadPlaybackSettings',
    ).catch(() => null)
    if (!body || !persistence.isPreferenceGenerationCurrent(activeGeneration)) return
    const settings = body.settings
    setVolume(settings.volume ?? defaults.volume, false)
    if (Number.isFinite(settings.defaultPlaybackRate)) {
      defaultPlaybackRate.value = settings.defaultPlaybackRate
      setPlaybackRate(settings.defaultPlaybackRate, false)
    }
    if (Number.isInteger(settings.skipBackwardSeconds)) skipBackwardSeconds.value = settings.skipBackwardSeconds
    if (Number.isInteger(settings.skipForwardSeconds)) skipForwardSeconds.value = settings.skipForwardSeconds
    podcastPlaybackRates.value = settings.podcastPlaybackRates ?? {}
    if (episode.value) applyEpisodePlaybackRate(episode.value)
    preferencesLoaded.value = true
  }

  function resetPreferences(): void {
    persistence.invalidatePreferenceWrites()
    preferencesLoaded.value = false
    volumeBeforeMute = null
    defaultPlaybackRate.value = defaults.defaultPlaybackRate
    volume.value = defaults.volume
    playbackRate.value = defaults.defaultPlaybackRate
    skipBackwardSeconds.value = defaults.skipBackwardSeconds
    skipForwardSeconds.value = defaults.skipForwardSeconds
    podcastPlaybackRates.value = {}
    engine.setRate(defaults.defaultPlaybackRate)
    engine.setVolume(defaults.volume)
  }

  function persistPreferences(): void {
    persistence.queuePreferenceWrite({
      defaultPlaybackRate: defaultPlaybackRate.value,
      // While muted the live level is 0, which is session state. Writing it would let any unrelated
      // preference change - a speed pick, a skip-length edit - overwrite the stored volume with
      // silence, so the player comes back mute on the next load with the chosen level gone.
      volume: volumeBeforeMute ?? volume.value,
      skipBackwardSeconds: skipBackwardSeconds.value,
      skipForwardSeconds: skipForwardSeconds.value,
      podcastPlaybackRates: { ...podcastPlaybackRates.value },
    })
  }

  return {
    setPlaybackRate,
    cycleRate,
    stepRate,
    clearPlaybackRateOverride,
    setVolume,
    toggleMute,
    applyEpisodePlaybackRate,
    loadPreferences,
    resetPreferences,
  }
}
