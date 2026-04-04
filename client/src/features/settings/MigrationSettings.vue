<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { Eye, EyeOff, Loader2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import SettingsPageHeader from './SettingsPageHeader.vue'
import {
  createDryRunPlan,
  createProfile,
  createSource,
  exportRunReport,
  getRunProgress,
  getRunReport,
  getWorkflowState,
  listSourcePathPrefixes,
  listSupportedSourceTypes,
  listTargetLibraryFolders,
  listTargetUsers,
  startLiveRun,
  suggestUserMappings,
  testSource,
  validatePathMappings,
  validateSourceById,
  type MigrationPlanArtifact,
  type MigrationProfile,
  type MigrationRun,
  type MigrationRunProgress,
  type MigrationRunReport,
  type MigrationSource,
  type MigrationSourceCapabilities,
  type MigrationWorkflowState,
  type PathMappingValidation,
} from '@/features/migration/lib/migration-api'

interface TargetUser {
  id: number
  username: string
  name: string
  email: string | null
}

interface UserMappingDraft {
  sourceUserId: string
  username: string
  targetUserId: number | null
}

interface PathMappingDraft {
  sourcePrefix: string
  targetPrefix: string
}

interface ReportUnresolvedBook {
  sourceBookId: string
  title: string | null
  reason: string | null
}

const loading = ref(true)
const supportedTypes = ref<string[]>([])
const targetUsers = ref<TargetUser[]>([])
const targetLibraryFolders = ref<Array<{ libraryName: string; path: string }>>([])
const sourcePathPrefixes = ref<string[]>([])

const workflowState = ref<MigrationWorkflowState | null>(null)
const runProgress = ref<MigrationRunProgress | null>(null)
const runReport = ref<MigrationRunReport | null>(null)
const pathValidation = ref<PathMappingValidation | null>(null)
const suggestionsLoadedAt = ref<string | null>(null)

const userMappings = ref<UserMappingDraft[]>([])
const pathMappings = ref<PathMappingDraft[]>([{ sourcePrefix: '', targetPrefix: '' }])

const sourceDraft = reactive({
  type: 'booklore',
  name: 'Booklore',
  host: '',
  port: 3306,
  user: '',
  password: '',
  database: '',
  ssl: false,
  mediaRootPath: '',
})

const busy = reactive({
  testingSource: false,
  savingSource: false,
  loadingSuggestions: false,
  savingProfile: false,
  dryRun: false,
  startingRun: false,
  loadingProgress: false,
  loadingReport: false,
  exporting: false,
})

const showPassword = ref(false)

const active = computed(() => workflowState.value?.active ?? null)
const source = computed<MigrationSource | null>(() => active.value?.source ?? null)
const profile = computed<MigrationProfile | null>(() => active.value?.profile ?? null)
const plan = computed<MigrationPlanArtifact | null>(() => active.value?.plan ?? null)
const run = computed<MigrationRun | null>(() => active.value?.run ?? null)
const hasActiveRun = computed(() => workflowState.value?.hasActiveRun === true)
const sourceCapabilities = computed<MigrationSourceCapabilities | null>(() => source.value?.capabilities ?? null)
const sourceValidationWarnings = computed(() => sourceCapabilities.value?.warnings ?? [])
const sourceRowCounts = computed(() => Object.entries(sourceCapabilities.value?.counts ?? {}).sort(([left], [right]) => left.localeCompare(right)))

const stepStatus = computed(() => {
  const src = source.value
  return {
    source: !src ? ('pending' as const) : src.lastValidatedAt ? ('done' as const) : ('saved' as const),
    mappings: profile.value ? ('done' as const) : ('pending' as const),
    dryRun: preflight.value.dryRunFresh ? ('done' as const) : ('pending' as const),
    migration: !run.value
      ? ('pending' as const)
      : run.value.state === 'completed'
        ? ('done' as const)
        : run.value.state === 'failed'
          ? ('failed' as const)
          : ('running' as const),
  }
})

const unresolvedSummary = computed(() => Object.entries(plan.value?.summary?.unresolvedByReason ?? {}))

const preflight = computed(() => {
  const issues: string[] = []
  const currentSource = source.value
  const currentProfile = profile.value
  const currentPlan = plan.value
  const sourceValidated = !!currentSource?.lastValidatedAt
  const pathMappingsValidated = hasValidatedPathMappings(currentProfile)

  let dryRunFresh = false
  if (currentPlan && currentProfile && currentSource?.lastValidatedAt) {
    const planCreated = new Date(currentPlan.createdAt)
    const profileUpdated = new Date(currentProfile.updatedAt)
    const sourceValidatedAt = new Date(currentSource.lastValidatedAt)
    dryRunFresh = currentPlan.profileId === currentProfile.id && planCreated >= profileUpdated && planCreated >= sourceValidatedAt
  }

  if (!currentSource) issues.push('Save source connection settings')
  else if (!sourceValidated) issues.push('Validate source connection')
  if (!currentProfile) issues.push('Save user and path mappings')
  else if (!pathMappingsValidated) issues.push('Save path mappings to validate them')
  if (!dryRunFresh) issues.push('Run a fresh dry-run')
  else if ((currentPlan?.summary?.duplicateBookMatches ?? 0) > 0 || currentPlan?.summary?.status === 'blocked') {
    issues.push('Resolve duplicate target book matches in the dry-run')
  }
  if (hasActiveRun.value) issues.push('Wait for active run to finish')

  return { sourceValidated, pathMappingsValidated, dryRunFresh, ready: issues.length === 0, issues }
})

const reportData = computed(() => {
  const metrics = runReport.value?.metrics ?? runProgress.value?.metrics ?? []
  const m = (stage: string, entity: string) => metrics.find((r) => r.stage === stage && r.entityType === entity) ?? null
  const bookCovers = m('shared_overlays', 'book_covers')
  const coversSkippedAll =
    !!bookCovers && bookCovers.imported === 0 && bookCovers.skipped > 0 && bookCovers.unresolved === 0 && bookCovers.failed === 0
  const unresolvedBooks = extractPlanUnresolvedBooks(runReport.value?.plan ?? plan.value?.plan ?? null)
  const startedAt = run.value?.startedAt ? new Date(run.value.startedAt) : null
  const endedAt = run.value?.endedAt ? new Date(run.value.endedAt) : null
  return {
    durationMs: startedAt && endedAt ? endedAt.getTime() - startedAt.getTime() : null,
    bookMetadata: m('shared_overlays', 'book_metadata'),
    bookAuthors: m('shared_overlays', 'book_authors'),
    bookNarrators: m('shared_overlays', 'book_narrators'),
    bookGenres: m('shared_overlays', 'book_genres'),
    bookTags: m('shared_overlays', 'book_tags'),
    bookCovers,
    coversSkippedAll,
    userBookStatus: m('user_state', 'user_book_status'),
    readingProgress: m('user_state', 'reading_progress'),
    audiobookProgress: m('user_state', 'audiobook_progress'),
    bookmarks: m('user_state', 'bookmarks'),
    annotations: m('user_state', 'annotations'),
    collections: m('user_state', 'collections'),
    unresolvedBooks,
    coverFailureCount: bookCovers?.failed ?? 0,
  }
})

let runPollTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await initialize()
})

