<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Check, RefreshCw, Sparkles, ArrowUpFromLine, CheckCircle2, AlertCircle, Loader2, Bell, Award, BookHeart } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import SettingsPageHeader from './SettingsPageHeader.vue'
import MigrationModal from '@/features/migration/components/MigrationModal.vue'
import { api } from '@/lib/api'
import { getWorkflowState, type MigrationWorkflowState } from '@/features/migration/lib/migration-api'
import { usePermissions } from '@/features/auth/composables/usePermissions'

const showMigrationModal = ref(false)

const running = ref(false)
const queued = ref<number | null>(null)
const embeddingError = ref<string | null>(null)

const migrationState = ref<MigrationWorkflowState | null>(null)
const migrationLoading = ref(true)

const updateCheckEnabled = ref(true)
const updateCheckLoading = ref(false)
const hardcoverEnabled = ref(false)
const hardcoverLoading = ref(false)
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
      const hcRow = settings.find((s) => s.key === 'hardcover_enabled')
      if (hcRow) hardcoverEnabled.value = hcRow.value === 'true'
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
      toast.success(`Update checks ${newVal ? 'enabled' : 'disabled'}`)
    } else {
      toast.error('Failed to update setting')
    }
  } catch {
    toast.error('Failed to update setting')
  } finally {
    updateCheckLoading.value = false
  }
}

async function toggleHardcoverEnabled(newVal: boolean) {
  hardcoverLoading.value = true
  try {
    const res = await api('/api/v1/admin/hardcover/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: newVal }),
    })
    if (res.ok) {
      hardcoverEnabled.value = newVal
      toast.success(`Hardcover sync ${newVal ? 'enabled' : 'disabled'}`)
    } else {
      toast.error('Failed to update setting')
    }
  } catch {
    toast.error('Failed to update setting')
  } finally {
    hardcoverLoading.value = false
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
    toast.success(`${data.queued} books queued for embedding`)
  } catch (e) {
    embeddingError.value = e instanceof Error ? e.message : 'Failed'
    toast.error(`Failed to rebuild embeddings: ${embeddingError.value ?? 'Unknown error'}`)
  } finally {
    running.value = false
  }
}

async function runAchievementBackfill() {
  if (!isSuperuser.value || achievementBackfillRunning.value) return

  if (!confirm('Run achievement backfill for all achievements across all users? This may take a while.')) return

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
    toast.success(`Achievement backfill complete: ${result.awardsGranted} awards granted`)
  } catch (e) {
    achievementBackfillError.value = e instanceof Error ? e.message : 'Failed to run backfill'
    toast.error(`Failed to run achievement backfill: ${achievementBackfillError.value}`)
  } finally {
    achievementBackfillRunning.value = false
  }
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
</script>

