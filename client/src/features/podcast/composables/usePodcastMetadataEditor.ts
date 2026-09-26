import {
  PODCAST_EDITABLE_FIELDS,
  PODCAST_LOCKED_FIELDS,
  PODCAST_MAX_CATEGORIES,
  type PodcastEditableField,
  type PodcastLockedField,
  type PodcastMetadataUpdateRequest,
  type PodcastMetadataUpdateResult,
} from '@bookorbit/types'
import { createLockedMetadataForm } from './createLockedMetadataForm'

export type PodcastMetadataForm = {
  title: string
  author: string
  description: string
  siteUrl: string
  language: string
  explicit: boolean
  categories: string[]
}

function emptyForm(): PodcastMetadataForm {
  return { title: '', author: '', description: '', siteUrl: '', language: '', explicit: false, categories: [] }
}

/**
 * Edits show metadata as a sparse diff against the loaded show. Saving locks every changed field,
 * so the preview a field shows while it is dirty matches what the server stores.
 */
export function usePodcastMetadataEditor() {
  const editor = createLockedMetadataForm<
    PodcastMetadataForm,
    PodcastEditableField,
    PodcastLockedField,
    PodcastMetadataUpdateResult,
    PodcastMetadataUpdateRequest
  >({
    emptyForm,
    fields: PODCAST_EDITABLE_FIELDS,
    lockable: PODCAST_LOCKED_FIELDS,
    apply(form, show) {
      form.title = show.title
      form.author = show.author ?? ''
      form.description = show.description ?? ''
      form.siteUrl = show.siteUrl ?? ''
      form.language = show.language ?? ''
      form.explicit = show.explicit
      form.categories = [...show.categories]
    },
    normalize(field, form) {
      if (field === 'categories') return form.categories.map((category) => category.trim()).filter(Boolean)
      if (field === 'explicit') return form.explicit
      return form[field].trim()
    },
    toPayload(field, form) {
      if (field === 'title') return form.title.trim()
      if (field === 'explicit') return form.explicit
      if (field === 'categories') return form.categories.map((category) => category.trim()).filter(Boolean)
      return form[field].trim() || null
    },
    endpoint: (podcastId) => `/api/v1/podcasts/${podcastId}/metadata`,
    fallbackKey: 'podcast.errors.updatePodcast',
  })

  const form = editor.form

  function addCategory(value: string): boolean {
    const category = value.trim()
    if (!category || form.categories.length >= PODCAST_MAX_CATEGORIES) return false
    if (form.categories.some((existing) => existing.toLowerCase() === category.toLowerCase())) return false
    form.categories = [...form.categories, category]
    return true
  }

  function removeCategory(value: string) {
    form.categories = form.categories.filter((category) => category !== value)
  }

  return { ...editor, addCategory, removeCategory }
}