onBeforeUnmount(() => {
  stopRunPolling()
})

watch(
  () => run.value?.state,
  (state) => {
    if (state === 'running') {
      startRunPolling()
      return
    }
    stopRunPolling()
  },
)

async function initialize() {
  loading.value = true
  try {
    const [typesRes, usersRes, foldersRes] = await Promise.all([listSupportedSourceTypes(), listTargetUsers(), listTargetLibraryFolders()])
    supportedTypes.value = typesRes
    targetUsers.value = usersRes
    targetLibraryFolders.value = foldersRes
    await refreshWorkflowState()
  } catch (error) {
    toast.error(getErrorMessage(error, 'Failed to initialize migration settings'))
  } finally {
    loading.value = false
  }
}

async function refreshWorkflowState() {
  workflowState.value = await getWorkflowState()
  hydrateSourceDraft()
  hydratePathMappings()
  hydrateUserMappingsFromProfile()
  if (source.value?.lastValidatedAt) {
    await hydrateUserMappingsFromSuggestions(false)
    await autoLoadPathPrefixes()
  }
  if (run.value?.state === 'running') {
    await refreshRunProgress()
  }
}

function hydrateSourceDraft() {
  const currentSource = source.value
  if (!currentSource) return
  sourceDraft.type = currentSource.type || sourceDraft.type
  sourceDraft.name = currentSource.name || sourceDraft.name
  const cfg = asRecord(currentSource.connectionConfig)
  sourceDraft.host = asString(cfg.host) ?? sourceDraft.host
  sourceDraft.port = asNumber(cfg.port) ?? sourceDraft.port
  sourceDraft.user = asString(cfg.user) ?? sourceDraft.user
  sourceDraft.database = asString(cfg.database) ?? sourceDraft.database
  sourceDraft.ssl = asBoolean(cfg.ssl) ?? sourceDraft.ssl
  sourceDraft.mediaRootPath = asString(cfg.mediaRootPath) ?? ''
}

function hydratePathMappings() {
  const existing = profile.value?.pathMappings ?? []
  if (existing.length === 0) {
    pathMappings.value = [{ sourcePrefix: '', targetPrefix: '' }]
    return
  }
  pathMappings.value = existing.map((row) => ({ sourcePrefix: row.sourcePrefix, targetPrefix: row.targetPrefix }))
}

function hydrateUserMappingsFromProfile() {
  const existing = profile.value?.userMappings ?? []
  userMappings.value = existing.map((row) => ({
    sourceUserId: row.sourceUserId,
    username: row.sourceUserId,
    targetUserId: row.targetUserId,
  }))
}

async function hydrateUserMappingsFromSuggestions(showSuccessToast: boolean) {
  const currentSource = source.value
  if (!currentSource) return

  busy.loadingSuggestions = true
  try {
    const response = await suggestUserMappings(currentSource.id)
    suggestionsLoadedAt.value = response.generatedAt
    const savedMappings = new Map((profile.value?.userMappings ?? []).map((row) => [row.sourceUserId, row.targetUserId]))

    userMappings.value = response.suggestions.map((row) => ({
      sourceUserId: row.sourceUserId,
      username: row.username,
      targetUserId: savedMappings.get(row.sourceUserId) ?? row.suggestedTargetUserId,
    }))

    if (showSuccessToast) {
      if (userMappings.value.length === 0) {
        toast.warning('No source users were returned')
      } else {
        toast.success('User mapping suggestions loaded')
      }
    }
  } catch (error) {
    if (showSuccessToast) {
      toast.error(getErrorMessage(error, 'Failed to load user mapping suggestions'))
    }
  } finally {
    busy.loadingSuggestions = false
  }
}

