import { computed, ref } from 'vue'
import {
  PODCAST_EPISODE_LOCKED_FIELDS,
  type PodcastEpisodeLockedField,
  type PodcastEpisodeMetadataUpdateRequest,
  type PodcastEpisodeSummary,
  type PodcastEpisodeType,
} from '@bookorbit/types'
import { createLockedMetadataForm } from './createLockedMetadataForm'

/**
 * The lockable fields the sheet renders a control for. `chapters` is lockable and writable through
 * the API but has no editor yet, so it never takes part in the form diff.
 */
export const PODCAST_EPISODE_FORM_FIELDS = [
  'title',
  'subtitle',
  'description',
  'publishedAt',
  'season',
  'episode',
  'episodeType',
  'durationSeconds',
  'explicit',
] as const

export type PodcastEpisodeFormField = (typeof PODCAST_EPISODE_FORM_FIELDS)[number]

export type PodcastEpisodeMetadataForm = {
  title: string
  subtitle: string
  description: string
  /** `datetime-local` value in the viewer's zone; converted back to an instant on save. */
  publishedAt: string
  season: string
  episode: string
  episodeType: string
  /** Minutes, the unit a listener thinks in; the API stores seconds. */
  durationMinutes: string
  explicit: boolean
}

function emptyForm(): PodcastEpisodeMetadataForm {
  return {
    title: '',
    subtitle: '',
    description: '',
    publishedAt: '',
    season: '',
    episode: '',
    episodeType: '',
    durationMinutes: '',
    explicit: false,
  }
}

/**
 * Edits episode metadata as a sparse diff against the loaded episode. Saving locks every changed
 * field, so the preview a field shows while it is dirty matches what the server stores.
 */
export function usePodcastEpisodeMetadataEditor() {
  /** A feed value outside the iTunes set, kept as an option so leaving it alone is not an edit. */
  const foreignEpisodeType = ref<string | null>(null)

  const editor = createLockedMetadataForm<
    PodcastEpisodeMetadataForm,
    PodcastEpisodeFormField,
    PodcastEpisodeLockedField,
    PodcastEpisodeSummary,
    PodcastEpisodeMetadataUpdateRequest
  >({
    emptyForm,
    fields: PODCAST_EPISODE_FORM_FIELDS,
    // `lockedFields` is guaranteed by the contract, but it is a recent addition to the episode
    // payload: a server that has not been restarted yet omits it, and losing the lock toggles is a
    // better failure than the whole editor refusing to open.
    lockable: PODCAST_EPISODE_LOCKED_FIELDS,
    apply(form, episode) {
      form.title = episode.title
      form.subtitle = episode.subtitle ?? ''
      form.description = episode.description ?? ''
      form.publishedAt = toLocalDateTimeInput(episode.publishedAt)
      form.season = episode.season ?? ''
      form.episode = episode.episode ?? ''
      form.episodeType = episode.episodeType ?? ''
      form.durationMinutes = episode.durationSeconds === null ? '' : String(round(episode.durationSeconds / 60))
      form.explicit = episode.explicit
      foreignEpisodeType.value = isKnownEpisodeType(episode.episodeType) ? null : (episode.episodeType ?? null)
    },
    normalize(field, form) {
      if (field === 'explicit') return form.explicit
      if (field === 'durationSeconds') return String(toDurationSeconds(form.durationMinutes))
      if (field === 'publishedAt') return String(fromLocalDateTimeInput(form.publishedAt))
      return form[field].trim()
    },
    toPayload(field, form) {
      if (field === 'title') return form.title.trim()
      if (field === 'explicit') return form.explicit
      if (field === 'publishedAt') return fromLocalDateTimeInput(form.publishedAt)
      if (field === 'durationSeconds') return toDurationSeconds(form.durationMinutes)
      if (field === 'episodeType') return isKnownEpisodeType(form.episodeType) ? form.episodeType : null
      return form[field].trim() || null
    },
    endpoint: (episodeId) => `/api/v1/podcast-episodes/${episodeId}/metadata`,
    fallbackKey: 'podcast.errors.updateEpisode',
  })

  const durationInvalid = computed(() => {
    const minutes = editor.form.durationMinutes.trim()
    if (!minutes) return false
    const parsed = Number(minutes)
    return !Number.isFinite(parsed) || parsed <= 0
  })

  return { ...editor, foreignEpisodeType, durationInvalid }
}

function isKnownEpisodeType(value: string | null): value is PodcastEpisodeType {
  return value === 'full' || value === 'trailer' || value === 'bonus'
}

/** Seconds are rounded to whole minutes on the way out, matching what the form lets a user express. */
function toDurationSeconds(minutes: string): number | null {
  const value = minutes.trim()
  if (!value) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return round(parsed * 60)
}

function toLocalDateTimeInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function fromLocalDateTimeInput(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
