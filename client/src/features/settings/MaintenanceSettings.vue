<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDate as formatLocaleDate } from '@/i18n/formatters'
import { Check, RefreshCw, Sparkles, ArrowUpFromLine, CheckCircle2, AlertCircle, Loader2, Bell, Award, Upload } from '@lucide/vue'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import MigrationModal from '@/features/migration/components/MigrationModal.vue'
import { api } from '@/lib/api'
import { getWorkflowState, type MigrationWorkflowState } from '@/features/migration/lib/migration-api'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const { t } = useI18n()

const props = withDefaults(defineProps<{ embedded?: boolean }>(), { embedded: false })

const showMigrationModal = ref(false)

const running = ref(false)
const queued = ref<number | null>(null)
const embeddingError = ref<string | null>(null)

const migrationState = ref<MigrationWorkflowState | null>(null)
const migrationLoading = ref(true)

const updateCheckEnabled = ref(true)
const updateCheckLoading = ref(false)
const maxUploadSizeMb = ref(500)
const localMaxUploadSizeMb = ref(500)
const maxUploadSizeSaving = ref(false)
const achievementBackfillRunning = ref(false)
const achievementBackfillError = ref<string | null>(null)
const achievementBackfillResult = ref<{ usersProcessed: number; awardsGranted: number } | null>(null)

const { isSuperuser } = usePermissions()

const migrationSource = computed(() => migrationState.value?.active?.source ?? null)
const migrationRun = computed(() => migrationState.value?.active?.run ?? null)

const migrationCardState = computed(() => {
  if (migrationLoading.value) return 'loading'
  if (!migrationSource.value) return 'none'
  if (!migrationRun.value) return 'configured'
  return migrationRun.value.state
})

onMounted(async () => {
  try {
    migrationState.value = await getWorkflowState()
  } catch {
    // non-fatal
  } finally {
    migrationLoading.value = false
  }

  try {
    const res = await api('/api/v1/app-settings')
    if (res.ok) {
      const settings: { key: string; value: string }[] = await res.json()
      const row = settings.find((s) => s.key === 'update_check_enabled')
      if (row) updateCheckEnabled.value = row.value === 'true'
      const uploadRow = settings.find((s) => s.key === 'max_upload_size_mb')
      if (uploadRow) {
        const val = parseInt(uploadRow.value, 10) || 500
        maxUploadSizeMb.value = val
        localMaxUploadSizeMb.value = val
      }
    }
  } catch {
    // non-fatal
  }
})

async function onMigrationModalClose() {
  showMigrationModal.value = false
  try {
    migrationState.value = await getWorkflowState()
  } catch {
    // non-fatal
  }
}

function goToMigration() {
  showMigrationModal.value = true
}

async function toggleUpdateCheck(newVal: boolean) {
  updateCheckLoading.value = true
  try {
    const res = await api('/api/v1/app-settings/update_check_enabled', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(newVal) }),
    })
    if (res.ok) {
      updateCheckEnabled.value = newVal
      toast.success(newVal ? t('settings.admin.maintenance.updateChecksEnabled') : t('settings.admin.maintenance.updateChecksDisabled'))
    } else {
      toast.error(t('settings.admin.maintenance.updateSettingFailed'))
    }
  } catch {
    toast.error(t('settings.admin.maintenance.updateSettingFailed'))
  } finally {
    updateCheckLoading.value = false
  }
}