function buildSourceConnectionConfig() {
  return {
    host: sourceDraft.host.trim(),
    port: sourceDraft.port,
    user: sourceDraft.user.trim(),
    password: sourceDraft.password,
    database: sourceDraft.database.trim(),
    ssl: sourceDraft.ssl,
    mediaRootPath: sourceDraft.mediaRootPath.trim(),
  }
}

function hasValidSourceDraft() {
  return !!sourceDraft.name.trim() && !!sourceDraft.host.trim() && !!sourceDraft.user.trim() && !!sourceDraft.database.trim()
}

async function onTestSource() {
  if (!hasValidSourceDraft()) {
    toast.error('Host, user, database, and source name are required')
    return
  }

  busy.testingSource = true
  try {
    const result = await testSource({ type: sourceDraft.type, connectionConfig: buildSourceConnectionConfig() })
    const missing = Array.isArray(result.missingTables) ? result.missingTables.length : 0
    if (result.ok === true) {
      toast.success('Connection test passed')
    } else {
      toast.warning(`Connection ok, but ${missing} required table(s) are missing`)
    }
  } catch (error) {
    toast.error(friendlyConnectionError(error))
  } finally {
    busy.testingSource = false
  }
}

async function onSaveAndValidate() {
  if (hasActiveRun.value) {
    toast.error('Cannot modify source while a run is active')
    return
  }
  if (!hasValidSourceDraft()) {
    toast.error('Host, user, database, and source name are required')
    return
  }

  busy.savingSource = true
  try {
    await createSource({
      type: sourceDraft.type,
      name: sourceDraft.name.trim(),
      connectionConfig: buildSourceConnectionConfig(),
    })
    await refreshWorkflowState()

    const currentSource = source.value
    if (currentSource) {
      const result = await validateSourceById(currentSource.id)
      const warnings = Array.isArray(result.warnings) ? (result.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : []
      await refreshWorkflowState()
      await autoLoadPathPrefixes()
      toast.success(warnings.length > 0 ? `Source saved and validated with ${warnings.length} warning(s)` : 'Source saved and validated')
    }
  } catch (error) {
    toast.error(getErrorMessage(error, 'Failed to save or validate source'))
  } finally {
    busy.savingSource = false
  }
}

async function autoLoadPathPrefixes() {
  const currentSource = source.value
  if (!currentSource) return
  try {
    const result = await listSourcePathPrefixes(currentSource.id)
    sourcePathPrefixes.value = result.prefixes
  } catch {
    // non-fatal - user can still select target folders without source prefixes
  }
}

async function onReloadSuggestions() {
  await hydrateUserMappingsFromSuggestions(true)
}

function addPathMapping() {
  pathMappings.value.push({ sourcePrefix: '', targetPrefix: '' })
}

function removePathMapping(index: number) {
  pathMappings.value = pathMappings.value.filter((_row, rowIndex) => rowIndex !== index)
  if (pathMappings.value.length === 0) {
    pathMappings.value = [{ sourcePrefix: '', targetPrefix: '' }]
  }
}

function cleanedPathMappings() {
  return pathMappings.value
    .map((row) => ({
      sourcePrefix: row.sourcePrefix.trim(),
      targetPrefix: row.targetPrefix.trim(),
    }))
    .filter((row) => row.sourcePrefix.length > 0 && row.targetPrefix.length > 0)
}

function cleanedUserMappings() {
  return userMappings.value
    .map((row) => ({ sourceUserId: row.sourceUserId, targetUserId: row.targetUserId }))
    .filter((row): row is { sourceUserId: string; targetUserId: number } => !!row.targetUserId)
}

async function onSaveMappings() {
  if (hasActiveRun.value) {
    toast.error('Cannot save mappings while a run is active')
    return
  }
  const currentSource = source.value
  if (!currentSource) {
    toast.error('Save source first')
    return
  }

  const mappings = cleanedUserMappings()
  if (mappings.length === 0) {
    toast.error('Map at least one source user to a target user')
    return
  }
  if (mappings.length !== userMappings.value.length) {
    toast.error('Map every source user before saving')
    return
  }

  busy.savingProfile = true
  try {
    const cleanedPaths = cleanedPathMappings()
    if (cleanedPaths.length > 0) {
      try {
        pathValidation.value = await validatePathMappings(currentSource.id, { pathMappings: cleanedPaths, sampleLimit: 10 })
      } catch {
        // non-blocking - path validation failure does not prevent saving
      }
    }

    await createProfile({
      sourceId: currentSource.id,
      name: 'Booklore Migration',
      userMappings: mappings,
      pathMappings: cleanedPaths,
      scope: {
        preflight: {
          pathValidatedAt: pathValidation.value?.validatedAt ?? getPersistedPathValidatedAt(profile.value),
          suggestionsLoadedAt: suggestionsLoadedAt.value,
        },
      },
    })
    await refreshWorkflowState()
    toast.success('Mappings saved')
  } catch (error) {
    toast.error(getErrorMessage(error, 'Failed to save mappings'))
  } finally {
    busy.savingProfile = false
  }
}

async function onRunDryRun() {
  if (hasActiveRun.value) {
    toast.error('Cannot run dry-run while a run is active')
    return
  }
  const currentProfile = profile.value
  if (!currentProfile) {
    toast.error('Save mappings first')
    return
  }

  busy.dryRun = true
  try {
    const artifact = await createDryRunPlan({ profileId: currentProfile.id })
    await refreshWorkflowState()
    const matched = artifact.summary?.matchedBooks ?? 0
    const unresolved = artifact.summary?.unresolvedBooks ?? 0
    toast.success(`Dry-run completed: ${matched} matched, ${unresolved} unresolved`)
  } catch (error) {
    toast.error(getErrorMessage(error, 'Dry-run failed'))
  } finally {
    busy.dryRun = false
  }
}

async function onStartMigration() {
  if (!preflight.value.ready) {
    toast.error(preflight.value.issues[0] ?? 'Migration preflight not ready')
    return
  }
  const currentPlan = plan.value
  if (!currentPlan) {
    toast.error('Run dry-run first')
    return
  }

  const confirmed = window.confirm('Start migration now?')
  if (!confirmed) return

  busy.startingRun = true
  try {
    await startLiveRun({ planArtifactId: currentPlan.id })
    await refreshWorkflowState()
    await refreshRunProgress()
    toast.success('Migration run started')
  } catch (error) {
    toast.error(getErrorMessage(error, 'Failed to start migration'))
  } finally {
    busy.startingRun = false
  }
}

async function refreshRunProgress() {
  const currentRun = run.value
  if (!currentRun) return

  busy.loadingProgress = true
  try {
    runProgress.value = await getRunProgress(currentRun.id)
    if (runProgress.value.run.state !== 'running') {
      stopRunPolling()
      await refreshWorkflowState()
    }
  } catch (error) {
    stopRunPolling()
    toast.error(getErrorMessage(error, 'Failed to load run progress'))
  } finally {
    busy.loadingProgress = false
  }
}

async function onRefreshReport() {
  const currentRun = run.value
  if (!currentRun) {
    toast.error('Start migration first')
    return
  }

  busy.loadingReport = true
  try {
    runReport.value = await getRunReport(currentRun.id)
    toast.success('Run report refreshed')
  } catch (error) {
    toast.error(getErrorMessage(error, 'Failed to load run report'))
  } finally {
    busy.loadingReport = false
  }
}

async function onExportJson() {
  await exportReport('json')
}

async function onExportCsv() {
  await exportReport('csv')
}

function onTogglePassword() {
  showPassword.value = !showPassword.value
}

async function exportReport(format: 'json' | 'csv') {
  const currentRun = run.value
  if (!currentRun) {
    toast.error('Start migration first')
    return
  }

  busy.exporting = true
  try {
    const exported = await exportRunReport(currentRun.id, format)
    downloadTextFile(exported.fileName, exported.content, exported.contentType)
    toast.success(`Report exported as ${format.toUpperCase()}`)
  } catch (error) {
    toast.error(getErrorMessage(error, 'Failed to export migration report'))
  } finally {
    busy.exporting = false
  }
}

function startRunPolling() {
  stopRunPolling()
  runPollTimer = setInterval(() => {
    void refreshRunProgress()
  }, 3000)
}

function stopRunPolling() {
  if (runPollTimer == null) return
  clearInterval(runPollTimer)
  runPollTimer = null
}

function downloadTextFile(fileName: string, content: string, contentType: string) {
  const blob = new Blob([content], { type: contentType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
}

function friendlyUnresolvedReason(reason: string | null): string {
  if (reason === 'no_title_author_match') return 'No matching book found by title or author'
  if (reason === 'no_file_path_match') return 'File path did not match any book in this library'
  if (reason === 'no_file_hash_match') return 'File hash did not match any book in this library'
  if (reason === 'no_isbn_match') return 'ISBN did not match any book in this library'
  if (reason === 'insufficient_source_data') return 'Not enough metadata to attempt matching'
  return reason ?? 'Could not determine reason'
}

function extractPlanUnresolvedBooks(planPayload: unknown): ReportUnresolvedBook[] {
  const rows = asRecord(planPayload).unresolvedBooks
  if (!Array.isArray(rows)) return []

  return rows
    .map((row) => {
      const record = asRecord(row)
      const sourceBookId = asString(record.sourceBookId)
      if (!sourceBookId) return null
      return {
        sourceBookId,
        title: asString(record.title),
        reason: asString(record.reason),
      }
    })
    .filter((row): row is ReportUnresolvedBook => row != null)
}

function friendlyConnectionError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED|ENOTFOUND|connect ETIMEDOUT/i.test(msg)) return 'Could not reach the database server. Check the host and port.'
  if (/Access denied|authentication failed/i.test(msg)) return 'Authentication failed. Check the username and password.'
  if (/Unknown database/i.test(msg)) return 'Database not found. Check the database name.'
  if (/ETIMEDOUT|timeout/i.test(msg)) return 'Connection timed out. Check host and firewall settings.'
  return msg || 'Connection test failed'
}

function runStateClass(state: string) {
  if (state === 'completed') return 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20'
  if (state === 'running') return 'bg-sky-500/10 text-sky-700 border-sky-500/20'
  if (state === 'failed') return 'bg-red-500/10 text-red-700 border-red-500/20'
  return 'bg-muted text-muted-foreground border-border'
}

function getPersistedPathValidatedAt(currentProfile: MigrationProfile | null): string | null {
  if (!currentProfile) return null
  const scope = asRecord(currentProfile.scope)
  const preflightScope = asRecord(scope.preflight)
  return asString(preflightScope.pathValidatedAt)
}

function hasValidatedPathMappings(currentProfile: MigrationProfile | null): boolean {
  if (!currentProfile) return false
  if (currentProfile.pathMappings.length === 0) return true
  return getPersistedPathValidatedAt(currentProfile) != null
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  return null
}

function formatSourceCountLabel(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toUpperCase())
}
</script>

