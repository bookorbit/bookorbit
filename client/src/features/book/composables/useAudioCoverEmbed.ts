import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import type { AudioCoverEmbedResult } from '@bookorbit/types'
import { api } from '@/lib/api'
import { audioCoverEmbedMessageKey, audioCoverEmbedTone } from '../lib/audio-cover-embed'

/** Writes a book's audiobook cover into its read-along EPUBs, and says what came of it. */
export function useAudioCoverEmbed() {
  const { t } = useI18n()
  const embedding = ref(false)

  async function embed(bookId: number): Promise<AudioCoverEmbedResult | null> {
    if (embedding.value) return null
    embedding.value = true
    try {
      const res = await api(`/api/v1/books/${bookId}/embed-audio-cover`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = (await res.json()) as AudioCoverEmbedResult
      toast[audioCoverEmbedTone(result.code)](t(audioCoverEmbedMessageKey(result.code), { reason: result.reason ?? '' }))
      return result
    } catch {
      toast.error(t('book.audioCoverEmbed.requestFailed'))
      return null
    } finally {
      embedding.value = false
    }
  }

  return { embedding, embed }
}
