<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDateTime } from '@/i18n/formatters'
import { Eye, EyeOff, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import SettingsPageHeader from './SettingsPageHeader.vue'
import MigrationStepper from '@/features/migration/components/MigrationStepper.vue'
import SearchableUserSelect from '@/features/migration/components/SearchableUserSelect.vue'
import type { StepDefinition } from '@/features/migration/components/MigrationStepper.vue'
import { api } from '@/lib/api'
import {
  cancelRun,
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
  resolveDuplicateMatches,
  retryRun,
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
import { useMigrationPolling } from '@/features/migration/composables/useMigrationPolling'
import { useMigrationProgress } from '@/features/migration/composables/useMigrationProgress'

const { t } = useI18n()

const { subscribeRun, unsubscribeRun, getProgress: getSocketProgress, progressMap: socketProgressMap } = useMigrationProgress()

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
  author: string | null
  reason: string | null
}

const loading = ref(true)
const supportedTypes = ref<string[]>([])
const targetUsers = ref<TargetUser[]>([])
const targetLibraryFolders = ref<Array<{ libraryName: string; path: string }>>([])
const sourcePathPrefixes = ref<string[]>([])
const mediaPathTestState = ref<'idle' | 'pass' | 'fail'>('idle')
const mediaPathTestMessage = ref<string | null>(null)

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
  testingMediaPath: false,
  savingSource: false,
  loadingSuggestions: false,
  loadingTargetUsers: false,
  savingProfile: false,
  dryRun: false,
  startingRun: false,
  cancellingRun: false,
  retryingRun: false,
  loadingProgress: false,
  loadingReport: false,
  exporting: false,
  resolvingDuplicates: false,
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
const mediaRootPathHint = computed(() => {
  const path = sourceDraft.mediaRootPath.trim()
  if (!path) {
    return {
      className: 'text-amber-600',
      text: t('settings.admin.migration.mediaPathRequired'),
    }
  }
  if (!path.startsWith('/')) {
    return {
      className: 'text-amber-600',
      text: t('settings.admin.migration.mediaPathAbsolute'),
    }
  }
  return {
    className: 'text-muted-foreground',
    text: t('settings.admin.migration.mediaPathConfigured'),
  }
})

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

  if (!currentSource) issues.push(t('settings.admin.migration.issueSaveSource'))
  else if (!sourceValidated) issues.push(t('settings.admin.migration.issueValidateSource'))
  if (!currentProfile) issues.push(t('settings.admin.migration.issueSaveMappings'))
  else if (!pathMappingsValidated) issues.push(t('settings.admin.migration.issueSavePathMappings'))
  if (!dryRunFresh) issues.push(t('settings.admin.migration.issueFreshDryRun'))
  else if ((currentPlan?.summary?.duplicateBookMatches ?? 0) > 0 || currentPlan?.summary?.status === 'blocked') {
    issues.push(t('settings.admin.migration.issueResolveDuplicates'))
  }
  if (hasActiveRun.value) issues.push(t('settings.admin.migration.issueWaitActiveRun'))

  return { sourceValidated, pathMappingsValidated, dryRunFresh, ready: issues.length === 0, issues }
})

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

const stepperSteps = computed<StepDefinition[]>(() => {
  const s = stepStatus.value
  return [
    {
      label: t('settings.admin.migration.stepSourceConnection'),
      status: s.source === 'done' ? 'done' : s.source === 'saved' ? 'saved' : 'pending',
    },
    { label: t('settings.admin.migration.stepUserPathMapping'), status: s.mappings },
    { label: t('settings.admin.migration.stepDryRun'), status: s.dryRun },
    { label: t('settings.admin.migration.stepRunMigration'), status: s.migration },
    { label: t('settings.admin.migration.stepReport'), status: run.value ? 'done' : 'pending' },
  ]
})

const activeStepIndex = computed(() => {
  const s = stepStatus.value
  if (s.migration === 'running' || s.migration === 'failed') return 3
  if (run.value) return 4
  if (s.dryRun === 'done') return 3
  if (s.mappings === 'done') return 2
  if (s.source === 'done' || s.source === 'saved') return 1
  return 0
})

const currentStep = ref(0)

watch(activeStepIndex, (newVal) => {
  const shouldHoldSourceStep = busy.savingSource && currentStep.value === 0 && newVal === 1
  const shouldHoldMappingsStep = busy.savingProfile && currentStep.value === 1 && newVal === 2
  const shouldHoldDryRunStep = busy.dryRun && currentStep.value === 2 && newVal === 3
  if (shouldHoldSourceStep || shouldHoldMappingsStep || shouldHoldDryRunStep) return
  if (newVal > currentStep.value) {
    currentStep.value = newVal
  }
})

watch(
  () => [
    sourceDraft.mediaRootPath,
    sourceDraft.host,
    sourceDraft.port,
    sourceDraft.user,
    sourceDraft.password,
    sourceDraft.database,
    sourceDraft.ssl,
  ],
  () => {
    mediaPathTestState.value = 'idle'
    mediaPathTestMessage.value = null
  },
)

function onStepClick(index: number) {
  currentStep.value = index
}

function goNext() {
  if (currentStep.value < 4) currentStep.value++
}

function goPrev() {
  if (currentStep.value > 0) currentStep.value--
}

function goToSetup() {
  currentStep.value = 0
}

const stepTitles = computed(() => [
  t('settings.admin.migration.stepSourceConnection'),
  t('settings.admin.migration.stepUserPathMapping'),
  t('settings.admin.migration.stepDryRunTitle'),
  t('settings.admin.migration.stepRunMigration'),
  t('settings.admin.migration.stepReportTitle'),
])
const stepSubtitles = computed(() => [
  t('settings.admin.migration.subtitleSource'),
  t('settings.admin.migration.subtitleMappings'),
  t('settings.admin.migration.subtitleDryRun'),
  t('settings.admin.migration.subtitleRun'),
  t('settings.admin.migration.subtitleReport'),
])
const continueLabels = computed(() => [
  t('settings.admin.migration.continueToMappings'),
  t('settings.admin.migration.continueToDryRun'),
  t('settings.admin.migration.continueToMigration'),
  t('settings.admin.migration.viewReport'),
  '',
])

const currentStepTitle = computed(() => stepTitles.value[currentStep.value] ?? '')
const currentStepSubtitle = computed(() => stepSubtitles.value[currentStep.value] ?? '')
const continueLabel = computed(() => continueLabels.value[currentStep.value] ?? '')