<template>
  <SettingsPageHeader
    title="Migration"
    subtitle="One-time Booklore import: connect source, map users, dry-run, start migration, and export a report."
  />

  <div v-if="loading" class="flex items-center justify-center py-12">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
  </div>

  <div v-else class="space-y-8">
    <section class="rounded-lg border border-border bg-card p-4 space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p class="text-sm font-medium">{{ source ? `Migration setup: ${source.name}` : 'Migration setup not saved yet' }}</p>
          <p class="text-xs text-muted-foreground">
            {{ hasActiveRun ? 'A migration run is in progress' : 'Configure the source, mappings, and dry-run before starting the import.' }}
          </p>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <span class="settings-group-label mb-0">Step 1 · Source Connection</span>
        <span v-if="stepStatus.source === 'done'" class="text-xs text-emerald-600">Validated</span>
        <span v-else-if="stepStatus.source === 'saved'" class="text-xs text-amber-600">Saved - not validated</span>
      </div>
      <div class="rounded-lg border border-border bg-card p-4 space-y-4">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label class="block">
            <span class="settings-hint">Source Type</span>
            <select v-model="sourceDraft.type" class="select-field mt-1 w-full" :disabled="hasActiveRun">
              <option v-for="type in supportedTypes" :key="type" :value="type">{{ type }}</option>
            </select>
          </label>
          <label class="block">
            <span class="settings-hint">Source Name</span>
            <input v-model="sourceDraft.name" class="input-field mt-1 w-full" placeholder="Booklore Import" :disabled="hasActiveRun" />
          </label>
          <label class="block">
            <span class="settings-hint">Host</span>
            <input v-model="sourceDraft.host" class="input-field mt-1 w-full" placeholder="127.0.0.1" :disabled="hasActiveRun" />
          </label>
          <label class="block">
            <span class="settings-hint">Port</span>
            <input v-model.number="sourceDraft.port" class="input-field mt-1 w-full" type="number" min="1" max="65535" :disabled="hasActiveRun" />
          </label>
          <label class="block">
            <span class="settings-hint">User</span>
            <input v-model="sourceDraft.user" class="input-field mt-1 w-full" placeholder="booklore" :disabled="hasActiveRun" />
          </label>
          <label class="block">
            <span class="settings-hint">Password</span>
            <div class="relative mt-1">
              <input
                v-model="sourceDraft.password"
                class="input-field w-full pr-9"
                :class="!sourceDraft.password && !source ? 'placeholder:text-amber-600' : ''"
                :type="showPassword ? 'text' : 'password'"
                :placeholder="sourceDraft.password ? '••••••••' : source ? 'Saved - enter to change' : 'No password set'"
                :disabled="hasActiveRun"
              />
              <button
                type="button"
                class="absolute inset-y-0 right-0 flex items-center px-2.5 text-muted-foreground hover:text-foreground"
                tabindex="-1"
                @click="onTogglePassword"
              >
                <EyeOff v-if="showPassword" class="size-4" />
                <Eye v-else class="size-4" />
              </button>
            </div>
          </label>
          <label class="block">
            <span class="settings-hint">Database</span>
            <input v-model="sourceDraft.database" class="input-field mt-1 w-full" placeholder="booklore" :disabled="hasActiveRun" />
          </label>
          <label class="block md:col-span-2 xl:col-span-2">
            <span class="settings-hint">Media Root Path</span>
            <input v-model="sourceDraft.mediaRootPath" class="input-field mt-1 w-full" placeholder="/data/booklore/media" :disabled="hasActiveRun" />
            <p class="mt-1 text-xs" :class="sourceDraft.mediaRootPath.trim() ? 'text-muted-foreground' : 'text-amber-600'">
              {{
                sourceDraft.mediaRootPath.trim()
                  ? 'Book cover images will be imported from this directory.'
                  : 'Required for cover import. Without this, book covers will not be migrated.'
              }}
            </p>
          </label>
          <div class="block">
            <span class="settings-hint opacity-0 select-none">_</span>
            <label class="mt-1 flex h-9 cursor-pointer items-center gap-2">
              <input v-model="sourceDraft.ssl" type="checkbox" class="size-4 rounded border-border" :disabled="hasActiveRun" />
              <span class="settings-hint">Use TLS/SSL</span>
            </label>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="settings-btn-outline" :disabled="busy.testingSource || hasActiveRun" @click="onTestSource">
            <Loader2 v-if="busy.testingSource" class="size-3.5 animate-spin" />
            Test Connection
          </button>
          <button class="settings-btn-primary" :disabled="busy.savingSource || hasActiveRun" @click="onSaveAndValidate">
            <Loader2 v-if="busy.savingSource" class="size-3.5 animate-spin" />
            Save &amp; Validate
          </button>
        </div>

        <div
          v-if="sourceValidationWarnings.length > 0"
          class="rounded border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 space-y-1"
        >
          <p class="font-medium">Source validated with warnings</p>
          <p v-for="warn in sourceValidationWarnings" :key="warn">{{ warn }}</p>
        </div>

        <div v-if="sourceCapabilities" class="rounded border border-border bg-muted/40 p-3 text-xs space-y-2">
          <p class="font-medium text-foreground">Last validation snapshot</p>
          <p class="text-muted-foreground">Source version: {{ sourceCapabilities.sourceVersion ?? 'Unknown' }}</p>
          <p v-if="sourceCapabilities.missingTables.length > 0" class="text-amber-600">
            Missing required tables: {{ sourceCapabilities.missingTables.join(', ') }}
          </p>
          <div v-if="sourceRowCounts.length > 0" class="grid gap-1 text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
            <p v-for="[key, count] in sourceRowCounts" :key="key">{{ formatSourceCountLabel(key) }}: {{ count }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <span class="settings-group-label mb-0">Step 2 · User and Path Mapping</span>
        <span v-if="stepStatus.mappings === 'done'" class="text-xs text-emerald-600">Saved</span>
      </div>
      <div class="rounded-lg border border-border bg-card p-4 space-y-4">
        <div class="flex items-center gap-2">
          <p class="text-xs text-muted-foreground">User suggestions load automatically after source validation.</p>
          <button
            v-if="source"
            class="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
            :disabled="busy.loadingSuggestions || hasActiveRun"
            @click="onReloadSuggestions"
          >
            <Loader2 v-if="busy.loadingSuggestions" class="size-3 animate-spin inline" />
            Refresh
          </button>
        </div>

        <div class="overflow-x-auto rounded border border-border">
          <table class="w-full text-sm">
            <thead class="bg-muted/40 text-left">
              <tr>
                <th class="px-3 py-2 font-medium">Source User</th>
                <th class="px-3 py-2 font-medium">Target User</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in userMappings" :key="row.sourceUserId" class="border-t border-border">
                <td class="px-3 py-2">
                  <p class="font-medium">{{ row.username }}</p>
                  <p class="text-xs text-muted-foreground">{{ row.sourceUserId }}</p>
                </td>
                <td class="px-3 py-2">
                  <select v-model.number="row.targetUserId" class="select-field w-full min-w-48" :disabled="hasActiveRun">
                    <option :value="null">Select user</option>
                    <option v-for="user in targetUsers" :key="user.id" :value="user.id">{{ user.username }} · {{ user.name }}</option>
                  </select>
                </td>
              </tr>
              <tr v-if="userMappings.length === 0" class="border-t border-border">
                <td colspan="2" class="px-3 py-4 text-sm text-muted-foreground">No source users loaded yet.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <p class="settings-hint">Path Prefix Mappings</p>
            <button class="settings-btn-outline" :disabled="hasActiveRun" @click="addPathMapping">Add Mapping</button>
          </div>
          <p class="text-xs text-muted-foreground">
            Path mappings translate source file paths to target paths so books can be matched by file location. For example, if your Booklore library
            stored files under <code class="font-mono">/books/Large</code> and the same files now live under
            <code class="font-mono">/srv/projectx/books/Large</code>, add that mapping here. Books are also matched by ISBN, file hash, and
            title/author regardless of path mappings - path mapping is only one of four strategies and does not limit which source books are included
            in the migration.
          </p>

          <div v-for="(row, index) in pathMappings" :key="index" class="grid gap-2 md:grid-cols-[1fr_1fr_auto] items-center">
            <select v-model="row.sourcePrefix" class="select-field" :disabled="hasActiveRun">
              <option value="">
                {{ sourcePathPrefixes.length === 0 ? 'No prefixes found - validate source first' : 'Select source prefix...' }}
              </option>
              <option v-for="prefix in sourcePathPrefixes" :key="prefix" :value="prefix">{{ prefix }}</option>
            </select>

            <select v-model="row.targetPrefix" class="select-field" :disabled="hasActiveRun">
              <option value="">Select target folder...</option>
              <option v-for="folder in targetLibraryFolders" :key="folder.path" :value="folder.path">
                {{ folder.libraryName }} - {{ folder.path }}
              </option>
            </select>

            <button class="settings-btn-outline" :disabled="hasActiveRun" @click="removePathMapping(index)">Remove</button>
          </div>
        </div>

        <div v-if="pathValidation" class="rounded border border-border bg-muted/40 p-3 text-xs space-y-1">
          <p class="font-medium text-foreground">Path validation</p>
          <p class="text-muted-foreground">
            {{ pathValidation.summary.mappedByPrefix }} of {{ pathValidation.summary.booksWithFilePath }} source books have a mapped path
          </p>
          <p v-if="pathValidation.summary.unmatchedTargetPaths > 0" class="text-amber-600">
            {{ pathValidation.summary.unmatchedTargetPaths }} mapped paths not found on disk - those books will fall back to ISBN / title matching
          </p>
          <p v-else-if="pathValidation.summary.matchedTargetPaths > 0" class="text-emerald-600">
            All {{ pathValidation.summary.matchedTargetPaths }} mapped paths found on disk
          </p>
        </div>

        <button class="settings-btn-primary" :disabled="busy.savingProfile || source == null || hasActiveRun" @click="onSaveMappings">
          <Loader2 v-if="busy.savingProfile" class="size-3.5 animate-spin" />
          Save Mappings
        </button>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <span class="settings-group-label mb-0">Step 3 · Dry-Run Summary</span>
        <span v-if="stepStatus.dryRun === 'done'" class="text-xs text-emerald-600">Up to date</span>
      </div>
      <div class="rounded-lg border border-border bg-card p-4 space-y-4">
        <button class="settings-btn-primary" :disabled="busy.dryRun || profile == null || hasActiveRun" @click="onRunDryRun">
          <Loader2 v-if="busy.dryRun" class="size-3.5 animate-spin" />
          Run Dry-Run
        </button>

        <div v-if="plan" class="rounded border border-border bg-muted/30 p-3 space-y-2 text-sm">
          <p>
            Matched: <span class="font-medium">{{ plan.summary?.matchedBooks ?? 0 }}</span> · Unresolved:
            <span class="font-medium">{{ plan.summary?.unresolvedBooks ?? 0 }}</span> · Duplicate matches:
            <span class="font-medium" :class="(plan.summary?.duplicateBookMatches ?? 0) > 0 ? 'text-red-600' : ''">
              {{ plan.summary?.duplicateBookMatches ?? 0 }}
            </span>
          </p>
          <div v-if="unresolvedSummary.length > 0" class="space-y-1 text-xs text-muted-foreground">
            <p class="font-medium text-foreground">Unresolved summary</p>
            <p v-for="[reason, count] in unresolvedSummary" :key="reason">{{ reason }}: {{ count }}</p>
          </div>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <div class="flex items-center gap-2">
        <span class="settings-group-label mb-0">Step 4 · Start Migration</span>
        <span v-if="stepStatus.migration === 'done'" class="text-xs text-emerald-600">Completed</span>
        <span v-else-if="stepStatus.migration === 'running'" class="text-xs text-sky-600">Running</span>
        <span v-else-if="stepStatus.migration === 'failed'" class="text-xs text-red-600">Failed</span>
      </div>
      <div class="rounded-lg border border-border bg-card p-4 space-y-4">
        <div class="rounded border border-border bg-muted/20 p-3 text-xs space-y-1.5">
          <p class="font-medium text-foreground">Preflight checks</p>
          <p v-if="preflight.ready" class="text-emerald-600">All checks passed - ready to migrate</p>
          <template v-else>
            <div v-if="preflight.sourceValidated" class="flex items-center gap-1.5 text-emerald-600">
              <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />
              Source validated
            </div>
            <div v-else class="flex items-center gap-1.5 text-muted-foreground">
              <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
              {{ !source ? 'Save and validate source connection' : 'Validate source connection' }}
            </div>
            <div v-if="profile" class="flex items-center gap-1.5 text-emerald-600">
              <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />
              Mappings saved
            </div>
            <div v-else class="flex items-center gap-1.5 text-muted-foreground">
              <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
              Save user and path mappings
            </div>
            <div v-if="profile && preflight.pathMappingsValidated" class="flex items-center gap-1.5 text-emerald-600">
              <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />
              Path mappings validated
            </div>
            <div v-else-if="profile" class="flex items-center gap-1.5 text-muted-foreground">
              <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
              Save path mappings to validate them
            </div>
            <div v-if="preflight.dryRunFresh" class="flex items-center gap-1.5 text-emerald-600">
              <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />
              Dry-run is up to date
            </div>
            <div v-else class="flex items-center gap-1.5 text-muted-foreground">
              <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
              Run a fresh dry-run
            </div>
          </template>
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="settings-btn-primary" :disabled="busy.startingRun || !preflight.ready" @click="onStartMigration">
            <Loader2 v-if="busy.startingRun" class="size-3.5 animate-spin" />
            Start Migration
          </button>
          <button class="settings-btn-outline" :disabled="busy.loadingProgress || run == null" @click="refreshRunProgress">
            <Loader2 v-if="busy.loadingProgress" class="size-3.5 animate-spin" />
            Refresh Status
          </button>
        </div>

        <div v-if="run" class="rounded border border-border bg-muted/30 px-4 py-3.5 flex items-center gap-3 text-xs">
          <span class="inline-flex rounded-full border px-2 py-0.5" :class="runStateClass(run.state)">{{ run.state }}</span>
          <span class="text-muted-foreground">
            {{
              run.state === 'running'
                ? `Stage: ${run.currentStage ?? 'initializing'}`
                : run.endedAt
                  ? `Ended ${new Date(run.endedAt).toLocaleString()}`
                  : ''
            }}
          </span>
          <span v-if="run.state !== 'running'" class="text-muted-foreground ml-auto">See Step 5 for the full report</span>
        </div>
      </div>
    </section>

    <section class="space-y-4">
      <span class="settings-group-label">Step 5 · Migration Report</span>

      <div v-if="!run" class="rounded-lg border border-border bg-card p-4">
        <p class="text-sm text-muted-foreground">No migration run yet. Complete the steps above to start.</p>
      </div>

      <div v-else class="rounded-lg border border-border bg-card p-4 space-y-6">
        <!-- Run header -->
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-0.5">
            <p class="flex items-center gap-2 text-sm font-medium">
              Run #{{ run.id }}
              <span class="inline-flex rounded-full border px-2 py-0.5 text-xs" :class="runStateClass(run.state)">{{ run.state }}</span>
            </p>
            <p class="text-xs text-muted-foreground">
              {{ run.startedAt ? new Date(run.startedAt).toLocaleString() : 'Not started' }}
              <template v-if="reportData.durationMs != null"> &middot; {{ formatDuration(reportData.durationMs) }}</template>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button class="settings-btn-outline" :disabled="busy.loadingReport" @click="onRefreshReport">
              <Loader2 v-if="busy.loadingReport" class="size-3.5 animate-spin" />
              {{ runReport ? 'Reload Report' : 'Load Full Report' }}
            </button>
            <button class="settings-btn-outline" :disabled="busy.exporting" @click="onExportJson">Export JSON</button>
            <button class="settings-btn-outline" :disabled="busy.exporting" @click="onExportCsv">Export CSV</button>
          </div>
        </div>

        <!-- Error (if failed) -->
        <div v-if="run.errorMessage" class="rounded border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 space-y-0.5">
          <p class="font-medium">Migration failed</p>
          <p>{{ run.errorMessage }}</p>
        </div>

        <!-- Stats grid — available from runProgress or full report -->
        <template v-if="runReport || runProgress">
          <div class="grid gap-3 sm:grid-cols-2">
            <!-- Books card -->
            <div class="rounded border border-border p-3 space-y-2">
              <p class="text-sm font-semibold">Books</p>
              <div class="space-y-1.5 text-xs">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Metadata overlays applied</span>
                  <span class="font-medium">{{ reportData.bookMetadata?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Author mappings replaced</span>
                  <span class="font-medium">{{ reportData.bookAuthors?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Narrator mappings replaced</span>
                  <span class="font-medium">{{ reportData.bookNarrators?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Genre mappings replaced</span>
                  <span class="font-medium">{{ reportData.bookGenres?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Tag mappings replaced</span>
                  <span class="font-medium">{{ reportData.bookTags?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between" :class="reportData.coversSkippedAll ? 'text-amber-600' : ''">
                  <span>Covers imported</span>
                  <span class="font-medium">{{ reportData.bookCovers?.imported ?? 0 }}</span>
                </div>
                <p v-if="reportData.coversSkippedAll" class="text-amber-600 leading-tight">
                  Cover import was skipped - media root path is not configured on the source
                </p>
                <div v-if="reportData.unresolvedBooks.length > 0" class="flex justify-between text-amber-600">
                  <span>Could not match</span>
                  <span class="font-medium">{{ reportData.unresolvedBooks.length }}</span>
                </div>
              </div>
            </div>

            <!-- User data card -->
            <div class="rounded border border-border p-3 space-y-2">
              <p class="text-sm font-semibold">User Data</p>
              <div class="space-y-1.5 text-xs">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Reading statuses</span>
                  <span class="font-medium">{{ reportData.userBookStatus?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Reading progress entries</span>
                  <span class="font-medium">{{ reportData.readingProgress?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Audiobook progress entries</span>
                  <span class="font-medium">{{ reportData.audiobookProgress?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Bookmarks</span>
                  <span class="font-medium">{{ reportData.bookmarks?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Annotations</span>
                  <span class="font-medium">{{ reportData.annotations?.imported ?? 0 }}</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Collection entries</span>
                  <span class="font-medium">{{ reportData.collections?.imported ?? 0 }}</span>
                </div>
              </div>
            </div>
          </div>

          <p v-if="!runReport && (run.state === 'completed' || run.state === 'failed')" class="text-xs text-muted-foreground">
            Click "Load Full Report" to include the dry-run match summary in the exported report.
          </p>
        </template>

        <!-- Full report: aggregate issues from current plan/report only. -->
        <template v-if="runReport">
          <div
            v-if="run.state === 'completed' && reportData.unresolvedBooks.length === 0 && reportData.coverFailureCount === 0"
            class="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700"
          >
            Migration completed with no unresolved books or failures.
          </div>

          <div v-if="reportData.unresolvedBooks.length > 0" class="space-y-2">
            <div>
              <p class="text-sm font-semibold text-amber-600">Unresolved books ({{ reportData.unresolvedBooks.length }})</p>
              <p class="text-xs text-muted-foreground mt-0.5">
                These books exist in the source but could not be matched to any book in your library.
              </p>
            </div>
            <div class="space-y-1.5 max-h-64 overflow-y-auto">
              <div
                v-for="book in reportData.unresolvedBooks"
                :key="book.sourceBookId"
                class="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs"
              >
                <p class="font-medium text-foreground">{{ book.title || `Source book ${book.sourceBookId}` }}</p>
                <p class="text-muted-foreground mt-0.5">{{ friendlyUnresolvedReason(book.reason) }}</p>
              </div>
            </div>
          </div>

          <div v-if="reportData.coverFailureCount > 0" class="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700">
            {{ reportData.coverFailureCount }} cover import(s) failed. Detailed failure rows are not stored.
          </div>
        </template>
      </div>
    </section>
  </div>
</template>
