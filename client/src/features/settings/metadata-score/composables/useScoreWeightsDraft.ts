import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import {
  DEFAULT_METADATA_SCORE_WEIGHTS,
  totalMetadataScoreWeight,
  type MetadataScoreField,
  type MetadataScoreGroup,
  type MetadataScoreWeights,
} from '@bookorbit/types'
import { api } from '@/lib/api'
import { useMetadataScoreWeights } from '@/features/metadata-score/composables/useMetadataScoreWeights'
import { changedFields, fieldsInGroup, normalizeWeight, normalizeWeights, scoringFieldCount } from '../lib/score-weights'

/**
 * Restoring a switched-off group needs the weight it had before, otherwise turning provider IDs
 * back on silently loses whatever they were tuned to.
 */
type GroupMemory = Partial<Record<MetadataScoreGroup, Partial<Record<MetadataScoreField, number>>>>

export function useScoreWeightsDraft() {
  const { t } = useI18n()
  const { resetFetchCache } = useMetadataScoreWeights()

  const saved = ref<MetadataScoreWeights>(normalizeWeights(DEFAULT_METADATA_SCORE_WEIGHTS))
  const draft = ref<MetadataScoreWeights>(normalizeWeights(DEFAULT_METADATA_SCORE_WEIGHTS))
  const loading = ref(true)
  const saving = ref(false)
  const loadFailed = ref(false)
  const groupMemory: GroupMemory = {}

  const changed = computed(() => changedFields(draft.value, saved.value))
  const isDirty = computed(() => changed.value.length > 0)
  const total = computed(() => totalMetadataScoreWeight(draft.value))
  const savedTotal = computed(() => totalMetadataScoreWeight(saved.value))
  const scoringCount = computed(() => scoringFieldCount(draft.value))

  async function load() {
    loading.value = true
    loadFailed.value = false
    try {
      const res = await api('/api/v1/metadata-score/weights')
      if (!res.ok) {
        loadFailed.value = true
        return
      }
      const data: MetadataScoreWeights = await res.json()
      saved.value = normalizeWeights(data)
      draft.value = { ...saved.value }
    } catch {
      loadFailed.value = true
    } finally {
      loading.value = false
    }
  }

  function setWeight(field: MetadataScoreField, value: number) {
    draft.value = { ...draft.value, [field]: normalizeWeight(value) }
  }

  function adjustWeight(field: MetadataScoreField, delta: number) {
    setWeight(field, draft.value[field] + delta)
  }

  function resetField(field: MetadataScoreField) {
    setWeight(field, saved.value[field])
  }

  /**
   * Zeroing a group is the only way to express "do not count provider IDs at all", and it takes
   * eight clicks one field at a time.
   */
  function setGroupScoring(group: MetadataScoreGroup, scoring: boolean) {
    const fields = fieldsInGroup(group)
    const next = { ...draft.value }
    if (scoring) {
      const remembered = groupMemory[group] ?? {}
      for (const field of fields) {
        next[field] = normalizeWeight(remembered[field] ?? DEFAULT_METADATA_SCORE_WEIGHTS[field])
      }
    } else {
      groupMemory[group] = Object.fromEntries(fields.map((field) => [field, draft.value[field]]))
      for (const field of fields) next[field] = 0
    }
    draft.value = next
  }

  function resetGroup(group: MetadataScoreGroup) {
    const next = { ...draft.value }
    for (const field of fieldsInGroup(group)) next[field] = normalizeWeight(DEFAULT_METADATA_SCORE_WEIGHTS[field])
    draft.value = next
  }

  function resetToDefaults() {
    draft.value = normalizeWeights(DEFAULT_METADATA_SCORE_WEIGHTS)
  }

  function discard() {
    draft.value = { ...saved.value }
  }

  async function save(): Promise<boolean> {
    if (saving.value || !isDirty.value) return false
    saving.value = true
    try {
      const res = await api('/api/v1/metadata-score/weights', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft.value),
      })
      if (!res.ok) {
        toast.error(t('settings.admin.scoreWeights.saveFailed'))
        return false
      }
      saved.value = { ...draft.value }
      resetFetchCache()
      return true
    } catch {
      toast.error(t('settings.admin.scoreWeights.saveFailed'))
      return false
    } finally {
      saving.value = false
    }
  }

  return {
    saved,
    draft,
    loading,
    loadFailed,
    saving,
    changed,
    isDirty,
    total,
    savedTotal,
    scoringCount,
    load,
    setWeight,
    adjustWeight,
    resetField,
    setGroupScoring,
    resetGroup,
    resetToDefaults,
    discard,
    save,
  }
}