const currentStepBadge = computed((): { label: string; cls: string } | null => {
  const s = stepStatus.value
  const n = currentStep.value
  if (n === 0) {
    if (s.source === 'done')
      return { label: t('settings.admin.migration.badgeValidated'), cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' }
    if (s.source === 'saved') return { label: t('settings.admin.migration.badgeSaved'), cls: 'text-amber-700 bg-amber-500/10 border-amber-500/20' }
  }
  if (n === 1 && s.mappings === 'done')
    return { label: t('settings.admin.migration.badgeSaved'), cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' }
  if (n === 2 && s.dryRun === 'done')
    return { label: t('settings.admin.migration.badgeUpToDate'), cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' }
  if (n === 3) {
    if (s.migration === 'done')
      return { label: t('settings.admin.migration.badgeCompleted'), cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' }
    if (s.migration === 'running') return { label: t('settings.admin.migration.badgeRunning'), cls: 'text-sky-700 bg-sky-500/10 border-sky-500/20' }
    if (s.migration === 'failed') return { label: t('settings.admin.migration.badgeFailed'), cls: 'text-red-700 bg-red-500/10 border-red-500/20' }
  }
  return null
})

const unresolvedSummary = computed(() => Object.entries(plan.value?.summary?.unresolvedByReason ?? {}))

interface DuplicateBookMatch {
  targetBookId: number
  sourceBookIds: string[]
  strategies: string[]
  sourceCandidates?: Array<{
    sourceBookId: string
    title: string | null
    author: string | null
    filePath: string | null
    strategy: string
  }>
  reason: string
}

const duplicateMatches = computed<DuplicateBookMatch[]>(() => {
  const raw = plan.value?.plan
  if (!raw || typeof raw !== 'object') return []
  const planData = raw as Record<string, unknown>
  return Array.isArray(planData.duplicateBookMatches) ? planData.duplicateBookMatches : []
})

const duplicateResolutions = ref<Map<number, string>>(new Map())
const duplicateTargetBookLabels = ref<Map<number, string>>(new Map())
const duplicateGroupsRemaining = computed(() => duplicateMatches.value.filter((dup) => !duplicateResolutions.value.has(dup.targetBookId)).length)

const STRATEGY_PRIORITY: Record<string, number> = {
  isbn: 40,
  file_hash: 30,
  path_mapping: 20,
  title_author: 10,
}

function strategyForSource(dup: DuplicateBookMatch, sourceId: string): string | null {
  const candidateStrategy = dup.sourceCandidates?.find((candidate) => candidate.sourceBookId === sourceId)?.strategy
  if (typeof candidateStrategy === 'string' && candidateStrategy.length > 0) return candidateStrategy
  const index = dup.sourceBookIds.indexOf(sourceId)
  if (index < 0) return null
  const strategy = dup.strategies[index]
  return typeof strategy === 'string' ? strategy : null
}

function sourceBookLabel(dup: DuplicateBookMatch, sourceId: string): string {
  const candidate = dup.sourceCandidates?.find((row) => row.sourceBookId === sourceId)
  const title = candidate?.title?.trim()
  if (title) return title
  return t('settings.admin.migration.sourceRecordId', { id: sourceId })
}

function sourceBookSecondary(dup: DuplicateBookMatch, sourceId: string): string | null {
  const candidate = dup.sourceCandidates?.find((row) => row.sourceBookId === sourceId)
  const author = candidate?.author?.trim()
  if (author) return t('settings.admin.migration.byAuthorWithId', { author, id: sourceId })
  const filePath = candidate?.filePath?.trim()
  if (filePath) return t('settings.admin.migration.filePathWithId', { path: filePath, id: sourceId })
  return t('settings.admin.migration.bookloreSourceId', { id: sourceId })
}

function recommendedSourceBookId(dup: DuplicateBookMatch): string | null {
  let bestScore = Number.NEGATIVE_INFINITY
  let bestSourceId: string | null = null
  let tie = false

  for (const sourceId of dup.sourceBookIds) {
    const strategy = strategyForSource(dup, sourceId)
    const score = strategy ? (STRATEGY_PRIORITY[strategy] ?? 0) : 0

    if (score > bestScore) {
      bestScore = score
      bestSourceId = sourceId
      tie = false
      continue
    }
    if (score === bestScore) tie = true
  }

  if (!bestSourceId || tie) return null
  return bestSourceId
}

function isRecommendedSourceBook(dup: DuplicateBookMatch, sourceId: string): boolean {
  return recommendedSourceBookId(dup) === sourceId
}

function targetBookLabel(targetBookId: number): string {
  return duplicateTargetBookLabels.value.get(targetBookId) ?? t('settings.admin.migration.libraryBookNum', { id: targetBookId })
}

function pruneDuplicateResolutions() {
  const activeTargetIds = new Set(duplicateMatches.value.map((dup) => dup.targetBookId))
  const keptResolutions = new Map<number, string>()
  const keptLabels = new Map<number, string>()

  for (const [targetBookId, sourceBookId] of duplicateResolutions.value) {
    if (activeTargetIds.has(targetBookId)) keptResolutions.set(targetBookId, sourceBookId)
  }
  for (const [targetBookId, label] of duplicateTargetBookLabels.value) {
    if (activeTargetIds.has(targetBookId)) keptLabels.set(targetBookId, label)
  }

  duplicateResolutions.value = keptResolutions
  duplicateTargetBookLabels.value = keptLabels
}

function applyRecommendedDuplicateSelections() {
  const next = new Map(duplicateResolutions.value)
  for (const dup of duplicateMatches.value) {
    if (next.has(dup.targetBookId)) continue
    const recommendedSource = recommendedSourceBookId(dup)
    if (!recommendedSource) continue
    next.set(dup.targetBookId, recommendedSource)
  }
  duplicateResolutions.value = next
}

async function loadDuplicateTargetBookLabels() {
  const missingTargetIds = [...new Set(duplicateMatches.value.map((dup) => dup.targetBookId))].filter(
    (targetBookId) => !duplicateTargetBookLabels.value.has(targetBookId),
  )
  if (missingTargetIds.length === 0) return

  const rows = await Promise.all(
    missingTargetIds.map(async (targetBookId) => {
      try {
        const response = await api(`/api/v1/books/${targetBookId}`)
        if (!response.ok) return [targetBookId, t('settings.admin.migration.libraryBookNum', { id: targetBookId })] as const
        const payload = asRecord(await response.json())
        return [targetBookId, asString(payload.title) ?? t('settings.admin.migration.libraryBookNum', { id: targetBookId })] as const
      } catch {
        return [targetBookId, t('settings.admin.migration.libraryBookNum', { id: targetBookId })] as const
      }
    }),
  )

  const next = new Map(duplicateTargetBookLabels.value)
  for (const [targetBookId, label] of rows) next.set(targetBookId, label)
  duplicateTargetBookLabels.value = next
}

watch(
  duplicateMatches,
  () => {
    pruneDuplicateResolutions()
    applyRecommendedDuplicateSelections()
    void loadDuplicateTargetBookLabels()
  },
  { immediate: true },
)

const reportData = computed(() => {
  const metrics = runReport.value?.metrics ?? runProgress.value?.metrics ?? []
  const m = (stage: string, entity: string) => metrics.find((r) => r.stage === stage && r.entityType === entity) ?? null
  const bookCovers = m('book_covers', 'book_covers')
  const coversSkippedAll =
    !!bookCovers && bookCovers.imported === 0 && bookCovers.skipped > 0 && bookCovers.unresolved === 0 && bookCovers.failed === 0
  const unresolvedBooks = runReport.value?.details.unresolvedBooks ?? extractPlanUnresolvedBooks(runReport.value?.plan ?? plan.value?.plan ?? null)
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
    matchedBooks: runReport.value?.details.matchedBooks ?? [],
    userPreview: runReport.value?.details.userPreview ?? [],
    unresolvedBooks,
    coverFailureCount: bookCovers?.failed ?? 0,
  }
})

const STAGE_NAMES = ['shared_overlays', 'book_covers', 'user_state'] as const

const migrationProgress = computed(() => {
  const currentRun = run.value
  if (!currentRun || currentRun.state !== 'running') return null

  const currentStage = currentRun.currentStage ?? 'init'
  if (currentStage === 'completed') return { percent: 100, label: t('settings.admin.migration.stageCompleted') }

  const stageIdx = STAGE_NAMES.indexOf(currentStage as (typeof STAGE_NAMES)[number])
  const completedStages = stageIdx >= 0 ? stageIdx : 0
  const stageWeight = 100 / STAGE_NAMES.length
  const percent = Math.min(Math.round(completedStages * stageWeight + stageWeight * 0.5), 99)

  const stageLabels: Record<string, string> = {
    init: t('settings.admin.migration.stageInit'),
    shared_overlays: t('settings.admin.migration.stageSharedOverlays'),
    book_covers: t('settings.admin.migration.stageBookCovers'),
    user_state: t('settings.admin.migration.stageUserState'),
  }

  return { percent, label: stageLabels[currentStage] ?? currentStage }
})

watch(socketProgressMap, () => {
  const currentRun = run.value
  if (!currentRun) return
  const socketData = getSocketProgress(currentRun.id)
  if (!socketData) return

  runProgress.value = {
    run: { ...currentRun, state: socketData.state, currentStage: socketData.currentStage },
    totals: socketData.totals,
    metrics: socketData.metrics as MigrationRunProgress['metrics'],
  }
  if (socketData.state !== 'running') {
    unsubscribeRun(currentRun.id)
    void refreshWorkflowState()
  }
})

const { pollingError, retry: onRetryPolling } = useMigrationPolling({
  runState: computed(() => run.value?.state),
  pollFn: async () => {
    const currentRun = run.value
    if (!currentRun) return
    // Only poll if no fresh socket data is available
    const socketData = getSocketProgress(currentRun.id)
    if (socketData) {
      runProgress.value = {
        run: { ...run.value!, state: socketData.state, currentStage: socketData.currentStage },
        totals: socketData.totals,
        metrics: socketData.metrics as MigrationRunProgress['metrics'],
      }
      if (socketData.state !== 'running') {
        unsubscribeRun(currentRun.id)
        await refreshWorkflowState()
      }
      return
    }
    busy.loadingProgress = true
    try {
      runProgress.value = await getRunProgress(currentRun.id)
      if (runProgress.value.run.state !== 'running') {
        await refreshWorkflowState()
      }
    } finally {
      busy.loadingProgress = false
    }
  },
  intervalMs: 5000,
})

onMounted(async () => {
  await initialize()
})

async function initialize() {
  loading.value = true
  try {
    await Promise.all([loadSupportedTypes(), loadTargetUsers(), loadTargetLibraryFolders()])
    await refreshWorkflowState()
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorInitialize')))
  } finally {
    loading.value = false
  }
}

async function loadSupportedTypes() {
  try {
    supportedTypes.value = await listSupportedSourceTypes()
  } catch (error) {
    supportedTypes.value = []
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorLoadSourceTypes')))
  }
}

async function loadTargetUsers() {
  busy.loadingTargetUsers = true
  try {
    targetUsers.value = await listTargetUsers()
  } catch (error) {
    targetUsers.value = []
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorLoadTargetUsers')))
  } finally {
    busy.loadingTargetUsers = false
  }
}

async function loadTargetLibraryFolders() {
  try {
    targetLibraryFolders.value = await listTargetLibraryFolders()
  } catch (error) {
    targetLibraryFolders.value = []
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorLoadLibraryFolders')))
  }
}

async function refreshWorkflowState() {
  workflowState.value = await getWorkflowState()
  hydrateSourceDraft()
  hydratePathMappings()
  hydrateUserMappingsFromProfile()
  if (source.value?.lastValidatedAt) {
    if (targetUsers.value.length === 0) await loadTargetUsers()
    await hydrateUserMappingsFromSuggestions(false)
    await autoLoadPathPrefixes()
  }
  if (run.value?.state === 'running') {
    subscribeRun(run.value.id)
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
  sourceDraft.password = asString(cfg.password) ?? ''
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
    const fallbackSingleTargetUserId = targetUsers.value.length === 1 ? (targetUsers.value[0]?.id ?? null) : null

    userMappings.value = response.suggestions.map((row) => ({
      sourceUserId: row.sourceUserId,
      username: row.username,
      targetUserId: savedMappings.get(row.sourceUserId) ?? row.suggestedTargetUserId ?? fallbackSingleTargetUserId,
    }))

    if (showSuccessToast) {
      if (userMappings.value.length === 0) {
        toast.warning(t('settings.admin.migration.noSourceUsersReturned'))
      } else {
        toast.success(t('settings.admin.migration.userMappingSuggestionsLoaded'))
      }
    }
  } catch (error) {
    if (showSuccessToast) {
      toast.error(getErrorMessage(error, t('settings.admin.migration.errorLoadSuggestions')))
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

function extractWarningStrings(result: Record<string, unknown>): string[] {
  return Array.isArray(result.warnings) ? (result.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : []
}

function extractMediaPathWarnings(result: Record<string, unknown>): string[] {
  return extractWarningStrings(result).filter((warning) => /mediarootpath/i.test(warning))
}

async function onTestSource() {
  if (!hasValidSourceDraft()) {
    toast.error(t('settings.admin.migration.requiredFields'))
    return
  }

  busy.testingSource = true
  try {
    const result = await testSource({ type: sourceDraft.type, connectionConfig: buildSourceConnectionConfig() })
    const missing = Array.isArray(result.missingTables) ? result.missingTables.length : 0
    const warnings = extractWarningStrings(result)
    if (result.ok === true) {
      if (warnings.length > 0) {
        const mediaPathWarning = warnings.find((warning) => /mediarootpath/i.test(warning))
        const highlightedWarning = mediaPathWarning ?? warnings[0] ?? t('settings.admin.migration.connectionTestPassedWithWarnings')
        toast.warning(
          warnings.length === 1
            ? highlightedWarning
            : t('settings.admin.migration.connectionTestPassedWithCount', { count: warnings.length, first: highlightedWarning }),
        )
      } else {
        toast.success(t('settings.admin.migration.connectionTestPassed'))
      }
    } else {
      toast.warning(t('settings.admin.migration.connectionOkMissingTables', { count: missing }))
    }
  } catch (error) {
    toast.error(friendlyConnectionError(error))
  } finally {
    busy.testingSource = false
  }
}

async function onTestMediaPath() {
  if (hasActiveRun.value) {
    toast.error(t('settings.admin.migration.cannotTestMediaPathActiveRun'))
    return
  }
  if (!hasValidSourceDraft()) {
    toast.error(t('settings.admin.migration.requiredFields'))
    return
  }
  const mediaRootPath = sourceDraft.mediaRootPath.trim()
  if (!mediaRootPath) {
    mediaPathTestState.value = 'fail'
    const message = t('settings.admin.migration.mediaRootPathRequiredCover')
    mediaPathTestMessage.value = message
    toast.error(message)
    return
  }
  if (!mediaRootPath.startsWith('/')) {
    mediaPathTestState.value = 'fail'
    const message = t('settings.admin.migration.useAbsolutePath')
    mediaPathTestMessage.value = message
    toast.error(message)
    return
  }

  busy.testingMediaPath = true
  try {
    const result = await testSource({ type: sourceDraft.type, connectionConfig: buildSourceConnectionConfig() })
    const mediaWarnings = extractMediaPathWarnings(result)
    if (result.ok === true && mediaWarnings.length === 0) {
      mediaPathTestState.value = 'pass'
      mediaPathTestMessage.value = t('settings.admin.migration.mediaPathVerified')
      toast.success(t('settings.admin.migration.mediaPathValidReadable'))
    } else if (mediaWarnings.length > 0) {
      mediaPathTestState.value = 'fail'
      const message = mediaWarnings[0] ?? t('settings.admin.migration.mediaPathValidationFailed')
      mediaPathTestMessage.value = message
      toast.warning(message)
    } else {
      mediaPathTestState.value = 'fail'
      const message = t('settings.admin.migration.connectionFailedBeforeMediaPath')
      mediaPathTestMessage.value = message
      toast.warning(message)
    }
  } catch (error) {
    mediaPathTestState.value = 'fail'
    const message = friendlyConnectionError(error)
    mediaPathTestMessage.value = message
    toast.error(message)
  } finally {
    busy.testingMediaPath = false
  }
}

async function onSaveAndValidate() {
  if (hasActiveRun.value) {
    toast.error(t('settings.admin.migration.cannotModifySourceActiveRun'))
    return
  }
  if (!hasValidSourceDraft()) {
    toast.error(t('settings.admin.migration.requiredFields'))
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
      toast.success(
        warnings.length > 0
          ? t('settings.admin.migration.sourceSavedValidatedWarnings', { count: warnings.length })
          : t('settings.admin.migration.sourceSavedValidated'),
      )
    }
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorSaveValidateSource')))
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
  await loadTargetUsers()
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
    toast.error(t('settings.admin.migration.cannotSaveMappingsActiveRun'))
    return
  }
  const currentSource = source.value
  if (!currentSource) {
    toast.error(t('settings.admin.migration.saveSourceFirst'))
    return
  }

  const mappings = cleanedUserMappings()
  if (mappings.length === 0) {
    toast.error(t('settings.admin.migration.mapAtLeastOneUser'))
    return
  }
  if (mappings.length !== userMappings.value.length) {
    toast.error(t('settings.admin.migration.mapEveryUser'))
    return
  }

  busy.savingProfile = true
  try {
    const cleanedPaths = cleanedPathMappings()
    if (cleanedPaths.length > 0) {
      try {
        pathValidation.value = await validatePathMappings(currentSource.id, { pathMappings: cleanedPaths, sampleLimit: 10 })
      } catch (pathError) {
        toast.warning(getErrorMessage(pathError, t('settings.admin.migration.pathValidationFailedProfileSaved')))
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
          pathMappingsHash: pathValidation.value?.pathMappingsHash ?? getPersistedPathMappingsHash(profile.value),
          suggestionsLoadedAt: suggestionsLoadedAt.value,
        },
      },
    })
    await refreshWorkflowState()
    toast.success(t('settings.admin.migration.mappingsSaved'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorSaveMappings')))
  } finally {
    busy.savingProfile = false
  }
}

async function onRunDryRun() {
  if (hasActiveRun.value) {
    toast.error(t('settings.admin.migration.cannotRunDryRunActiveRun'))
    return
  }
  const currentProfile = profile.value
  if (!currentProfile) {
    toast.error(t('settings.admin.migration.saveMappingsFirst'))
    return
  }

  busy.dryRun = true
  try {
    const artifact = await createDryRunPlan({ profileId: currentProfile.id })
    await refreshWorkflowState()
    const matched = artifact.summary?.matchedBooks ?? 0
    const unresolved = artifact.summary?.unresolvedBooks ?? 0
    toast.success(t('settings.admin.migration.dryRunCompleted', { matched, unresolved }))
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.dryRunFailed')))
  } finally {
    busy.dryRun = false
  }
}

function handleDuplicateSelection(targetBookId: number, sourceBookId: string) {
  duplicateResolutions.value.set(targetBookId, sourceBookId)
}

async function onResolveDuplicates() {
  const currentPlan = plan.value
  if (!currentPlan) return

  const matches = duplicateMatches.value
  if (matches.length === 0) return

  const unresolved = matches.filter((m) => !duplicateResolutions.value.has(m.targetBookId))
  if (unresolved.length > 0) {
    toast.error(t('settings.admin.migration.selectSourceForAllGroups', { count: unresolved.length }))
    return
  }

  busy.resolvingDuplicates = true
  try {
    const resolutions = matches.map((m) => ({
      targetBookId: m.targetBookId,
      selectedSourceBookId: duplicateResolutions.value.get(m.targetBookId)!,
    }))
    await resolveDuplicateMatches(currentPlan.id, resolutions)
    duplicateResolutions.value = new Map()
    await refreshWorkflowState()
    toast.success(t('settings.admin.migration.duplicatesResolved'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorResolveDuplicates')))
  } finally {
    busy.resolvingDuplicates = false
  }
}

const confirmingMigrationStart = ref(false)

async function onStartMigration() {
  if (!preflight.value.ready) {
    toast.error(preflight.value.issues[0] ?? t('settings.admin.migration.preflightNotReady'))
    return
  }
  const currentPlan = plan.value
  if (!currentPlan) {
    toast.error(t('settings.admin.migration.runDryRunFirst'))
    return
  }

  if (!confirmingMigrationStart.value) {
    confirmingMigrationStart.value = true
    return
  }

  confirmingMigrationStart.value = false
  busy.startingRun = true
  try {
    await startLiveRun({ planArtifactId: currentPlan.id })
    await refreshWorkflowState()
    await refreshRunProgress()
    toast.success(t('settings.admin.migration.runStarted'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorStartMigration')))
  } finally {
    busy.startingRun = false
  }
}

function onCancelMigrationStart() {
  confirmingMigrationStart.value = false
}

async function onCancelRun() {
  const currentRun = run.value
  if (!currentRun) return
  busy.cancellingRun = true
  try {
    await cancelRun(currentRun.id)
    await refreshWorkflowState()
    toast.success(t('settings.admin.migration.runCancelled'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorCancelMigration')))
  } finally {
    busy.cancellingRun = false
  }
}

async function onRetryRun() {
  const currentRun = run.value
  if (!currentRun) return
  busy.retryingRun = true
  try {
    await retryRun(currentRun.id)
    await refreshWorkflowState()
    toast.success(t('settings.admin.migration.runRetried'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorRetryMigration')))
  } finally {
    busy.retryingRun = false
  }
}

async function refreshRunProgress() {
  const currentRun = run.value
  if (!currentRun) return

  busy.loadingProgress = true
  try {
    runProgress.value = await getRunProgress(currentRun.id)
    if (runProgress.value.run.state !== 'running') {
      await refreshWorkflowState()
    }
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorLoadRunProgress')))
  } finally {
    busy.loadingProgress = false
  }
}

async function onRefreshReport() {
  const currentRun = run.value
  if (!currentRun) {
    toast.error(t('settings.admin.migration.startMigrationFirst'))
    return
  }

  busy.loadingReport = true
  try {
    runReport.value = await getRunReport(currentRun.id)
    toast.success(t('settings.admin.migration.reportRefreshed'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorLoadReport')))
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
    toast.error(t('settings.admin.migration.startMigrationFirst'))
    return
  }

  busy.exporting = true
  try {
    const exported = await exportRunReport(currentRun.id, format)
    downloadTextFile(exported.fileName, exported.content, exported.contentType)
    toast.success(t('settings.admin.migration.reportExported', { format: format.toUpperCase() }))
  } catch (error) {
    toast.error(getErrorMessage(error, t('settings.admin.migration.errorExportReport')))
  } finally {
    busy.exporting = false
  }
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
  if (reason === 'no_title_author_match') return t('settings.admin.migration.reasonNoTitleAuthorMatch')
  if (reason === 'no_file_path_match') return t('settings.admin.migration.reasonNoFilePathMatch')
  if (reason === 'no_file_hash_match') return t('settings.admin.migration.reasonNoFileHashMatch')
  if (reason === 'no_isbn_match') return t('settings.admin.migration.reasonNoIsbnMatch')
  if (reason === 'insufficient_source_data') return t('settings.admin.migration.reasonInsufficientSourceData')
  if (reason === 'ambiguous_isbn_match') return t('settings.admin.migration.reasonAmbiguousIsbnMatch')
  if (reason === 'ambiguous_file_hash_match') return t('settings.admin.migration.reasonAmbiguousFileHashMatch')
  if (reason === 'ambiguous_file_path_match') return t('settings.admin.migration.reasonAmbiguousFilePathMatch')
  if (reason === 'ambiguous_title_author_match') return t('settings.admin.migration.reasonAmbiguousTitleAuthorMatch')
  return reason ?? t('settings.admin.migration.reasonUnknown')
}

function friendlyMatchStrategy(strategy: string | null): string {
  if (strategy === 'isbn') return t('settings.admin.migration.strategyIsbn')
  if (strategy === 'file_hash') return t('settings.admin.migration.strategyFileHash')
  if (strategy === 'path_mapping') return t('settings.admin.migration.strategyPathMapping')
  if (strategy === 'title_author') return t('settings.admin.migration.strategyTitleAuthor')
  return strategy ?? t('settings.admin.migration.strategyUnavailable')
}

function describeUserPreviewCounts(counts: {
  statuses: number
  fileProgress: number
  bookmarks: number
  annotations: number
  shelves: number
}): string {
  return t('settings.admin.migration.userPreviewCounts', {
    statuses: counts.statuses,
    progress: counts.fileProgress,
    bookmarks: counts.bookmarks,
    annotations: counts.annotations,
    collections: counts.shelves,
  })
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
        author: null as string | null,
        reason: asString(record.reason),
      }
    })
    .filter((row): row is ReportUnresolvedBook => row != null)
}

function friendlyConnectionError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED|ENOTFOUND|connect ETIMEDOUT/i.test(msg)) return t('settings.admin.migration.connErrorUnreachable')
  if (/Access denied|authentication failed/i.test(msg)) return t('settings.admin.migration.connErrorAuth')
  if (/Unknown database/i.test(msg)) return t('settings.admin.migration.connErrorUnknownDatabase')
  if (/ETIMEDOUT|timeout/i.test(msg)) return t('settings.admin.migration.connErrorTimeout')
  return msg || t('settings.admin.migration.connErrorGeneric')
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

function getPersistedPathMappingsHash(currentProfile: MigrationProfile | null): string | null {
  if (!currentProfile) return null
  const scope = asRecord(currentProfile.scope)
  const preflightScope = asRecord(scope.preflight)
  return asString(preflightScope.pathMappingsHash)
}

function hasValidatedPathMappings(currentProfile: MigrationProfile | null): boolean {
  if (!currentProfile) return false
  if (currentProfile.pathMappings.length === 0) return true
  return getPersistedPathValidatedAt(currentProfile) != null && getPersistedPathMappingsHash(currentProfile) != null
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
  <SettingsPageHeader :title="t('settings.admin.migration.title')" :subtitle="t('settings.admin.migration.subtitle')" />

  <div v-if="loading" class="flex items-center justify-center py-16">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
  </div>

  <div v-else class="flex gap-10 items-start">
    <!-- Sidebar stepper (desktop) -->
    <aside class="hidden lg:block w-44 shrink-0 pt-1">
      <p class="settings-group-label mb-2">{{ t('settings.admin.migration.progress') }}</p>
      <MigrationStepper :steps="stepperSteps" :active-index="currentStep" @step-click="onStepClick" />
    </aside>

    <!-- Content area -->
    <div class="flex-1 min-w-0">
      <!-- Mobile progress -->
      <div class="lg:hidden mb-4 flex items-center gap-3">
        <div class="flex-1 h-1 rounded-full bg-muted overflow-hidden">
          <div class="h-full rounded-full bg-primary transition-all duration-300" :style="{ width: `${(currentStep / 4) * 100}%` }" />
        </div>
        <span class="text-xs text-muted-foreground shrink-0">{{ currentStep + 1 }} / 5</span>
      </div>

      <!-- Unified step card -->
      <div class="rounded-lg border border-border bg-card shadow-xs overflow-hidden">
        <!-- Card header -->
        <div class="px-6 pt-6 pb-5 border-b border-border">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h2 class="font-serif font-semibold text-foreground text-lg tracking-tight">{{ currentStepTitle }}</h2>
              <p class="text-xs text-muted-foreground mt-1">{{ currentStepSubtitle }}</p>
            </div>
            <span
              v-if="currentStepBadge"
              class="shrink-0 mt-0.5 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium"
              :class="currentStepBadge.cls"
              >{{ currentStepBadge.label }}</span
            >
          </div>
        </div>

        <!-- Card body -->
        <div class="px-6 py-6">
          <!-- Step 0: Source Connection -->
          <div v-if="currentStep === 0" class="space-y-3">
            <div class="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
              <label class="block">
                <span class="settings-hint">{{ t('settings.admin.migration.sourceType') }}</span>
                <select v-model="sourceDraft.type" class="select-field mt-1 w-full" :disabled="hasActiveRun">
                  <option v-for="type in supportedTypes" :key="type" :value="type">{{ type }}</option>
                </select>
              </label>
              <label class="block">
                <span class="settings-hint">{{ t('settings.admin.migration.sourceName') }}</span>
                <input v-model="sourceDraft.name" class="input-field mt-1 w-full" placeholder="Booklore Import" :disabled="hasActiveRun" />
              </label>
              <label class="block">
                <span class="settings-hint">{{ t('settings.admin.migration.host') }}</span>
                <input v-model="sourceDraft.host" class="input-field mt-1 w-full" placeholder="127.0.0.1" :disabled="hasActiveRun" />
              </label>
              <label class="block">
                <span class="settings-hint">{{ t('settings.admin.migration.port') }}</span>
                <input v-model.number="sourceDraft.port" class="input-field mt-1 w-full" type="number" min="1" max="65535" :disabled="hasActiveRun" />
              </label>
              <label class="block">
                <span class="settings-hint">{{ t('settings.admin.migration.user') }}</span>
                <input v-model="sourceDraft.user" class="input-field mt-1 w-full" placeholder="booklore" :disabled="hasActiveRun" />
              </label>
              <label class="block">
                <span class="settings-hint">{{ t('settings.admin.migration.password') }}</span>
                <div class="relative mt-1">
                  <input
                    v-model="sourceDraft.password"
                    class="input-field w-full pr-9"
                    :type="showPassword ? 'text' : 'password'"
                    :placeholder="
                      source ? t('settings.admin.migration.passwordSavedPlaceholder') : t('settings.admin.migration.passwordEmptyPlaceholder')
                    "
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
                <span class="settings-hint">{{ t('settings.admin.migration.database') }}</span>
                <input v-model="sourceDraft.database" class="input-field mt-1 w-full" placeholder="booklore" :disabled="hasActiveRun" />
              </label>
              <label class="block md:col-span-2 xl:col-span-2">
                <span class="settings-hint">{{ t('settings.admin.migration.mediaRootPath') }}</span>
                <div class="mt-1 flex items-center gap-2">
                  <input v-model="sourceDraft.mediaRootPath" class="input-field w-full" placeholder="/data/booklore/media" :disabled="hasActiveRun" />
                  <button
                    type="button"
                    :disabled="busy.testingMediaPath || hasActiveRun"
                    class="inline-flex h-9 items-center rounded-md border px-2.5 text-xs font-medium transition-colors disabled:opacity-50"
                    :class="
                      mediaPathTestState === 'pass'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20'
                        : mediaPathTestState === 'fail'
                          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20'
                          : 'border-border bg-background text-foreground hover:bg-muted'
                    "
                    @click="onTestMediaPath"
                  >
                    <Loader2 v-if="busy.testingMediaPath" class="size-3.5 animate-spin" />
                    <span v-else>
                      {{
                        mediaPathTestState === 'pass'
                          ? t('settings.admin.migration.pathOk')
                          : mediaPathTestState === 'fail'
                            ? t('settings.admin.migration.pathIssue')
                            : t('settings.admin.migration.testPath')
                      }}
                    </span>
                  </button>
                </div>
                <p class="mt-1 text-xs" :class="mediaRootPathHint.className">{{ mediaRootPathHint.text }}</p>
                <p v-if="mediaPathTestMessage" class="mt-1 text-xs" :class="mediaPathTestState === 'pass' ? 'text-emerald-700' : 'text-amber-700'">
                  {{ mediaPathTestMessage }}
                </p>
              </label>
              <div class="flex items-center">
                <label class="flex h-9 cursor-pointer items-center gap-2">
                  <input v-model="sourceDraft.ssl" type="checkbox" class="size-4 rounded border-border" :disabled="hasActiveRun" />
                  <span class="settings-hint">{{ t('settings.admin.migration.useTls') }}</span>
                </label>
              </div>
            </div>

            <div class="flex flex-wrap gap-2">
              <button class="settings-btn-outline" :disabled="busy.testingSource || hasActiveRun" @click="onTestSource">
                <Loader2 v-if="busy.testingSource" class="size-3.5 animate-spin" />
                {{ t('settings.admin.migration.testConnection') }}
              </button>
              <button class="settings-btn-primary" :disabled="busy.savingSource || hasActiveRun" @click="onSaveAndValidate">
                <Loader2 v-if="busy.savingSource" class="size-3.5 animate-spin" />
                {{ t('settings.admin.migration.saveAndValidate') }}
              </button>
            </div>

            <div
              v-if="sourceValidationWarnings.length > 0"
              class="rounded border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 space-y-1"
            >
              <p class="font-medium">{{ t('settings.admin.migration.sourceValidatedWithWarnings') }}</p>
              <p v-for="warn in sourceValidationWarnings" :key="warn">{{ warn }}</p>
            </div>

            <div v-if="sourceCapabilities" class="rounded border border-border bg-muted/40 p-3 text-xs space-y-2">
              <p class="font-medium text-foreground">{{ t('settings.admin.migration.lastValidationSnapshot') }}</p>
              <p class="text-muted-foreground">
                {{
                  t('settings.admin.migration.sourceVersion', { version: sourceCapabilities.sourceVersion ?? t('settings.admin.migration.unknown') })
                }}
              </p>
              <p v-if="sourceCapabilities.missingTables.length > 0" class="text-amber-600">
                {{ t('settings.admin.migration.missingRequiredTables', { tables: sourceCapabilities.missingTables.join(', ') }) }}
              </p>
              <div v-if="sourceRowCounts.length > 0" class="grid gap-1 text-muted-foreground sm:grid-cols-2 xl:grid-cols-3">
                <p v-for="[key, count] in sourceRowCounts" :key="key">{{ formatSourceCountLabel(key) }}: {{ count }}</p>
              </div>
            </div>
          </div>

          <!-- Step 1: User & Path Mapping -->
          <div v-else-if="currentStep === 1" class="space-y-5">
            <div class="flex items-center gap-2">
              <p class="text-xs text-muted-foreground">{{ t('settings.admin.migration.suggestionsAutoLoad') }}</p>
              <button
                v-if="source"
                class="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
                :disabled="busy.loadingSuggestions || busy.loadingTargetUsers || hasActiveRun"
                @click="onReloadSuggestions"
              >
                <Loader2 v-if="busy.loadingSuggestions || busy.loadingTargetUsers" class="size-3 animate-spin inline" />
                {{ t('settings.admin.migration.refresh') }}
              </button>
            </div>

            <div class="overflow-x-auto rounded border border-border">
              <table class="w-full text-sm">
                <thead class="bg-muted/40 text-left">
                  <tr>
                    <th class="px-3 py-2 font-medium">{{ t('settings.admin.migration.sourceUser') }}</th>
                    <th class="px-3 py-2 font-medium">{{ t('settings.admin.migration.targetUser') }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in userMappings" :key="row.sourceUserId" class="border-t border-border">
                    <td class="px-3 py-2">
                      <p class="font-medium">{{ row.username }}</p>
                      <p class="text-xs text-muted-foreground">{{ row.sourceUserId }}</p>
                    </td>
                    <td class="px-3 py-2">
                      <SearchableUserSelect v-model="row.targetUserId" :users="targetUsers" :disabled="hasActiveRun" />
                    </td>
                  </tr>
                  <tr v-if="userMappings.length === 0" class="border-t border-border">
                    <td colspan="2" class="px-3 py-4 text-sm text-muted-foreground">{{ t('settings.admin.migration.noSourceUsersLoaded') }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-if="!busy.loadingTargetUsers && targetUsers.length === 0" class="text-xs text-amber-600">
              {{ t('settings.admin.migration.noActiveTargetUsers') }}
            </p>

            <div class="space-y-2">
              <div class="flex items-center justify-between">
                <p class="settings-hint">{{ t('settings.admin.migration.pathPrefixMappings') }}</p>
                <button class="settings-btn-outline" :disabled="hasActiveRun" @click="addPathMapping">
                  {{ t('settings.admin.migration.addMapping') }}
                </button>
              </div>
              <p class="text-xs text-muted-foreground">
                {{ t('settings.admin.migration.pathMappingsHelp1') }} <code class="font-mono">/books/Large</code>
                {{ t('settings.admin.migration.pathMappingsHelp2') }} <code class="font-mono">/srv/bookorbit/books/Large</code
                >{{ t('settings.admin.migration.pathMappingsHelp3') }}
              </p>

              <div v-for="(row, index) in pathMappings" :key="index" class="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center">
                <select v-model="row.sourcePrefix" class="select-field w-full min-w-0" :disabled="hasActiveRun">
                  <option value="">
                    {{
                      sourcePathPrefixes.length === 0
                        ? t('settings.admin.migration.noPrefixesFound')
                        : t('settings.admin.migration.selectSourcePrefix')
                    }}
                  </option>
                  <option v-for="prefix in sourcePathPrefixes" :key="prefix" :value="prefix">{{ prefix }}</option>
                </select>

                <select v-model="row.targetPrefix" class="select-field w-full min-w-0" :disabled="hasActiveRun">
                  <option value="">{{ t('settings.admin.migration.selectTargetFolder') }}</option>
                  <option v-for="folder in targetLibraryFolders" :key="folder.path" :value="folder.path">
                    {{ folder.libraryName }} - {{ folder.path }}
                  </option>
                </select>

                <button class="settings-btn-outline" :disabled="hasActiveRun" @click="removePathMapping(index)">
                  {{ t('settings.admin.migration.remove') }}
                </button>
              </div>
            </div>

            <div v-if="pathValidation" class="rounded border border-border bg-muted/40 p-3 text-xs space-y-1">
              <p class="font-medium text-foreground">{{ t('settings.admin.migration.pathValidation') }}</p>
              <p class="text-muted-foreground">
                {{
                  t('settings.admin.migration.pathValidationMapped', {
                    mapped: pathValidation.summary.mappedByPrefix,
                    total: pathValidation.summary.booksWithFilePath,
                  })
                }}
              </p>
              <p v-if="pathValidation.summary.unmatchedTargetPaths > 0" class="text-amber-600">
                {{ t('settings.admin.migration.pathValidationUnmatched', { count: pathValidation.summary.unmatchedTargetPaths }) }}
              </p>
              <p v-else-if="pathValidation.summary.matchedTargetPaths > 0" class="text-emerald-600">
                {{ t('settings.admin.migration.pathValidationAllMatched', { count: pathValidation.summary.matchedTargetPaths }) }}
              </p>
            </div>

            <button class="settings-btn-primary" :disabled="busy.savingProfile || source == null || hasActiveRun" @click="onSaveMappings">
              <Loader2 v-if="busy.savingProfile" class="size-3.5 animate-spin" />
              {{ t('settings.admin.migration.saveMappings') }}
            </button>
          </div>

          <!-- Step 2: Dry Run -->
          <div v-else-if="currentStep === 2" class="space-y-5">
            <button class="settings-btn-primary" :disabled="busy.dryRun || profile == null || hasActiveRun" @click="onRunDryRun">
              <Loader2 v-if="busy.dryRun" class="size-3.5 animate-spin" />
              {{ t('settings.admin.migration.runDryRun') }}
            </button>

            <div v-if="plan" class="rounded border border-border bg-muted/30 p-3 space-y-2 text-sm">
              <p>
                {{ t('settings.admin.migration.matched') }} <span class="font-medium">{{ plan.summary?.matchedBooks ?? 0 }}</span> ·
                {{ t('settings.admin.migration.unresolved') }}
                <span class="font-medium">{{ plan.summary?.unresolvedBooks ?? 0 }}</span> · {{ t('settings.admin.migration.duplicateMatches') }}
                <span class="font-medium" :class="(plan.summary?.duplicateBookMatches ?? 0) > 0 ? 'text-red-600' : ''">
                  {{ plan.summary?.duplicateBookMatches ?? 0 }}
                </span>
              </p>
              <div v-if="unresolvedSummary.length > 0" class="space-y-1 text-xs text-muted-foreground">
                <p class="font-medium text-foreground">{{ t('settings.admin.migration.unresolvedSummary') }}</p>
                <p v-for="[reason, count] in unresolvedSummary" :key="reason">{{ friendlyUnresolvedReason(reason) }}: {{ count }}</p>
              </div>

              <div v-if="duplicateMatches.length > 0" class="space-y-3 border-t border-border pt-3">
                <div class="space-y-1">
                  <p class="font-medium text-red-600">{{ t('settings.admin.migration.resolveDuplicateMatches') }}</p>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.admin.migration.resolveDuplicateHint') }}
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ t('settings.admin.migration.remainingGroups') }}
                    <span class="font-medium text-foreground">{{ duplicateGroupsRemaining }}</span>
                    {{ t('settings.admin.migration.ofCount', { count: duplicateMatches.length }) }}
                  </p>
                </div>
                <div class="space-y-3">
                  <div v-for="dup in duplicateMatches" :key="dup.targetBookId" class="rounded border border-border bg-background p-3 space-y-2">
                    <p class="text-xs font-medium text-foreground">{{ targetBookLabel(dup.targetBookId) }}</p>
                    <p class="text-[11px] text-muted-foreground">{{ t('settings.admin.migration.targetBookNum', { id: dup.targetBookId }) }}</p>
                    <div class="space-y-1">
                      <label
                        v-for="sourceId in dup.sourceBookIds"
                        :key="sourceId"
                        class="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50 cursor-pointer"
                      >
                        <div class="flex min-w-0 items-center gap-2">
                          <input
                            type="radio"
                            :name="`dup-${dup.targetBookId}`"
                            :value="sourceId"
                            :checked="duplicateResolutions.get(dup.targetBookId) === sourceId"
                            class="accent-primary"
                            @change="() => handleDuplicateSelection(dup.targetBookId, sourceId)"
                          />
                          <div class="min-w-0">
                            <p class="truncate">{{ sourceBookLabel(dup, sourceId) }}</p>
                            <p v-if="sourceBookSecondary(dup, sourceId)" class="truncate text-[11px] text-muted-foreground">
                              {{ sourceBookSecondary(dup, sourceId) }}
                            </p>
                          </div>
                          <span
                            v-if="isRecommendedSourceBook(dup, sourceId)"
                            class="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-700"
                          >
                            {{ t('settings.admin.migration.recommended') }}
                          </span>
                        </div>
                        <span class="text-muted-foreground text-[11px] whitespace-nowrap">{{
                          friendlyMatchStrategy(strategyForSource(dup, sourceId))
                        }}</span>
                      </label>
                    </div>
                  </div>
                </div>
                <button
                  class="settings-btn-primary"
                  :disabled="busy.resolvingDuplicates || duplicateResolutions.size < duplicateMatches.length"
                  @click="onResolveDuplicates"
                >
                  <Loader2 v-if="busy.resolvingDuplicates" class="size-3.5 animate-spin" />
                  {{ t('settings.admin.migration.resolveDuplicatesButton', { count: duplicateMatches.length }, duplicateMatches.length) }}
                </button>
              </div>
            </div>
          </div>

          <!-- Step 3: Run Migration -->
          <div v-else-if="currentStep === 3" class="space-y-5">
            <div class="rounded border border-border bg-muted/20 p-3 text-xs space-y-1.5">
              <p class="font-medium text-foreground">{{ t('settings.admin.migration.preflightChecks') }}</p>
              <p v-if="preflight.ready" class="text-emerald-600">{{ t('settings.admin.migration.allChecksPassed') }}</p>
              <template v-else>
                <div v-if="preflight.sourceValidated" class="flex items-center gap-1.5 text-emerald-600">
                  <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />
                  {{ t('settings.admin.migration.checkSourceValidated') }}
                </div>
                <div v-else class="flex items-center gap-1.5 text-muted-foreground">
                  <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
                  {{ !source ? t('settings.admin.migration.checkSaveValidateSource') : t('settings.admin.migration.checkValidateSource') }}
                </div>
                <div v-if="profile" class="flex items-center gap-1.5 text-emerald-600">
                  <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />
                  {{ t('settings.admin.migration.checkMappingsSaved') }}
                </div>
                <div v-else class="flex items-center gap-1.5 text-muted-foreground">
                  <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
                  {{ t('settings.admin.migration.checkSaveMappings') }}
                </div>
                <div v-if="profile && preflight.pathMappingsValidated" class="flex items-center gap-1.5 text-emerald-600">
                  <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />
                  {{ t('settings.admin.migration.checkPathMappingsValidated') }}
                </div>
                <div v-else-if="profile" class="flex items-center gap-1.5 text-muted-foreground">
                  <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
                  {{ t('settings.admin.migration.checkSavePathMappings') }}
                </div>
                <div v-if="preflight.dryRunFresh" class="flex items-center gap-1.5 text-emerald-600">
                  <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />
                  {{ t('settings.admin.migration.checkDryRunUpToDate') }}
                </div>
                <div v-else class="flex items-center gap-1.5 text-muted-foreground">
                  <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
                  {{ t('settings.admin.migration.checkFreshDryRun') }}
                </div>
              </template>
            </div>

            <div class="flex flex-wrap gap-2">
              <template v-if="confirmingMigrationStart">
                <span class="text-xs text-amber-600 self-center">{{ t('settings.admin.migration.startConfirmPrompt') }}</span>
                <button class="settings-btn-primary" :disabled="busy.startingRun" @click="onStartMigration">
                  <Loader2 v-if="busy.startingRun" class="size-3.5 animate-spin" />
                  {{ t('settings.admin.migration.confirmStart') }}
                </button>
                <button class="settings-btn-outline" @click="onCancelMigrationStart">{{ t('common.cancel') }}</button>
              </template>
              <template v-else>
                <button class="settings-btn-primary" :disabled="busy.startingRun || !preflight.ready" @click="onStartMigration">
                  <Loader2 v-if="busy.startingRun" class="size-3.5 animate-spin" />
                  {{ t('settings.admin.migration.startMigration') }}
                </button>
              </template>
              <button v-if="run?.state === 'running'" class="settings-btn-outline text-red-600" :disabled="busy.cancellingRun" @click="onCancelRun">
                <Loader2 v-if="busy.cancellingRun" class="size-3.5 animate-spin" />
                {{ t('settings.admin.migration.cancelRun') }}
              </button>
              <button class="settings-btn-outline" :disabled="busy.loadingProgress || run == null" @click="refreshRunProgress">
                <Loader2 v-if="busy.loadingProgress" class="size-3.5 animate-spin" />
                {{ t('settings.admin.migration.refreshStatus') }}
              </button>
            </div>

            <div
              v-if="pollingError"
              class="rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 flex items-center gap-2 text-xs text-amber-700"
            >
              <span>{{ t('settings.admin.migration.statusPollingStopped') }}</span>
              <button class="underline font-medium" @click="onRetryPolling">{{ t('settings.admin.migration.retry') }}</button>
            </div>

            <div v-if="run" class="rounded border border-border bg-muted/30 px-4 py-3.5 flex items-center gap-3 text-xs">
              <span class="inline-flex rounded-full border px-2 py-0.5" :class="runStateClass(run.state)">{{ run.state }}</span>
              <span class="text-muted-foreground">
                {{
                  run.state === 'running'
                    ? t('settings.admin.migration.stageLabel', { stage: run.currentStage ?? t('settings.admin.migration.stageInitializing') })
                    : run.endedAt
                      ? t('settings.admin.migration.endedLabel', { date: formatDateTime(new Date(run.endedAt)) })
                      : ''
                }}
              </span>
              <button v-if="run.state !== 'running'" class="text-xs text-primary underline-offset-2 hover:underline ml-auto" @click="goNext">
                {{ t('settings.admin.migration.viewReport') }}
              </button>
            </div>

            <div v-if="migrationProgress" class="space-y-1.5">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{{ migrationProgress.label }}</span>
                <span>{{ migrationProgress.percent }}%</span>
              </div>
              <div class="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                  :style="{ width: `${migrationProgress.percent}%` }"
                />
              </div>
            </div>
          </div>

          <!-- Step 4: Migration Report -->
          <div v-else-if="currentStep === 4" class="space-y-5">
            <p v-if="!run" class="text-sm text-muted-foreground">{{ t('settings.admin.migration.noRunYet') }}</p>

            <template v-else>
              <!-- Run header -->
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="space-y-0.5">
                  <p class="flex items-center gap-2 text-sm font-medium">
                    {{ t('settings.admin.migration.runNum', { id: run.id }) }}
                    <span class="inline-flex rounded-full border px-2 py-0.5 text-xs" :class="runStateClass(run.state)">{{ run.state }}</span>
                  </p>
                  <p class="text-xs text-muted-foreground">
                    {{ run.startedAt ? formatDateTime(new Date(run.startedAt)) : t('settings.admin.migration.notStarted') }}
                    <template v-if="reportData.durationMs != null"> &middot; {{ formatDuration(reportData.durationMs) }}</template>
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <button class="settings-btn-outline" :disabled="busy.loadingReport" @click="onRefreshReport">
                    <Loader2 v-if="busy.loadingReport" class="size-3.5 animate-spin" />
                    {{ runReport ? t('settings.admin.migration.reloadReport') : t('settings.admin.migration.loadFullReport') }}
                  </button>
                  <button class="settings-btn-outline" :disabled="busy.exporting" @click="onExportJson">
                    {{ t('settings.admin.migration.exportJson') }}
                  </button>
                  <button class="settings-btn-outline" :disabled="busy.exporting" @click="onExportCsv">
                    {{ t('settings.admin.migration.exportCsv') }}
                  </button>
                </div>
              </div>

              <!-- Error (if failed) -->
              <div v-if="run.errorMessage" class="rounded border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 space-y-2">
                <div class="space-y-0.5">
                  <p class="font-medium">{{ t('settings.admin.migration.migrationFailed') }}</p>
                  <p>{{ run.errorMessage }}</p>
                </div>
                <button v-if="run.state === 'failed'" class="settings-btn-outline text-xs" :disabled="busy.retryingRun" @click="onRetryRun">
                  <Loader2 v-if="busy.retryingRun" class="size-3.5 animate-spin" />
                  {{ t('settings.admin.migration.retryFromLastStage') }}
                </button>
              </div>

              <!-- Stats grid — available from runProgress or full report -->
              <template v-if="runReport || runProgress">
                <div class="grid gap-3 sm:grid-cols-2">
                  <!-- Books card -->
                  <div class="rounded border border-border p-3 space-y-2">
                    <p class="text-sm font-semibold">{{ t('settings.admin.migration.booksCard') }}</p>
                    <div class="space-y-1.5 text-xs">
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.metadataOverlaysApplied') }}</span>
                        <span class="font-medium">{{ reportData.bookMetadata?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.authorMappingsReplaced') }}</span>
                        <span class="font-medium">{{ reportData.bookAuthors?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.narratorMappingsReplaced') }}</span>
                        <span class="font-medium">{{ reportData.bookNarrators?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.genreMappingsReplaced') }}</span>
                        <span class="font-medium">{{ reportData.bookGenres?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.tagMappingsReplaced') }}</span>
                        <span class="font-medium">{{ reportData.bookTags?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between" :class="reportData.coversSkippedAll ? 'text-amber-600' : ''">
                        <span>{{ t('settings.admin.migration.coversImported') }}</span>
                        <span class="font-medium">{{ reportData.bookCovers?.imported ?? 0 }}</span>
                      </div>
                      <p v-if="reportData.coversSkippedAll" class="text-amber-600 leading-tight">
                        {{ t('settings.admin.migration.coverImportSkipped') }}
                      </p>
                      <div v-if="reportData.unresolvedBooks.length > 0" class="flex justify-between text-amber-600">
                        <span>{{ t('settings.admin.migration.couldNotMatch') }}</span>
                        <span class="font-medium">{{ reportData.unresolvedBooks.length }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- User data card -->
                  <div class="rounded border border-border p-3 space-y-2">
                    <p class="text-sm font-semibold">{{ t('settings.admin.migration.userDataCard') }}</p>
                    <div class="space-y-1.5 text-xs">
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.readingStatuses') }}</span>
                        <span class="font-medium">{{ reportData.userBookStatus?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.readingProgressEntries') }}</span>
                        <span class="font-medium">{{ reportData.readingProgress?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.audiobookProgressEntries') }}</span>
                        <span class="font-medium">{{ reportData.audiobookProgress?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.bookmarksLabel') }}</span>
                        <span class="font-medium">{{ reportData.bookmarks?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.annotationsLabel') }}</span>
                        <span class="font-medium">{{ reportData.annotations?.imported ?? 0 }}</span>
                      </div>
                      <div class="flex justify-between">
                        <span class="text-muted-foreground">{{ t('settings.admin.migration.collectionEntries') }}</span>
                        <span class="font-medium">{{ reportData.collections?.imported ?? 0 }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <p v-if="!runReport && (run.state === 'completed' || run.state === 'failed')" class="text-xs text-muted-foreground">
                  {{ t('settings.admin.migration.loadFullReportHint') }}
                </p>
              </template>

              <!-- Full report: aggregate issues from current plan/report only. -->
              <template v-if="runReport">
                <div
                  v-if="run.state === 'completed' && reportData.unresolvedBooks.length === 0 && reportData.coverFailureCount === 0"
                  class="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700"
                >
                  {{ t('settings.admin.migration.completedNoIssues') }}
                </div>

                <div v-if="reportData.matchedBooks.length > 0" class="space-y-2">
                  <div>
                    <p class="text-sm font-semibold">
                      {{ t('settings.admin.migration.matchedBooksHeading', { count: reportData.matchedBooks.length }) }}
                    </p>
                    <p class="text-xs text-muted-foreground mt-0.5">
                      {{ t('settings.admin.migration.matchedBooksHint') }}
                    </p>
                  </div>
                  <div class="space-y-1.5 max-h-56 overflow-y-auto">
                    <div
                      v-for="book in reportData.matchedBooks"
                      :key="`${book.sourceBookId}-${book.targetBookId}`"
                      class="rounded border border-border px-3 py-2 text-xs"
                    >
                      <p class="font-medium text-foreground">
                        {{ book.sourceTitle || t('settings.admin.migration.sourceBookFallback', { id: book.sourceBookId }) }}
                      </p>
                      <p v-if="book.sourceAuthor" class="text-muted-foreground mt-0.5">{{ book.sourceAuthor }}</p>
                      <p class="text-muted-foreground mt-0.5">
                        {{ friendlyMatchStrategy(book.strategy) }} -
                        {{ book.targetTitle || t('settings.admin.migration.libraryBookFallback', { id: book.targetBookId }) }}
                      </p>
                    </div>
                  </div>
                </div>

                <div v-if="reportData.unresolvedBooks.length > 0" class="space-y-2">
                  <div>
                    <p class="text-sm font-semibold text-amber-600">
                      {{ t('settings.admin.migration.unresolvedBooksHeading', { count: reportData.unresolvedBooks.length }) }}
                    </p>
                    <p class="text-xs text-muted-foreground mt-0.5">
                      {{ t('settings.admin.migration.unresolvedBooksHint') }}
                    </p>
                  </div>
                  <div class="space-y-1.5 max-h-64 overflow-y-auto">
                    <div
                      v-for="book in reportData.unresolvedBooks"
                      :key="book.sourceBookId"
                      class="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs"
                    >
                      <p class="font-medium text-foreground">
                        {{ book.title || t('settings.admin.migration.sourceBookFallback', { id: book.sourceBookId }) }}
                      </p>
                      <p v-if="book.author" class="text-muted-foreground mt-0.5">{{ book.author }}</p>
                      <p class="text-muted-foreground mt-0.5">{{ friendlyUnresolvedReason(book.reason) }}</p>
                    </div>
                  </div>
                </div>

                <div v-if="reportData.userPreview.length > 0" class="space-y-2">
                  <div>
                    <p class="text-sm font-semibold">
                      {{ t('settings.admin.migration.mappedUsersHeading', { count: reportData.userPreview.length }) }}
                    </p>
                    <p class="text-xs text-muted-foreground mt-0.5">{{ t('settings.admin.migration.mappedUsersHint') }}</p>
                  </div>
                  <div class="space-y-1.5">
                    <div
                      v-for="preview in reportData.userPreview"
                      :key="`${preview.sourceUserId}-${preview.targetUserId}`"
                      class="rounded border border-border px-3 py-2 text-xs"
                    >
                      <p class="font-medium text-foreground">{{ preview.username }}</p>
                      <p class="text-muted-foreground mt-0.5">{{ describeUserPreviewCounts(preview.counts) }}</p>
                    </div>
                  </div>
                </div>

                <div v-if="reportData.coverFailureCount > 0" class="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700">
                  {{ t('settings.admin.migration.coverImportsFailed', { count: reportData.coverFailureCount }) }}
                </div>
              </template>
            </template>
          </div>
        </div>

        <!-- Card footer -->
        <div class="px-6 py-4 border-t border-border bg-muted/30 flex items-center justify-between">
          <button v-if="currentStep > 0" class="settings-btn-outline" @click="goPrev">{{ t('common.back') }}</button>
          <div v-else />
          <button v-if="currentStep < 4" class="settings-btn-primary" @click="goNext">{{ continueLabel }}</button>
          <button v-else class="settings-btn-outline" @click="goToSetup">{{ t('settings.admin.migration.backToSetup') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
