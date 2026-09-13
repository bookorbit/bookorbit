<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Info, Loader2, Lock } from '@lucide/vue'
import { Permission, type MetadataScoreField, type MetadataScoreGroup } from '@bookorbit/types'
import { toast } from 'vue-sonner'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useAuth } from '@/features/auth/composables/useAuth'
import ScoreCompositionBar from './components/ScoreCompositionBar.vue'
import ScoreWeightsToolbar from './components/ScoreWeightsToolbar.vue'
import ScoreWeightsLedger from './components/ScoreWeightsLedger.vue'
import ScoreThresholdRail from './components/ScoreThresholdRail.vue'
import ScoreRescoreProgress from './components/ScoreRescoreProgress.vue'
import ScoreWeightsSaveBar from './components/ScoreWeightsSaveBar.vue'
import { useScoreWeightsDraft } from './composables/useScoreWeightsDraft'
import { useRescoreStatus } from './composables/useRescoreStatus'
import { useScoreDistribution } from './composables/useScoreDistribution'

const { t } = useI18n()
const { hasPermission } = usePermissions()
const { isLoading: authLoading } = useAuth()
const draft = useScoreWeightsDraft()
const rescore = useRescoreStatus()
const distribution = useScoreDistribution()

const query = ref('')
const confirmingReset = ref(false)

/**
 * The nav shows this page to manage_metadata_config, but the server gates saving and rescoring with
 * manage_app_settings. Without it the ledger is readable and every control is inert, rather than
 * letting someone tune 24 fields and collect a 403.
 */
const canEdit = computed(() => hasPermission(Permission.ManageAppSettings))
const readOnly = computed(() => !canEdit.value)
// Permissions read as empty until the session resolves, so an admin would otherwise be told they
// lack a permission they have. Say nothing until the answer is real.
const showReadOnlyNotice = computed(() => readOnly.value && !authLoading.value)
const controlsDisabled = computed(() => readOnly.value || draft.saving.value)

const totalBooks = computed(() => distribution.total.value)

onMounted(() => {
  void draft.load()
  void distribution.load()
})

onBeforeRouteLeave(() => {
  if (!draft.isDirty.value || readOnly.value) return true
  return window.confirm(t('settings.admin.scoreWeights.save.leaveWarning'))
})

function onAdjust(field: MetadataScoreField, delta: number) {
  draft.adjustWeight(field, delta)
}

function onSet(field: MetadataScoreField, value: number) {
  draft.setWeight(field, value)
}

function onResetField(field: MetadataScoreField) {
  draft.resetField(field)
}

function onToggleGroup(group: MetadataScoreGroup, scoring: boolean) {
  draft.setGroupScoring(group, scoring)
}

function clearQuery() {
  query.value = ''
}

function requestResetDefaults() {
  confirmingReset.value = true
}

function cancelResetDefaults() {
  confirmingReset.value = false
}

function acceptResetDefaults() {
  draft.resetToDefaults()
  confirmingReset.value = false
}

async function onSave() {
  const saved = await draft.save()
  if (!saved) return
  toast.success(t('settings.admin.scoreWeights.savedRecalculating'))
  // The PATCH starts a rescore server-side; watch the status the server has always reported.
  rescore.watch()
  void distribution.load()
}

async function onRescore() {
  const started = await rescore.startRescore()
  toast[started ? 'success' : 'error'](t(started ? 'settings.admin.scoreWeights.recalcStarted' : 'settings.admin.scoreWeights.recalcFailed'))
}

function onDiscard() {
  draft.discard()
}

function onDismissProgress() {
  rescore.dismiss()
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-start gap-3 rounded-lg border border-primary/15 bg-primary/5 px-4 py-3 shadow-xs">
      <Info :size="16" class="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
      <p class="text-xs leading-relaxed text-muted-foreground">
        <span class="font-medium text-foreground">{{ t('settings.admin.scoreWeights.howItWorks.title') }}</span>
        {{ ' ' }}{{ t('settings.admin.scoreWeights.howItWorks.summary') }}
      </p>
    </div>

    <div v-if="showReadOnlyNotice" class="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <Lock :size="15" class="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <p class="text-xs leading-relaxed text-muted-foreground">{{ t('settings.admin.scoreWeights.readOnly') }}</p>
    </div>

    <div class="overflow-hidden rounded-lg border border-border bg-card shadow-xs">
      <template v-if="!draft.loading.value">
        <section class="border-b border-border px-4 py-3 md:px-6">
          <div class="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 class="settings-group-label !mb-0">{{ t('settings.admin.scoreWeights.compositionTitle') }}</h2>
            <p class="text-xs text-muted-foreground">{{ t('settings.admin.scoreWeights.compositionHint') }}</p>
          </div>
          <ScoreCompositionBar :weights="draft.draft.value" />
        </section>

        <ScoreWeightsToolbar
          v-model:query="query"
          :weights="draft.draft.value"
          :total="draft.total.value"
          :scoring-count="draft.scoringCount.value"
          :rescoring="rescore.isRunning.value || rescore.starting.value"
          :disabled="controlsDisabled"
          @toggle-group="onToggleGroup"
          @reset-defaults="requestResetDefaults"
          @rescore="onRescore"
        />

        <ScoreRescoreProgress
          v-if="rescore.showProgress.value && rescore.status.value"
          :status="rescore.status.value"
          :total-books="totalBooks"
          @dismiss="onDismissProgress"
        />

        <ScoreWeightsLedger
          :weights="draft.draft.value"
          :saved="draft.saved.value"
          :query="query"
          :disabled="controlsDisabled"
          @adjust="onAdjust"
          @set="onSet"
          @reset="onResetField"
          @clear-query="clearQuery"
        />

        <ScoreThresholdRail :distribution="distribution.distribution.value" :loading="distribution.loading.value" />

        <ScoreWeightsSaveBar
          :dirty="draft.isDirty.value"
          :changed-count="draft.changed.value.length"
          :total="draft.total.value"
          :saved-total="draft.savedTotal.value"
          :total-books="totalBooks"
          :saving="draft.saving.value"
          :read-only="readOnly"
          @save="onSave"
          @discard="onDiscard"
        />
      </template>

      <div v-else class="flex items-center justify-center px-6 py-16">
        <Loader2 :size="24" class="animate-spin text-muted-foreground" aria-hidden="true" />
        <span class="sr-only">{{ t('common.loading') }}</span>
      </div>
    </div>

    <ConfirmDialog
      :open="confirmingReset"
      :title="t('settings.admin.scoreWeights.resetDialog.title')"
      :description="t('settings.admin.scoreWeights.resetDialog.description')"
      :confirm-label="t('settings.admin.scoreWeights.resetToDefaultsButton')"
      :destructive="false"
      @confirm="acceptResetDefaults"
      @cancel="cancelResetDefaults"
    />
  </div>
</template>