<template>
  <MigrationModal v-if="showMigrationModal" @close="onMigrationModalClose" />
  <SettingsPageHeader class="hidden md:flex" title="Maintenance" subtitle="Manage background tasks, system indices, and maintenance operations." />
  <div class="md:hidden px-1">
    <h1 class="text-xl font-semibold tracking-tight text-foreground">Maintenance</h1>
    <p
      class="mt-1 text-sm text-muted-foreground leading-5 overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
    >
      Manage background tasks, system indices, and maintenance operations.
    </p>
  </div>

  <div class="mt-5 md:mt-0 space-y-6">
    <!-- Booklore Import -->
    <div>
      <p class="settings-group-label">Import</p>
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
                <template v-if="migrationCardState === 'none' || migrationCardState === 'loading'">Import from Booklore</template>
                <template v-else-if="migrationCardState === 'configured'">Booklore import configured</template>
                <template v-else-if="migrationCardState === 'running'">Migration running</template>
                <template v-else-if="migrationCardState === 'completed'">Migration completed</template>
                <template v-else-if="migrationCardState === 'failed'">Migration failed</template>
              </p>

              <p
                class="settings-hint leading-relaxed max-w-sm mt-0.5 md:[display:block] overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
              >
                <template v-if="migrationCardState === 'none' || migrationCardState === 'loading'">
                  One-time import of books, metadata, and reading progress from a previous Booklore installation.
                </template>
                <template v-else-if="migrationCardState === 'configured'">
                  Source: {{ migrationSource!.name }}. No migration run yet - continue setup to run the import.
                </template>
                <template v-else-if="migrationCardState === 'running'">
                  Stage: {{ migrationRun!.currentStage ?? 'initializing' }} - started
                  {{ migrationRun!.startedAt ? formatDate(migrationRun!.startedAt) : 'recently' }}
                </template>
                <template v-else-if="migrationCardState === 'completed'">
                  From {{ migrationSource!.name }} - completed {{ formatDate(migrationRun!.endedAt) }}
                </template>
                <template v-else-if="migrationCardState === 'failed'">
                  {{ migrationRun!.errorMessage ?? 'An error occurred during migration.' }}
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
              Get Started
            </template>
            <template v-else-if="migrationCardState === 'configured'">Continue Setup</template>
            <template v-else>View Details</template>
          </button>
        </div>
      </div>
    </div>

    <!-- Recommendations -->
    <div>
      <p class="settings-group-label">Recommendations</p>
      <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs">
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div class="flex items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles :size="16" class="text-primary" />
            </div>
            <div class="min-w-0">
              <p class="settings-label">Refresh recommendation index</p>
              <p
                class="settings-hint leading-relaxed max-w-sm md:[display:block] overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
              >
                Update the recommendations engine with your latest library changes. This process runs in the background.
              </p>
              <p v-if="queued !== null" class="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400 mt-2">
                <Check :size="12" />
                {{ queued }} books queued for processing
              </p>
              <p v-if="embeddingError" class="text-xs text-destructive mt-2">{{ embeddingError }}</p>
            </div>
          </div>
          <button class="settings-btn-outline self-start md:w-auto md:shrink-0" :disabled="running" @click="rebuildEmbeddings">
            <RefreshCw :size="13" :class="running ? 'animate-spin' : ''" />
            {{ running ? 'Running...' : 'Run' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Achievements -->
    <div v-if="isSuperuser">
      <p class="settings-group-label">Achievements</p>
      <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs">
        <div class="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
          <div class="flex items-start gap-3 min-w-0">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Award :size="16" class="text-primary" />
            </div>

            <div class="min-w-0 flex-1">
              <p class="settings-label">Backfill achievements</p>
              <p
                class="settings-hint leading-relaxed max-w-sm md:[display:block] overflow-hidden text-ellipsis [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical]"
              >
                Re-evaluate achievements across all users.
              </p>

              <p v-if="achievementBackfillResult" class="mt-2 text-xs text-green-600 dark:text-green-400">
                Processed {{ achievementBackfillResult.usersProcessed }} users; granted {{ achievementBackfillResult.awardsGranted }} awards.
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
            {{ achievementBackfillRunning ? 'Running...' : 'Run Backfill' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Update checks -->
    <div>
      <p class="settings-group-label">Updates</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="flex items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Bell :size="16" class="text-primary" />
            </div>
            <div class="min-w-0">
              <p class="settings-label">Check for updates</p>
              <p class="settings-hint">
                Automatically check GitHub for a new release on startup and show an indicator in the sidebar when one is available.
              </p>
            </div>
          </div>
          <ToggleSwitch :model-value="updateCheckEnabled" :disabled="updateCheckLoading" @update:model-value="toggleUpdateCheck" />
        </div>
      </div>
    </div>

    <!-- Integrations -->
    <div>
      <p class="settings-group-label">Integrations</p>
      <div class="border border-border rounded-lg overflow-hidden divide-y divide-border shadow-xs">
        <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-3.5 md:px-5 md:py-4 bg-card">
          <div class="flex items-start gap-3">
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <BookHeart :size="16" class="text-primary" />
            </div>
            <div class="min-w-0">
              <p class="settings-label">Hardcover sync</p>
              <p class="settings-hint">Allow users to connect their Hardcover account and sync reading status, progress, and ratings.</p>
            </div>
          </div>
          <ToggleSwitch :model-value="hardcoverEnabled" :disabled="hardcoverLoading" @update:model-value="toggleHardcoverEnabled" />
        </div>
      </div>
    </div>
  </div>
</template>
