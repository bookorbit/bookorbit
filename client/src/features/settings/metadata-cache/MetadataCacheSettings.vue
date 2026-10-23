<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Permission } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import CacheClearCard from './components/CacheClearCard.vue'
import CacheDurationRow from './components/CacheDurationRow.vue'
import CacheProviderOverrides from './components/CacheProviderOverrides.vue'
import CacheSettingsSaveBar from './components/CacheSettingsSaveBar.vue'
import CacheStatsCard from './components/CacheStatsCard.vue'
import { useMetadataCacheMaintenance, type CacheClearScope } from './composables/useMetadataCacheMaintenance'
import { useMetadataCacheSettings } from './composables/useMetadataCacheSettings'
import { durationErrorMessage, storageErrorMessage } from './lib/cache-settings-format'
import type { DurationDraft, ProviderOverrideDraft } from './lib/cache-settings'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const canManage = computed(() => hasPermission(Permission.ManageMetadataConfig))

const settings = useMetadataCacheSettings()
const { draft, errors, providers, loading, loadFailed, saving, isDirty, isValid } = settings
const maintenance = useMetadataCacheMaintenance()
const { stats, statsLoading, statsFailed, clearing } = maintenance

const enabledId = useId()
const storageId = useId()
const pendingClear = ref<CacheClearScope | null>(null)

const resultsTtlError = computed(() => durationErrorMessage(t, errors.value?.resultsTtl))
const emptyTtlError = computed(() => durationErrorMessage(t, errors.value?.emptyTtl))
const staleGraceError = computed(() => durationErrorMessage(t, errors.value?.staleGrace))
const storageError = computed(() => storageErrorMessage(t, errors.value?.maxStorageMb))
const storageDescribedBy = computed(() => (storageError.value ? `${storageId}-hint ${storageId}-error` : `${storageId}-hint`))
const inherited = computed(() => ({
  resultsTtl: draft.value?.resultsTtl ?? { amount: null, unit: 'days' as const },
  emptyTtl: draft.value?.emptyTtl ?? { amount: null, unit: 'days' as const },
}))
const CLEAR_CONFIRM_KEYS: Record<CacheClearScope, { title: string; description: string }> = {
  all: {
    title: 'settings.metadata.searchCache.clear.all.confirmTitle',
    description: 'settings.metadata.searchCache.clear.all.confirmDescription',
  },
  book: {
    title: 'settings.metadata.searchCache.clear.book.confirmTitle',
    description: 'settings.metadata.searchCache.clear.book.confirmDescription',
  },
  author: {
    title: 'settings.metadata.searchCache.clear.author.confirmTitle',
    description: 'settings.metadata.searchCache.clear.author.confirmDescription',
  },
  empty: {
    title: 'settings.metadata.searchCache.clear.empty.confirmTitle',
    description: 'settings.metadata.searchCache.clear.empty.confirmDescription',
  },
}
const confirmCopy = computed(() => {
  const keys = CLEAR_CONFIRM_KEYS[pendingClear.value ?? 'all']
  return { title: t(keys.title), description: t(keys.description) }
})

onMounted(() => {
  if (!canManage.value) return
  void settings.load()
  void maintenance.loadStats()
})

function handleRetryLoad() {
  void settings.load()
}

function handleEnabledChange(value: boolean) {
  settings.setEnabled(value)
}

function handleResultsTtlChange(value: DurationDraft) {
  settings.setDuration('resultsTtl', value)
}

function handleEmptyTtlChange(value: DurationDraft) {
  settings.setDuration('emptyTtl', value)
}

function handleStaleGraceChange(value: DurationDraft) {
  settings.setDuration('staleGrace', value)
}

function handleStorageInput(event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim()
  const value = raw === '' ? null : Number(raw)
  settings.setMaxStorageMb(value === null || Number.isFinite(value) ? value : null)
}

function handleOverrideUpdate(next: ProviderOverrideDraft) {
  settings.setOverride(next)
}

function handleOverrideReset(key: string) {
  settings.resetOverride(key)
}

async function handleSave() {
  // The stats card shows the storage budget, so it reloads once a new one is saved.
  if (await settings.save()) void maintenance.loadStats()
}

function handleDiscard() {
  settings.discard()
}

function handleRefreshStats() {
  void maintenance.loadStats()
}

function handleClearRequest(scope: CacheClearScope) {
  pendingClear.value = scope
}

function handleClearCancel() {
  if (clearing.value) return
  pendingClear.value = null
}

async function handleClearConfirm() {
  const scope = pendingClear.value
  if (!scope) return
  await maintenance.clear(scope)
  pendingClear.value = null
}
</script>