async function rebuildEmbeddings() {
  running.value = true
  queued.value = null
  embeddingError.value = null
  try {
    const res = await api('/api/v1/books/embed-all', { method: 'POST' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data: { queued: number } = await res.json()
    queued.value = data.queued
    toast.success(t('settings.admin.maintenance.booksQueuedForEmbedding', { count: data.queued }, data.queued))
  } catch (e) {
    embeddingError.value = e instanceof Error ? e.message : t('settings.admin.maintenance.failed')
    toast.error(
      t('settings.admin.maintenance.rebuildEmbeddingsFailed', { error: embeddingError.value ?? t('settings.admin.maintenance.unknownError') }),
    )
  } finally {
    running.value = false
  }
}

async function runAchievementBackfill() {
  if (!isSuperuser.value || achievementBackfillRunning.value) return

  if (!confirm(t('settings.admin.maintenance.achievementBackfillConfirm'))) return

  achievementBackfillRunning.value = true
  achievementBackfillError.value = null
  achievementBackfillResult.value = null

  try {
    const res = await api('/api/v1/achievements/admin/backfill', {
      method: 'POST',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const result: { usersProcessed: number; awardsGranted: number } = await res.json()
    achievementBackfillResult.value = result
    toast.success(t('settings.admin.maintenance.achievementBackfillComplete', { count: result.awardsGranted }))
  } catch (e) {
    achievementBackfillError.value = e instanceof Error ? e.message : t('settings.admin.maintenance.backfillRunFailed')
    toast.error(t('settings.admin.maintenance.achievementBackfillFailed', { error: achievementBackfillError.value }))
  } finally {
    achievementBackfillRunning.value = false
  }
}

async function saveMaxUploadSize() {
  const val = localMaxUploadSizeMb.value
  if (isNaN(val) || val <= 0) {
    toast.error(t('settings.admin.maintenance.uploadSizeInvalid'))
    return
  }
  maxUploadSizeSaving.value = true
  try {
    const res = await api('/api/v1/app-settings/max_upload_size_mb', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: String(val) }),
    })
    if (res.ok) {
      maxUploadSizeMb.value = val
      toast.success(t('settings.admin.maintenance.uploadSizeUpdated'))
    } else {
      toast.error(t('settings.admin.maintenance.updateSettingFailed'))
    }
  } catch {
    toast.error(t('settings.admin.maintenance.updateSettingFailed'))
  } finally {
    maxUploadSizeSaving.value = false
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return formatLocaleDate(new Date(iso), { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <MigrationModal v-if="showMigrationModal" @close="onMigrationModalClose" />
  <SettingsPageHeader
    v-if="!props.embedded"
    class="hidden md:flex"
    :title="t('settings.admin.maintenance.title')"
    :subtitle="t('settings.admin.maintenance.subtitle')"
  />
  <div v-if="!props.embedded" class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">{{ t('settings.admin.maintenance.title') }}</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      {{ t('settings.admin.maintenance.subtitle') }}
    </p>
  </div>

  <div class="mt-5 md:mt-0 space-y-6">
    <!-- Uploads -->
    <div v-if="isSuperuser">
      <p class="settings-group-label">{{ t('settings.admin.maintenance.uploadsGroup') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="flex items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Upload :size="16" class="text-primary" />
            </div>
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.admin.maintenance.maxUploadSize') }}</p>
              <p class="settings-hint">{{ t('settings.admin.maintenance.maxUploadSizeHint') }}</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <div class="flex items-center gap-2">
              <input
                type="number"
                v-model.number="localMaxUploadSizeMb"
                min="1"
                max="10000"
                class="w-24 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                :disabled="maxUploadSizeSaving"
              />
              <span class="text-sm text-muted-foreground">MB</span>
            </div>
            <button
              class="settings-btn-outline"
              :disabled="maxUploadSizeSaving || localMaxUploadSizeMb === maxUploadSizeMb"
              @click="saveMaxUploadSize"
            >
              {{ t('settings.admin.maintenance.save') }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Booklore Import -->
    <div>
      <p class="settings-group-label">{{ t('settings.admin.maintenance.importGroup') }}</p>
      <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs">
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div class="flex items-start gap-3">
            <div
              class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              :class="
                migrationCardState === 'completed'
                  ? 'bg-emerald-500/10'
                  : migrationCardState === 'failed'
                    ? 'bg-red-500/10'
                    : migrationCardState === 'running'
                      ? 'bg-sky-500/10'
                      : 'bg-primary/10'
              "
            >
              <Loader2
                v-if="migrationCardState === 'loading' || migrationCardState === 'running'"
                :size="16"
                class="animate-spin"
                :class="migrationCardState === 'running' ? 'text-sky-600' : 'text-muted-foreground'"
              />
              <CheckCircle2 v-else-if="migrationCardState === 'completed'" :size="16" class="text-emerald-600" />
              <AlertCircle v-else-if="migrationCardState === 'failed'" :size="16" class="text-red-600" />
              <ArrowUpFromLine v-else :size="16" class="text-primary" />
            </div>

            <div class="min-w-0">
              <p class="settings-label">
                <template v-if="migrationCardState === 'none' || migrationCardState === 'loading'">{{
                  t('settings.admin.maintenance.importFromBooklore')
                }}</template>
                <template v-else-if="migrationCardState === 'configured'">{{ t('settings.admin.maintenance.bookloreImportConfigured') }}</template>
                <template v-else-if="migrationCardState === 'running'">{{ t('settings.admin.maintenance.migrationRunning') }}</template>
                <template v-else-if="migrationCardState === 'completed'">{{ t('settings.admin.maintenance.migrationCompleted') }}</template>
                <template v-else-if="migrationCardState === 'failed'">{{ t('settings.admin.maintenance.migrationFailed') }}</template>
              </p>

              <p
                class="settings-hint leading-relaxed max-w-sm mt-0.5 md:[display:block] overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
              >
                <template v-if="migrationCardState === 'none' || migrationCardState === 'loading'">
                  {{ t('settings.admin.maintenance.importDescription') }}
                </template>
                <template v-else-if="migrationCardState === 'configured'">
                  {{ t('settings.admin.maintenance.configuredDescription', { name: migrationSource!.name }) }}
                </template>
                <template v-else-if="migrationCardState === 'running'">
                  {{
                    t('settings.admin.maintenance.runningDescription', {
                      stage: migrationRun!.currentStage ?? t('settings.admin.maintenance.stageInitializing'),
                      started: migrationRun!.startedAt ? formatDate(migrationRun!.startedAt) : t('settings.admin.maintenance.recently'),
                    })
                  }}
                </template>
                <template v-else-if="migrationCardState === 'completed'">
                  {{ t('settings.admin.maintenance.completedDescription', { name: migrationSource!.name, date: formatDate(migrationRun!.endedAt) }) }}
                </template>
                <template v-else-if="migrationCardState === 'failed'">
                  {{ migrationRun!.errorMessage ?? t('settings.admin.maintenance.migrationErrorGeneric') }}
                </template>
              </p>
            </div>
          </div>

          <button
            v-if="migrationCardState !== 'loading'"
            class="self-start md:w-auto md:shrink-0"
            :class="migrationCardState === 'none' ? 'settings-btn-primary' : 'settings-btn-outline'"
            @click="goToMigration"
          >
            <template v-if="migrationCardState === 'none'">
              <ArrowUpFromLine :size="13" />
              {{ t('settings.admin.maintenance.getStarted') }}
            </template>
            <template v-else-if="migrationCardState === 'configured'">{{ t('settings.admin.maintenance.continueSetup') }}</template>
            <template v-else>{{ t('settings.admin.maintenance.viewDetails') }}</template>
          </button>
        </div>
      </div>
    </div>

    <!-- Recommendations -->
    <div>
      <p class="settings-group-label">{{ t('settings.admin.maintenance.recommendationsGroup') }}</p>
      <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs">
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div class="flex items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles :size="16" class="text-primary" />
            </div>
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.admin.maintenance.refreshRecommendationIndex') }}</p>
              <p
                class="settings-hint leading-relaxed max-w-sm md:[display:block] overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
              >
                {{ t('settings.admin.maintenance.refreshRecommendationHint') }}
              </p>
              <p v-if="queued !== null" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-2">
                <Check :size="12" />
                {{ t('settings.admin.maintenance.booksQueuedForProcessing', { count: queued }, queued) }}
              </p>
              <p v-if="embeddingError" class="text-xs text-destructive mt-2">{{ embeddingError }}</p>
            </div>
          </div>
          <button class="settings-btn-outline self-start md:w-auto md:shrink-0" :disabled="running" @click="rebuildEmbeddings">
            <RefreshCw :size="13" :class="running ? 'animate-spin' : ''" />
            {{ running ? t('settings.admin.maintenance.running') : t('settings.admin.maintenance.run') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Achievements -->
    <div v-if="isSuperuser">
      <p class="settings-group-label">{{ t('settings.admin.maintenance.achievementsGroup') }}</p>
      <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs">
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div class="flex items-start gap-3 min-w-0">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Award :size="16" class="text-primary" />
            </div>

            <div class="min-w-0 flex-1">
              <p class="settings-label">{{ t('settings.admin.maintenance.backfillAchievements') }}</p>
              <p
                class="settings-hint leading-relaxed max-w-sm md:[display:block] overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
              >
                {{ t('settings.admin.maintenance.backfillAchievementsHint') }}
              </p>

              <p v-if="achievementBackfillResult" class="mt-2 text-xs text-green-600 dark:text-green-400">
                {{
                  t('settings.admin.maintenance.backfillResult', {
                    users: achievementBackfillResult.usersProcessed,
                    awards: achievementBackfillResult.awardsGranted,
                  })
                }}
              </p>
              <p v-if="achievementBackfillError" class="mt-2 text-xs text-destructive">{{ achievementBackfillError }}</p>
            </div>
          </div>

          <button
            class="settings-btn-outline self-start md:w-auto md:shrink-0"
            :disabled="achievementBackfillRunning"
            @click="runAchievementBackfill"
          >
            <RefreshCw :size="13" :class="achievementBackfillRunning ? 'animate-spin' : ''" />
            {{ achievementBackfillRunning ? t('settings.admin.maintenance.running') : t('settings.admin.maintenance.runBackfill') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Update checks -->
    <div>
      <p class="settings-group-label">{{ t('settings.admin.maintenance.updatesGroup') }}</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="flex items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Bell :size="16" class="text-primary" />
            </div>
            <div class="min-w-0">
              <p class="settings-label">{{ t('settings.admin.maintenance.checkForUpdates') }}</p>
              <p class="settings-hint">
                {{ t('settings.admin.maintenance.checkForUpdatesHint') }}
              </p>
            </div>
          </div>
          <ToggleSwitch :model-value="updateCheckEnabled" :disabled="updateCheckLoading" @update:model-value="toggleUpdateCheck" />
        </div>
      </div>
    </div>
  </div>
</template>
