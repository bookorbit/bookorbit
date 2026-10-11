import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { MetadataCacheConfig, MetadataCacheConfigResponse, MetadataCacheProviderInfo } from '@bookorbit/types'
import { api } from '@/lib/api'
import {
  buildCacheConfig,
  cacheSettingsSnapshot,
  hasCacheSettingsErrors,
  providerOverrideKey,
  resetProviderOverride,
  toCacheSettingsDraft,
  validateCacheSettings,
  type CacheSettingsDraft,
  type DurationDraft,
  type ProviderOverrideDraft,
} from '../lib/cache-settings'

const CONFIG_URL = '/api/v1/metadata-cache/config'

type GlobalDurationField = 'resultsTtl' | 'emptyTtl' | 'staleGrace'

/** The admin form for the metadata search cache: load, edit, validate and save its config. */
export function useMetadataCacheSettings() {
  const { t } = useI18n()

  const providers = shallowRef<MetadataCacheProviderInfo[]>([])
  const saved = shallowRef<MetadataCacheConfig | null>(null)
  const draft = ref<CacheSettingsDraft | null>(null)
  const pristine = ref('')
  const loading = ref(false)
  const loadFailed = ref(false)
  const saving = ref(false)

  const errors = computed(() => (draft.value ? validateCacheSettings(draft.value, providers.value) : null))
  const isValid = computed(() => !!errors.value && !hasCacheSettingsErrors(errors.value))
  const isDirty = computed(() => !!draft.value && cacheSettingsSnapshot(draft.value, providers.value) !== pristine.value)
  const canSave = computed(() => isDirty.value && isValid.value && !saving.value)

  function apply(response: MetadataCacheConfigResponse) {
    providers.value = response.providers
    saved.value = response.config
    draft.value = toCacheSettingsDraft(response.config, response.providers)
    pristine.value = cacheSettingsSnapshot(draft.value, response.providers)
  }

  async function load(): Promise<boolean> {
    loading.value = true
    loadFailed.value = false
    try {
      const res = await api(CONFIG_URL)
      if (!res.ok) {
        loadFailed.value = true
        return false
      }
      apply((await res.json()) as MetadataCacheConfigResponse)
      return true
    } catch {
      loadFailed.value = true
      return false
    } finally {
      loading.value = false
    }
  }

  async function save(): Promise<boolean> {
    if (!draft.value || !canSave.value) return false
    const config = buildCacheConfig(draft.value, providers.value)
    if (!config) return false
    saving.value = true
    try {
      const res = await api(CONFIG_URL, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      })
      if (!res.ok) {
        toast.error(t('settings.metadata.searchCache.saveFailed'))
        return false
      }
      apply((await res.json()) as MetadataCacheConfigResponse)
      toast.success(t('settings.metadata.searchCache.saved'))
      return true
    } catch {
      toast.error(t('settings.metadata.searchCache.saveFailed'))
      return false
    } finally {
      saving.value = false
    }
  }

  function discard() {
    if (!saved.value) return
    draft.value = toCacheSettingsDraft(saved.value, providers.value)
  }

  function setEnabled(enabled: boolean) {
    if (draft.value) draft.value = { ...draft.value, enabled }
  }

  function setDuration(field: GlobalDurationField, value: DurationDraft) {
    if (draft.value) draft.value = { ...draft.value, [field]: value }
  }

  function setMaxStorageMb(value: number | null) {
    if (draft.value) draft.value = { ...draft.value, maxStorageMb: value }
  }

  function setOverride(next: ProviderOverrideDraft) {
    if (!draft.value) return
    draft.value = { ...draft.value, overrides: { ...draft.value.overrides, [providerOverrideKey(next)]: next } }
  }

  function resetOverride(key: string) {
    const current = draft.value?.overrides[key]
    if (!draft.value || !current) return
    setOverride(resetProviderOverride(current, { resultsUnit: draft.value.resultsTtl.unit, emptyUnit: draft.value.emptyTtl.unit }))
  }

  return {
    providers,
    draft,
    errors,
    loading,
    loadFailed,
    saving,
    isValid,
    isDirty,
    canSave,
    load,
    save,
    discard,
    setEnabled,
    setDuration,
    setMaxStorageMb,
    setOverride,
    resetOverride,
  }
}