<template>
  <p v-if="!canManage" class="settings-error-state" role="alert">{{ t('settings.metadata.noPermission') }}</p>

  <div v-else class="flex flex-col gap-8">
    <div v-if="loading && !draft" class="settings-loading-state">{{ t('common.loading') }}</div>

    <div v-else-if="loadFailed && !draft" class="settings-error-state flex flex-wrap items-center justify-between gap-3" role="alert">
      <span>{{ t('settings.metadata.searchCache.loadFailed') }}</span>
      <Button variant="outline" size="sm" type="button" @click="handleRetryLoad">{{ t('settings.metadata.searchCache.retry') }}</Button>
    </div>

    <div v-else-if="draft" class="flex flex-col gap-6">
      <section aria-labelledby="metadata-cache-general-title">
        <h3 id="metadata-cache-general-title" class="settings-group-label">{{ t('settings.metadata.searchCache.general.title') }}</h3>
        <div class="settings-card">
          <div class="settings-row">
            <div class="min-w-0 settings-prose">
              <label :for="enabledId" class="settings-label block">{{ t('settings.metadata.searchCache.general.enabled') }}</label>
              <p :id="`${enabledId}-hint`" class="settings-hint">{{ t('settings.metadata.searchCache.general.enabledHint') }}</p>
            </div>
            <ToggleSwitch
              :id="enabledId"
              class="self-start md:self-auto"
              :model-value="draft.enabled"
              :aria-describedby="`${enabledId}-hint`"
              data-testid="metadata-cache-enabled"
              @update:model-value="handleEnabledChange"
            />
          </div>

          <CacheDurationRow
            :label="t('settings.metadata.searchCache.general.resultsTtl')"
            :hint="t('settings.metadata.searchCache.general.resultsTtlHint')"
            :unit-label="t('settings.metadata.searchCache.general.resultsTtlUnit')"
            :model-value="draft.resultsTtl"
            :error="resultsTtlError"
            data-testid="metadata-cache-results-ttl"
            @update:model-value="handleResultsTtlChange"
          />
          <CacheDurationRow
            :label="t('settings.metadata.searchCache.general.emptyTtl')"
            :hint="t('settings.metadata.searchCache.general.emptyTtlHint')"
            :unit-label="t('settings.metadata.searchCache.general.emptyTtlUnit')"
            :model-value="draft.emptyTtl"
            :error="emptyTtlError"
            data-testid="metadata-cache-empty-ttl"
            @update:model-value="handleEmptyTtlChange"
          />
          <CacheDurationRow
            :label="t('settings.metadata.searchCache.general.staleGrace')"
            :hint="t('settings.metadata.searchCache.general.staleGraceHint')"
            :unit-label="t('settings.metadata.searchCache.general.staleGraceUnit')"
            :model-value="draft.staleGrace"
            :error="staleGraceError"
            data-testid="metadata-cache-stale-grace"
            @update:model-value="handleStaleGraceChange"
          />

          <div class="settings-row">
            <div class="min-w-0 settings-prose">
              <label :for="storageId" class="settings-label block">{{ t('settings.metadata.searchCache.general.storage') }}</label>
              <p :id="`${storageId}-hint`" class="settings-hint">{{ t('settings.metadata.searchCache.general.storageHint') }}</p>
            </div>
            <div class="flex shrink-0 flex-col gap-1 md:items-end">
              <div class="flex items-center gap-2">
                <input
                  :id="storageId"
                  type="number"
                  inputmode="numeric"
                  min="0"
                  step="1"
                  class="settings-control w-28 tabular-nums"
                  :value="draft.maxStorageMb ?? ''"
                  :aria-invalid="storageError ? 'true' : undefined"
                  :aria-describedby="storageDescribedBy"
                  data-testid="metadata-cache-storage"
                  @input="handleStorageInput"
                />
                <span class="text-sm text-muted-foreground" aria-hidden="true">{{ t('settings.metadata.searchCache.general.storageUnit') }}</span>
              </div>
              <p v-if="storageError" :id="`${storageId}-error`" role="alert" class="text-xs text-destructive">{{ storageError }}</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="metadata-cache-providers-title">
        <h3 id="metadata-cache-providers-title" class="settings-group-label mb-0">{{ t('settings.metadata.searchCache.providers.title') }}</h3>
        <p class="settings-hint mb-3">{{ t('settings.metadata.searchCache.providers.hint') }}</p>
        <CacheProviderOverrides
          :providers="providers"
          :overrides="draft.overrides"
          :errors="errors?.overrides ?? {}"
          :inherited="inherited"
          :global-enabled="draft.enabled"
          @update="handleOverrideUpdate"
          @reset="handleOverrideReset"
        />
        <p v-if="errors?.tooManyOverrides" role="alert" class="mt-2 text-xs text-destructive">
          {{ t('settings.metadata.searchCache.validation.tooManyOverrides') }}
        </p>
      </section>

      <CacheSettingsSaveBar :dirty="isDirty" :invalid="!isValid" :saving="saving" @save="handleSave" @discard="handleDiscard" />
    </div>

    <section aria-labelledby="metadata-cache-usage-title" class="flex flex-col gap-2">
      <h3 id="metadata-cache-usage-title" class="settings-group-label mb-0">{{ t('settings.metadata.searchCache.stats.group') }}</h3>
      <CacheStatsCard :stats="stats" :providers="providers" :loading="statsLoading" :failed="statsFailed" @refresh="handleRefreshStats" />
    </section>

    <section aria-labelledby="metadata-cache-maintenance-title" class="flex flex-col gap-2">
      <h3 id="metadata-cache-maintenance-title" class="settings-group-label mb-0">{{ t('settings.metadata.searchCache.clear.group') }}</h3>
      <p class="settings-hint">{{ t('settings.metadata.searchCache.clear.regionHint') }}</p>
      <CacheClearCard :clearing="clearing" @request="handleClearRequest" />
    </section>

    <ConfirmDialog
      :open="pendingClear !== null"
      :title="confirmCopy.title"
      :description="confirmCopy.description"
      :confirm-label="t('settings.metadata.searchCache.clear.action')"
      :busy="clearing !== null"
      @confirm="handleClearConfirm"
      @cancel="handleClearCancel"
    />
  </div>
</template>
