<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Check, RefreshCw, Sparkles, ArrowUpFromLine, CheckCircle2, AlertCircle, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import SettingsPageHeader from './SettingsPageHeader.vue'
import MigrationModal from '@/features/migration/components/MigrationModal.vue'
import { api } from '@/lib/api'
import { getWorkflowState, type MigrationWorkflowState } from '@/features/migration/lib/migration-api'

const showMigrationModal = ref(false)

const running = ref(false)
const queued = ref<number | null>(null)
const embeddingError = ref<string | null>(null)

const migrationState = ref<MigrationWorkflowState | null>(null)
const migrationLoading = ref(true)

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
      <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5">
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
      <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5">
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
  </div>
</template>
