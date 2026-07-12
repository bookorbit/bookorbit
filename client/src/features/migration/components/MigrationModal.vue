<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDateTime } from '@/i18n/formatters'
import { Eye, EyeOff, Loader2, X, ChevronLeft, ChevronRight, Check, AlertCircle, RotateCcw } from '@lucide/vue'
import { toast } from 'vue-sonner'
import SearchableUserSelect from './SearchableUserSelect.vue'
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
import { useMigrationSetupReset } from '@/features/migration/composables/useMigrationSetupReset'

interface StepDefinition {
  label: string
  status: 'pending' | 'done' | 'active' | 'running' | 'failed' | 'saved'
}

const emit = defineEmits<{ close: [] }>()

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

const DEFAULT_SOURCE_DRAFT = {
  type: 'booklore',
  name: 'Booklore',
  host: '',
  port: 3306,
  user: '',
  password: '',
  database: '',
  ssl: false,
  mediaRootPath: '',
}

const sourceDraft = reactive({ ...DEFAULT_SOURCE_DRAFT })

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
const sourceIdForReset = computed(() => source.value?.id ?? null)
const canResetSetup = computed(() => source.value != null && run.value == null && !hasActiveRun.value)
const sourceCapabilities = computed<MigrationSourceCapabilities | null>(() => source.value?.capabilities ?? null)
const sourceValidationWarnings = computed(() => sourceCapabilities.value?.warnings ?? [])
const sourceRowCounts = computed(() => Object.entries(sourceCapabilities.value?.counts ?? {}).sort(([left], [right]) => left.localeCompare(right)))
const mediaRootPathHint = computed(() => {
  const path = sourceDraft.mediaRootPath.trim()
  if (!path) {
    return {
      className: 'text-amber-600',
      text: t('migration.source.mediaPath.hintRequired'),
    }
  }
  if (!path.startsWith('/')) {
    return {
      className: 'text-amber-600',
      text: t('migration.source.mediaPath.hintAbsolute'),
    }
  }
  return {
    className: 'text-muted-foreground',
    text: t('migration.source.mediaPath.hintConfigured'),
  }
})

const { resettingSource, resetSetup: onResetSetup } = useMigrationSetupReset({
  sourceId: sourceIdForReset,
  canResetSetup,
  resetLocalState: resetLocalMigrationState,
  refreshWorkflowState,
  notifySuccess: toast.success,
  notifyError: toast.error,
  getErrorMessage,
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

  if (!currentSource) issues.push(t('migration.preflight.issues.saveSource'))
  else if (!sourceValidated) issues.push(t('migration.preflight.issues.validateSource'))
  if (!currentProfile) issues.push(t('migration.preflight.issues.saveMappings'))
  else if (!pathMappingsValidated) issues.push(t('migration.preflight.issues.savePathMappings'))
  if (!dryRunFresh) issues.push(t('migration.preflight.issues.freshDryRun'))
  else if ((currentPlan?.summary?.duplicateBookMatches ?? 0) > 0 || currentPlan?.summary?.status === 'blocked') {
    issues.push(t('migration.preflight.issues.resolveDuplicates'))
  }
  if (hasActiveRun.value) issues.push(t('migration.preflight.issues.waitForRun'))

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
    { label: t('migration.steps.source.short'), status: s.source === 'done' ? 'done' : s.source === 'saved' ? 'saved' : 'pending' },
    { label: t('migration.steps.mappings.short'), status: s.mappings },
    { label: t('migration.steps.dryRun.short'), status: s.dryRun },
    { label: t('migration.steps.migration.short'), status: s.migration },
    { label: t('migration.steps.report.short'), status: run.value ? 'done' : 'pending' },
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
  if (newVal > currentStep.value) currentStep.value = newVal
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

function onBackOrCancel() {
  if (currentStep.value > 0) goPrev()
  else handleClose()
}

const stepTitles = computed(() => [
  t('migration.steps.source.title'),
  t('migration.steps.mappings.title'),
  t('migration.steps.dryRun.title'),
  t('migration.steps.migration.title'),
  t('migration.steps.report.title'),
])
const stepSubtitles = computed(() => [
  t('migration.steps.source.subtitle'),
  t('migration.steps.mappings.subtitle'),
  t('migration.steps.dryRun.subtitle'),
  t('migration.steps.migration.subtitle'),
  t('migration.steps.report.subtitle'),
])
const continueLabels = computed(() => [
  t('migration.footer.continueToMappings'),
  t('migration.footer.continueToDryRun'),
  t('migration.footer.continueToMigration'),
  t('migration.footer.viewReport'),
  '',
])

const currentStepTitle = computed(() => stepTitles.value[currentStep.value] ?? '')
const currentStepSubtitle = computed(() => stepSubtitles.value[currentStep.value] ?? '')
const continueLabel = computed(() => continueLabels.value[currentStep.value] ?? '')

const currentStepBadge = computed((): { label: string; cls: string } | null => {
  const s = stepStatus.value
  const n = currentStep.value
  if (n === 0) {
    if (s.source === 'done') return { label: t('migration.badge.validated'), cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' }
    if (s.source === 'saved') return { label: t('migration.status.saved'), cls: 'text-amber-700 bg-amber-500/10 border-amber-500/20' }
  }
  if (n === 1 && s.mappings === 'done') return { label: t('migration.status.saved'), cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' }
  if (n === 2 && s.dryRun === 'done') return { label: t('migration.badge.upToDate'), cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' }
  if (n === 3) {
    if (s.migration === 'done') return { label: t('migration.badge.completed'), cls: 'text-emerald-700 bg-emerald-500/10 border-emerald-500/20' }
    if (s.migration === 'running') return { label: t('migration.status.running'), cls: 'text-sky-700 bg-sky-500/10 border-sky-500/20' }
    if (s.migration === 'failed') return { label: t('migration.status.failed'), cls: 'text-red-700 bg-red-500/10 border-red-500/20' }
  }
  return null
})

function stepIndicatorClass(index: number): string {
  const step = stepperSteps.value[index]
  if (!step) return 'bg-muted-foreground/15 text-muted-foreground/60'
  if (step.status === 'done') return 'bg-primary text-primary-foreground'
  if (step.status === 'failed') return 'bg-red-500 text-white'
  if (step.status === 'running') return 'bg-sky-500 text-white'
  if (index === currentStep.value) return 'bg-primary/15 text-primary ring-1 ring-primary'
  if (step.status === 'saved') return 'bg-amber-500/15 text-amber-600'
  return 'bg-muted-foreground/15 text-muted-foreground/60'
}

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
  return t('migration.duplicates.sourceRecordId', { id: sourceId })
}

function sourceBookSecondary(dup: DuplicateBookMatch, sourceId: string): string | null {
  const candidate = dup.sourceCandidates?.find((row) => row.sourceBookId === sourceId)
  const author = candidate?.author?.trim()
  if (author) return t('migration.duplicates.byAuthor', { author, id: sourceId })
  const filePath = candidate?.filePath?.trim()
  if (filePath) return t('migration.duplicates.byFilePath', { filePath, id: sourceId })
  return t('migration.duplicates.bookloreSourceId', { id: sourceId })
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
  return duplicateTargetBookLabels.value.get(targetBookId) ?? t('migration.duplicates.libraryBookId', { id: targetBookId })
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
        if (!response.ok) return [targetBookId, t('migration.duplicates.libraryBookId', { id: targetBookId })] as const
        const payload = asRecord(await response.json())
        return [targetBookId, asString(payload.title) ?? t('migration.duplicates.libraryBookId', { id: targetBookId })] as const
      } catch {
        return [targetBookId, t('migration.duplicates.libraryBookId', { id: targetBookId })] as const
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
    readingSessions: m('user_state', 'reading_sessions'),
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
  if (currentStage === 'completed') return { percent: 100, label: t('migration.badge.completed') }

  const stageIdx = STAGE_NAMES.indexOf(currentStage as (typeof STAGE_NAMES)[number])
  const completedStages = stageIdx >= 0 ? stageIdx : 0
  const stageWeight = 100 / STAGE_NAMES.length
  const percent = Math.min(Math.round(completedStages * stageWeight + stageWeight * 0.5), 99)

  const stageLabels: Record<string, string> = {
    init: t('migration.stages.init'),
    shared_overlays: t('migration.stages.sharedOverlays'),
    book_covers: t('migration.stages.bookCovers'),
    user_state: t('migration.stages.userState'),
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
      if (runProgress.value.run.state !== 'running') await refreshWorkflowState()
    } finally {
      busy.loadingProgress = false
    }
  },
  intervalMs: 5000,
})

function handleClose() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  await initialize()
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
})

async function initialize() {
  loading.value = true
  try {
    await Promise.all([loadSupportedTypes(), loadTargetUsers(), loadTargetLibraryFolders()])
    await refreshWorkflowState()
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.initFailed')))
  } finally {
    loading.value = false
  }
}

async function loadSupportedTypes() {
  try {
    supportedTypes.value = await listSupportedSourceTypes()
  } catch (error) {
    supportedTypes.value = []
    toast.error(getErrorMessage(error, t('migration.toast.loadSupportedTypesFailed')))
  }
}

async function loadTargetUsers() {
  busy.loadingTargetUsers = true
  try {
    targetUsers.value = await listTargetUsers()
  } catch (error) {
    targetUsers.value = []
    toast.error(getErrorMessage(error, t('migration.toast.loadTargetUsersFailed')))
  } finally {
    busy.loadingTargetUsers = false
  }
}

async function loadTargetLibraryFolders() {
  try {
    targetLibraryFolders.value = await listTargetLibraryFolders()
  } catch (error) {
    targetLibraryFolders.value = []
    toast.error(getErrorMessage(error, t('migration.toast.loadTargetFoldersFailed')))
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
  if (!currentSource) {
    resetSourceDraft()
    return
  }
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

function resetSourceDraft() {
  Object.assign(sourceDraft, {
    ...DEFAULT_SOURCE_DRAFT,
    type: supportedTypes.value[0] ?? DEFAULT_SOURCE_DRAFT.type,
  })
  mediaPathTestState.value = 'idle'
  mediaPathTestMessage.value = null
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
      if (userMappings.value.length === 0) toast.warning(t('migration.toast.noSourceUsers'))
      else toast.success(t('migration.toast.suggestionsLoaded'))
    }
  } catch (error) {
    if (showSuccessToast) toast.error(getErrorMessage(error, t('migration.toast.loadSuggestionsFailed')))
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
    toast.error(t('migration.toast.sourceFieldsRequired'))
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
        const highlightedWarning = mediaPathWarning ?? warnings[0] ?? t('migration.toast.connectionPassedWithWarnings')
        toast.warning(
          warnings.length === 1
            ? highlightedWarning
            : t('migration.toast.connectionPassedWithWarningCount', { count: warnings.length, warning: highlightedWarning }),
        )
      } else {
        toast.success(t('migration.toast.connectionPassed'))
      }
    } else {
      toast.warning(t('migration.toast.connectionMissingTables', { count: missing }))
    }
  } catch (error) {
    toast.error(friendlyConnectionError(error))
  } finally {
    busy.testingSource = false
  }
}

async function onTestMediaPath() {
  if (hasActiveRun.value) {
    toast.error(t('migration.toast.cannotTestMediaWhileRunning'))
    return
  }
  if (!hasValidSourceDraft()) {
    toast.error(t('migration.toast.sourceFieldsRequired'))
    return
  }
  const mediaRootPath = sourceDraft.mediaRootPath.trim()
  if (!mediaRootPath) {
    mediaPathTestState.value = 'fail'
    const message = t('migration.toast.mediaPathRequired')
    mediaPathTestMessage.value = message
    toast.error(message)
    return
  }
  if (!mediaRootPath.startsWith('/')) {
    mediaPathTestState.value = 'fail'
    const message = t('migration.toast.mediaPathAbsolute')
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
      mediaPathTestMessage.value = t('migration.toast.mediaPathVerified')
      toast.success(t('migration.toast.mediaPathValid'))
    } else if (mediaWarnings.length > 0) {
      mediaPathTestState.value = 'fail'
      const message = mediaWarnings[0] ?? t('migration.toast.mediaPathValidationFailed')
      mediaPathTestMessage.value = message
      toast.warning(message)
    } else {
      mediaPathTestState.value = 'fail'
      const message = t('migration.toast.connectionFailedBeforeMedia')
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
    toast.error(t('migration.toast.cannotModifySourceWhileRunning'))
    return
  }
  if (!hasValidSourceDraft()) {
    toast.error(t('migration.toast.sourceFieldsRequired'))
    return
  }
  busy.savingSource = true
  try {
    await createSource({ type: sourceDraft.type, name: sourceDraft.name.trim(), connectionConfig: buildSourceConnectionConfig() })
    await refreshWorkflowState()
    const currentSource = source.value
    if (currentSource) {
      const result = await validateSourceById(currentSource.id)
      const warnings = Array.isArray(result.warnings) ? (result.warnings as unknown[]).filter((w): w is string => typeof w === 'string') : []
      await refreshWorkflowState()
      await autoLoadPathPrefixes()
      toast.success(warnings.length > 0 ? t('migration.toast.sourceSavedWithWarnings', { count: warnings.length }) : t('migration.toast.sourceSaved'))
    }
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.saveSourceFailed')))
  } finally {
    busy.savingSource = false
  }
}

function resetLocalMigrationState() {
  pathValidation.value = null
  suggestionsLoadedAt.value = null
  sourcePathPrefixes.value = []
  runProgress.value = null
  runReport.value = null
  duplicateResolutions.value = new Map()
  duplicateTargetBookLabels.value = new Map()
  currentStep.value = 0
}

async function autoLoadPathPrefixes() {
  const currentSource = source.value
  if (!currentSource) return
  try {
    const result = await listSourcePathPrefixes(currentSource.id)
    sourcePathPrefixes.value = result.prefixes
  } catch {
    /* non-fatal */
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
  if (pathMappings.value.length === 0) pathMappings.value = [{ sourcePrefix: '', targetPrefix: '' }]
}

function cleanedPathMappings() {
  return pathMappings.value
    .map((row) => ({ sourcePrefix: row.sourcePrefix.trim(), targetPrefix: row.targetPrefix.trim() }))
    .filter((row) => row.sourcePrefix.length > 0 && row.targetPrefix.length > 0)
}

function cleanedUserMappings() {
  return userMappings.value
    .map((row) => ({ sourceUserId: row.sourceUserId, targetUserId: row.targetUserId }))
    .filter((row): row is { sourceUserId: string; targetUserId: number } => !!row.targetUserId)
}

async function onSaveMappings() {
  if (hasActiveRun.value) {
    toast.error(t('migration.toast.cannotSaveMappingsWhileRunning'))
    return
  }
  const currentSource = source.value
  if (!currentSource) {
    toast.error(t('migration.toast.saveSourceFirst'))
    return
  }
  const mappings = cleanedUserMappings()
  if (mappings.length === 0) {
    toast.error(t('migration.toast.mapAtLeastOneUser'))
    return
  }
  if (mappings.length !== userMappings.value.length) {
    toast.error(t('migration.toast.mapEveryUser'))
    return
  }

  busy.savingProfile = true
  try {
    const cleanedPaths = cleanedPathMappings()
    if (cleanedPaths.length > 0) {
      try {
        pathValidation.value = await validatePathMappings(currentSource.id, { pathMappings: cleanedPaths, sampleLimit: 10 })
      } catch (pathError) {
        toast.warning(getErrorMessage(pathError, t('migration.toast.pathValidationFailedButSaved')))
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
    toast.success(t('migration.toast.mappingsSaved'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.saveMappingsFailed')))
  } finally {
    busy.savingProfile = false
  }
}

async function onRunDryRun() {
  if (hasActiveRun.value) {
    toast.error(t('migration.toast.cannotDryRunWhileRunning'))
    return
  }
  const currentProfile = profile.value
  if (!currentProfile) {
    toast.error(t('migration.toast.saveMappingsFirst'))
    return
  }
  busy.dryRun = true
  try {
    const artifact = await createDryRunPlan({ profileId: currentProfile.id })
    await refreshWorkflowState()
    const matched = artifact.summary?.matchedBooks ?? 0
    const unresolved = artifact.summary?.unresolvedBooks ?? 0
    toast.success(t('migration.toast.dryRunCompleted', { matched, unresolved }))
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.dryRunFailed')))
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
    toast.error(t('migration.toast.selectSourceForDuplicates', { count: unresolved.length }))
    return
  }

  busy.resolvingDuplicates = true
  try {
    const resolutions = matches.map((m) => ({ targetBookId: m.targetBookId, selectedSourceBookId: duplicateResolutions.value.get(m.targetBookId)! }))
    await resolveDuplicateMatches(currentPlan.id, resolutions)
    duplicateResolutions.value = new Map()
    await refreshWorkflowState()
    toast.success(t('migration.toast.duplicatesResolved'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.resolveDuplicatesFailed')))
  } finally {
    busy.resolvingDuplicates = false
  }
}

const confirmingMigrationStart = ref(false)

async function onStartMigration() {
  if (!preflight.value.ready) {
    toast.error(preflight.value.issues[0] ?? t('migration.toast.preflightNotReady'))
    return
  }
  const currentPlan = plan.value
  if (!currentPlan) {
    toast.error(t('migration.toast.runDryRunFirst'))
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
    toast.success(t('migration.toast.runStarted'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.startFailed')))
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
    toast.success(t('migration.toast.runCancelled'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.cancelFailed')))
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
    toast.success(t('migration.toast.runRetried'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.retryFailed')))
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
    if (runProgress.value.run.state !== 'running') await refreshWorkflowState()
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.loadProgressFailed')))
  } finally {
    busy.loadingProgress = false
  }
}

async function onRefreshReport() {
  const currentRun = run.value
  if (!currentRun) {
    toast.error(t('migration.toast.startMigrationFirst'))
    return
  }
  busy.loadingReport = true
  try {
    runReport.value = await getRunReport(currentRun.id)
    toast.success(t('migration.toast.reportRefreshed'))
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.loadReportFailed')))
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
    toast.error(t('migration.toast.startMigrationFirst'))
    return
  }
  busy.exporting = true
  try {
    const exported = await exportRunReport(currentRun.id, format)
    downloadTextFile(exported.fileName, exported.content, exported.contentType)
    toast.success(t('migration.toast.reportExported', { format: format.toUpperCase() }))
  } catch (error) {
    toast.error(getErrorMessage(error, t('migration.toast.exportFailed')))
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
  if (reason === 'no_title_author_match') return t('migration.unresolvedReason.noTitleAuthorMatch')
  if (reason === 'no_file_path_match') return t('migration.unresolvedReason.noFilePathMatch')
  if (reason === 'no_file_hash_match') return t('migration.unresolvedReason.noFileHashMatch')
  if (reason === 'no_isbn_match') return t('migration.unresolvedReason.noIsbnMatch')
  if (reason === 'insufficient_source_data') return t('migration.unresolvedReason.insufficientSourceData')
  if (reason === 'ambiguous_isbn_match') return t('migration.unresolvedReason.ambiguousIsbnMatch')
  if (reason === 'ambiguous_file_hash_match') return t('migration.unresolvedReason.ambiguousFileHashMatch')
  if (reason === 'ambiguous_file_path_match') return t('migration.unresolvedReason.ambiguousFilePathMatch')
  if (reason === 'ambiguous_title_author_match') return t('migration.unresolvedReason.ambiguousTitleAuthorMatch')
  return reason ?? t('migration.unresolvedReason.unknown')
}

function friendlyMatchStrategy(strategy: string | null): string {
  if (strategy === 'isbn') return t('migration.matchStrategy.isbn')
  if (strategy === 'file_hash') return t('migration.matchStrategy.fileHash')
  if (strategy === 'path_mapping') return t('migration.matchStrategy.pathMapping')
  if (strategy === 'title_author') return t('migration.matchStrategy.titleAuthor')
  return strategy ?? t('migration.matchStrategy.unavailable')
}

function describeUserPreviewCounts(counts: {
  statuses: number
  fileProgress: number
  readingSessions: number
  bookmarks: number
  annotations: number
  shelves: number
}): string {
  return t('migration.report.userPreviewCounts', {
    statuses: counts.statuses,
    progress: counts.fileProgress,
    sessions: counts.readingSessions ?? 0,
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
      return { sourceBookId, title: asString(record.title), author: null as string | null, reason: asString(record.reason) }
    })
    .filter((row): row is ReportUnresolvedBook => row != null)
}

function friendlyConnectionError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error)
  if (/ECONNREFUSED|ENOTFOUND|connect ETIMEDOUT/i.test(msg)) return t('migration.connectionError.unreachable')
  if (/Access denied|authentication failed/i.test(msg)) return t('migration.connectionError.authFailed')
  if (/Unknown database/i.test(msg)) return t('migration.connectionError.databaseNotFound')
  if (/ETIMEDOUT|timeout/i.test(msg)) return t('migration.connectionError.timeout')
  return msg || t('migration.connectionError.generic')
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

interface SourceTypeCompatibility {
  testedVersions: string[]
  note: string
}

const sourceTypeCompatibility = computed<SourceTypeCompatibility | null>(() => {
  const compatibility: Record<string, SourceTypeCompatibility> = {
    booklore: {
      testedVersions: ['v2.2.2'],
      note: t('migration.source.compatibility.note'),
    },
    grimmory: {
      testedVersions: ['v3.0.3'],
      note: t('migration.source.compatibility.note'),
    },
  }
  return compatibility[sourceDraft.type] ?? null
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-[2px]" @click="handleClose" />

      <div
        class="relative flex flex-col w-full max-w-5xl bg-background rounded-lg shadow-2xl overflow-hidden border border-border"
        style="height: min(90vh, 700px)"
      >
        <!-- Mobile top bar -->
        <div class="md:hidden flex items-center px-4 h-14 border-b border-border shrink-0">
          <span class="flex-1 text-sm font-semibold text-foreground font-serif text-center">{{ currentStepTitle }}</span>
          <button
            class="flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            @click="handleClose"
          >
            <X :size="16" />
          </button>
        </div>

        <!-- Body: sidebar + content -->
        <div class="flex flex-1 min-h-0">
          <!-- Sidebar (desktop only) -->
          <nav class="hidden md:flex flex-col w-52 shrink-0 bg-muted/40 border-r border-border">
            <div class="px-4 pt-5 pb-4 border-b border-border flex items-center justify-between shrink-0">
              <span class="font-semibold text-foreground font-serif truncate">{{ t('migration.sidebarTitle') }}</span>
              <button
                class="flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0 ml-1"
                @click="handleClose"
              >
                <X :size="14" />
              </button>
            </div>

            <div class="flex-1 overflow-y-auto py-3 px-2">
              <button
                v-for="(step, i) in stepperSteps"
                :key="i"
                class="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors relative"
                :class="[
                  currentStep === i
                    ? 'bg-background text-foreground font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 cursor-pointer',
                ]"
                @click="onStepClick(i)"
              >
                <span
                  class="flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0 transition-colors"
                  :class="stepIndicatorClass(i)"
                >
                  <Check v-if="step.status === 'done'" :size="10" />
                  <AlertCircle v-else-if="step.status === 'failed'" :size="9" />
                  <Loader2 v-else-if="step.status === 'running'" :size="9" class="animate-spin" />
                  <template v-else>{{ i + 1 }}</template>
                </span>
                <span class="flex-1 text-left text-xs leading-snug">{{ step.label }}</span>
                <div v-if="currentStep === i" class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r bg-primary" />
              </button>
            </div>
          </nav>

          <!-- Right panel -->
          <div class="flex flex-col flex-1 min-w-0">
            <!-- Step header (desktop only) -->
            <div class="hidden md:flex items-start justify-between gap-3 px-6 pt-5 pb-4 border-b border-border shrink-0">
              <div>
                <h2 class="font-serif font-semibold text-foreground text-base tracking-tight">{{ currentStepTitle }}</h2>
                <p class="text-xs text-muted-foreground mt-0.5">{{ currentStepSubtitle }}</p>
              </div>
              <span
                v-if="currentStepBadge"
                class="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                :class="currentStepBadge.cls"
                >{{ currentStepBadge.label }}</span
              >
            </div>

            <!-- Step content -->
            <div class="flex-1 overflow-y-auto px-5 md:px-6 py-5">
              <div v-if="loading" class="flex items-center justify-center py-16">
                <Loader2 class="size-5 animate-spin text-muted-foreground" />
              </div>

              <template v-else>
                <!-- Step 0: Source Connection -->
                <div v-if="currentStep === 0" class="space-y-3">
                  <div class="grid gap-2 md:grid-cols-2">
                    <label class="block">
                      <span class="settings-hint">{{ t('migration.source.fields.type') }}</span>
                      <select v-model="sourceDraft.type" class="select-field mt-1 w-full" :disabled="hasActiveRun">
                        <option v-for="type in supportedTypes" :key="type" :value="type">{{ type }}</option>
                      </select>
                    </label>
                    <label class="block">
                      <span class="settings-hint">{{ t('migration.source.fields.name') }}</span>
                      <input
                        v-model="sourceDraft.name"
                        class="input-field mt-1 w-full"
                        :placeholder="t('migration.sidebarTitle')"
                        :disabled="hasActiveRun"
                      />
                    </label>
                    <label class="block">
                      <span class="settings-hint">{{ t('migration.source.fields.host') }}</span>
                      <input v-model="sourceDraft.host" class="input-field mt-1 w-full" placeholder="127.0.0.1" :disabled="hasActiveRun" />
                    </label>
                    <label class="block">
                      <span class="settings-hint">{{ t('migration.source.fields.port') }}</span>
                      <input
                        v-model.number="sourceDraft.port"
                        class="input-field mt-1 w-full"
                        type="number"
                        min="1"
                        max="65535"
                        :disabled="hasActiveRun"
                      />
                    </label>
                    <label class="block">
                      <span class="settings-hint">{{ t('migration.source.fields.user') }}</span>
                      <input v-model="sourceDraft.user" class="input-field mt-1 w-full" placeholder="booklore" :disabled="hasActiveRun" />
                    </label>
                    <label class="block">
                      <span class="settings-hint">{{ t('migration.source.fields.password') }}</span>
                      <div class="relative mt-1">
                        <input
                          v-model="sourceDraft.password"
                          class="input-field w-full pr-9"
                          :type="showPassword ? 'text' : 'password'"
                          :placeholder="source ? t('migration.source.fields.passwordSaved') : t('migration.source.fields.passwordNotSet')"
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
                      <span class="settings-hint">{{ t('migration.source.fields.database') }}</span>
                      <input v-model="sourceDraft.database" class="input-field mt-1 w-full" placeholder="booklore" :disabled="hasActiveRun" />
                    </label>
                    <label class="block">
                      <span class="settings-hint">{{ t('migration.source.fields.mediaRootPath') }}</span>
                      <div class="mt-1 flex items-center gap-2">
                        <input
                          v-model="sourceDraft.mediaRootPath"
                          class="input-field w-full"
                          placeholder="/data/booklore/media"
                          :disabled="hasActiveRun"
                        />
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
                                ? t('migration.source.mediaPath.buttonOk')
                                : mediaPathTestState === 'fail'
                                  ? t('migration.source.mediaPath.buttonIssue')
                                  : t('migration.source.mediaPath.buttonTest')
                            }}
                          </span>
                        </button>
                      </div>
                      <p class="mt-1 text-xs" :class="mediaRootPathHint.className">{{ mediaRootPathHint.text }}</p>
                      <p
                        v-if="mediaPathTestMessage"
                        class="mt-1 text-xs"
                        :class="mediaPathTestState === 'pass' ? 'text-emerald-700' : 'text-amber-700'"
                      >
                        {{ mediaPathTestMessage }}
                      </p>
                    </label>
                    <div class="flex items-center">
                      <label class="flex h-9 cursor-pointer items-center gap-2">
                        <input v-model="sourceDraft.ssl" type="checkbox" class="size-4 rounded border-border" :disabled="hasActiveRun" />
                        <span class="settings-hint">{{ t('migration.source.fields.ssl') }}</span>
                      </label>
                    </div>
                  </div>

                  <div v-if="sourceTypeCompatibility" class="rounded border border-border bg-muted/40 px-3.5 py-3 text-xs space-y-1">
                    <p class="font-medium text-foreground">{{ t('migration.source.compatibility.title') }}</p>
                    <p class="text-muted-foreground">
                      {{ t('migration.source.compatibility.verifiedAgainst') }}
                      <span class="font-mono font-medium text-foreground">{{ sourceTypeCompatibility.testedVersions.join(', ') }}</span>
                    </p>
                    <p class="text-muted-foreground">{{ sourceTypeCompatibility.note }}</p>
                  </div>

                  <div class="flex flex-wrap gap-2">
                    <button class="settings-btn-outline" :disabled="busy.testingSource || hasActiveRun" @click="onTestSource">
                      <Loader2 v-if="busy.testingSource" class="size-3.5 animate-spin" />
                      {{ t('migration.source.testConnection') }}
                    </button>
                    <button class="settings-btn-primary" :disabled="busy.savingSource || hasActiveRun" @click="onSaveAndValidate">
                      <Loader2 v-if="busy.savingSource" class="size-3.5 animate-spin" />
                      {{ t('migration.source.saveAndValidate') }}
                    </button>
                  </div>

                  <div
                    v-if="sourceValidationWarnings.length > 0"
                    class="rounded border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 space-y-1"
                  >
                    <p class="font-medium">{{ t('migration.source.validatedWithWarnings') }}</p>
                    <p v-for="warn in sourceValidationWarnings" :key="warn">{{ warn }}</p>
                  </div>

                  <div v-if="sourceCapabilities" class="rounded border border-border bg-muted/40 p-3 text-xs space-y-2">
                    <p class="font-medium text-foreground">{{ t('migration.source.snapshot.title') }}</p>
                    <p class="text-muted-foreground">
                      {{
                        t('migration.source.snapshot.sourceVersion', {
                          version: sourceCapabilities.sourceVersion ?? t('migration.source.snapshot.unknown'),
                        })
                      }}
                    </p>
                    <p v-if="sourceCapabilities.missingTables.length > 0" class="text-amber-600">
                      {{ t('migration.source.snapshot.missingTables', { tables: sourceCapabilities.missingTables.join(', ') }) }}
                    </p>
                    <div v-if="sourceRowCounts.length > 0" class="grid gap-1 text-muted-foreground sm:grid-cols-2">
                      <p v-for="[key, count] in sourceRowCounts" :key="key">{{ formatSourceCountLabel(key) }}: {{ count }}</p>
                    </div>
                  </div>
                </div>

                <!-- Step 1: User & Path Mapping -->
                <div v-else-if="currentStep === 1" class="space-y-5">
                  <div class="flex items-center gap-2">
                    <p class="text-xs text-muted-foreground">{{ t('migration.mappings.suggestionsAutoLoad') }}</p>
                    <button
                      v-if="source"
                      class="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
                      :disabled="busy.loadingSuggestions || busy.loadingTargetUsers || hasActiveRun"
                      @click="onReloadSuggestions"
                    >
                      <Loader2 v-if="busy.loadingSuggestions || busy.loadingTargetUsers" class="size-3 animate-spin inline" />
                      {{ t('migration.mappings.refresh') }}
                    </button>
                  </div>

                  <div class="overflow-x-auto rounded border border-border">
                    <table class="w-full text-sm">
                      <thead class="bg-muted/40 text-left">
                        <tr>
                          <th class="px-3 py-2 font-medium">{{ t('migration.mappings.sourceUser') }}</th>
                          <th class="px-3 py-2 font-medium">{{ t('migration.mappings.targetUser') }}</th>
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
                          <td colspan="2" class="px-3 py-4 text-sm text-muted-foreground">{{ t('migration.mappings.noSourceUsersLoaded') }}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p v-if="!busy.loadingTargetUsers && targetUsers.length === 0" class="text-xs text-amber-600">
                    {{ t('migration.mappings.noActiveTargetUsers') }}
                  </p>

                  <div class="space-y-2">
                    <div class="flex items-center justify-between">
                      <p class="settings-hint">{{ t('migration.mappings.pathPrefixMappings') }}</p>
                      <button class="settings-btn-outline" :disabled="hasActiveRun" @click="addPathMapping">
                        {{ t('migration.mappings.addMapping') }}
                      </button>
                    </div>
                    <p class="text-xs text-muted-foreground">
                      {{ t('migration.mappings.pathMappingsExplanation') }}
                    </p>
                    <div
                      v-for="(row, index) in pathMappings"
                      :key="index"
                      class="grid gap-2 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center"
                    >
                      <select v-model="row.sourcePrefix" class="select-field w-full min-w-0" :disabled="hasActiveRun">
                        <option value="">
                          {{ sourcePathPrefixes.length === 0 ? t('migration.mappings.noPrefixesFound') : t('migration.mappings.selectSourcePrefix') }}
                        </option>
                        <option v-for="prefix in sourcePathPrefixes" :key="prefix" :value="prefix">{{ prefix }}</option>
                      </select>
                      <select v-model="row.targetPrefix" class="select-field w-full min-w-0" :disabled="hasActiveRun">
                        <option value="">{{ t('migration.mappings.selectTargetFolder') }}</option>
                        <option v-for="folder in targetLibraryFolders" :key="folder.path" :value="folder.path">
                          {{ folder.libraryName }} - {{ folder.path }}
                        </option>
                      </select>
                      <button class="settings-btn-outline" :disabled="hasActiveRun" @click="removePathMapping(index)">
                        {{ t('migration.mappings.remove') }}
                      </button>
                    </div>
                  </div>

                  <div v-if="pathValidation" class="rounded border border-border bg-muted/40 p-3 text-xs space-y-1">
                    <p class="font-medium text-foreground">{{ t('migration.mappings.pathValidation.title') }}</p>
                    <p class="text-muted-foreground">
                      {{
                        t('migration.mappings.pathValidation.mappedSummary', {
                          mapped: pathValidation.summary.mappedByPrefix,
                          total: pathValidation.summary.booksWithFilePath,
                        })
                      }}
                    </p>
                    <p v-if="pathValidation.summary.unmatchedTargetPaths > 0" class="text-amber-600">
                      {{ t('migration.mappings.pathValidation.unmatched', { count: pathValidation.summary.unmatchedTargetPaths }) }}
                    </p>
                    <p v-else-if="pathValidation.summary.matchedTargetPaths > 0" class="text-emerald-600">
                      {{ t('migration.mappings.pathValidation.allMatched', { count: pathValidation.summary.matchedTargetPaths }) }}
                    </p>
                  </div>

                  <button class="settings-btn-primary" :disabled="busy.savingProfile || source == null || hasActiveRun" @click="onSaveMappings">
                    <Loader2 v-if="busy.savingProfile" class="size-3.5 animate-spin" />
                    {{ t('migration.mappings.saveMappings') }}
                  </button>
                </div>

                <!-- Step 2: Dry Run -->
                <div v-else-if="currentStep === 2" class="space-y-5">
                  <button class="settings-btn-primary" :disabled="busy.dryRun || profile == null || hasActiveRun" @click="onRunDryRun">
                    <Loader2 v-if="busy.dryRun" class="size-3.5 animate-spin" />
                    {{ t('migration.dryRun.run') }}
                  </button>

                  <div v-if="plan" class="rounded border border-border bg-muted/30 p-3 space-y-2 text-sm">
                    <p>
                      {{ t('migration.dryRun.matched') }} <span class="font-medium">{{ plan.summary?.matchedBooks ?? 0 }}</span> ·
                      {{ t('migration.dryRun.unresolved') }}
                      <span class="font-medium">{{ plan.summary?.unresolvedBooks ?? 0 }}</span> · {{ t('migration.dryRun.duplicates') }}
                      <span class="font-medium" :class="(plan.summary?.duplicateBookMatches ?? 0) > 0 ? 'text-red-600' : ''">
                        {{ plan.summary?.duplicateBookMatches ?? 0 }}
                      </span>
                    </p>
                    <div v-if="unresolvedSummary.length > 0" class="space-y-1 text-xs text-muted-foreground">
                      <p class="font-medium text-foreground">{{ t('migration.dryRun.unresolvedSummary') }}</p>
                      <p v-for="[reason, count] in unresolvedSummary" :key="reason">{{ friendlyUnresolvedReason(reason) }}: {{ count }}</p>
                    </div>

                    <div v-if="duplicateMatches.length > 0" class="space-y-3 border-t border-border pt-3">
                      <div class="space-y-1">
                        <p class="font-medium text-red-600">{{ t('migration.duplicates.title') }}</p>
                        <p class="text-xs text-muted-foreground">
                          {{ t('migration.duplicates.explanation') }}
                        </p>
                        <p class="text-xs text-muted-foreground">
                          {{ t('migration.duplicates.remainingGroups') }}
                          <span class="font-medium text-foreground">{{ duplicateGroupsRemaining }}</span>
                          {{ t('migration.duplicates.ofCount', { total: duplicateMatches.length }) }}
                        </p>
                      </div>
                      <div class="space-y-2">
                        <div
                          v-for="dup in duplicateMatches"
                          :key="dup.targetBookId"
                          class="rounded border border-border bg-background p-3 space-y-1.5"
                        >
                          <p class="text-xs font-medium text-foreground">{{ targetBookLabel(dup.targetBookId) }}</p>
                          <p class="text-[11px] text-muted-foreground">{{ t('migration.duplicates.targetBookId', { id: dup.targetBookId }) }}</p>
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
                                {{ t('migration.duplicates.recommended') }}
                              </span>
                            </div>
                            <span class="text-muted-foreground text-[11px] whitespace-nowrap">{{
                              friendlyMatchStrategy(strategyForSource(dup, sourceId))
                            }}</span>
                          </label>
                        </div>
                      </div>
                      <button
                        class="settings-btn-primary"
                        :disabled="busy.resolvingDuplicates || duplicateResolutions.size < duplicateMatches.length"
                        @click="onResolveDuplicates"
                      >
                        <Loader2 v-if="busy.resolvingDuplicates" class="size-3.5 animate-spin" />
                        {{ t('migration.duplicates.resolveButton', { count: duplicateMatches.length }, duplicateMatches.length) }}
                      </button>
                    </div>
                  </div>
                </div>

                <!-- Step 3: Run Migration -->
                <div v-else-if="currentStep === 3" class="space-y-5">
                  <div class="rounded border border-border bg-muted/20 p-3 text-xs space-y-1.5">
                    <p class="font-medium text-foreground">{{ t('migration.preflight.title') }}</p>
                    <p v-if="preflight.ready" class="text-emerald-600">{{ t('migration.preflight.allPassed') }}</p>
                    <template v-else>
                      <div v-if="preflight.sourceValidated" class="flex items-center gap-1.5 text-emerald-600">
                        <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />{{ t('migration.preflight.sourceValidated') }}
                      </div>
                      <div v-else class="flex items-center gap-1.5 text-muted-foreground">
                        <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />
                        {{ !source ? t('migration.preflight.saveAndValidateSource') : t('migration.preflight.validateSourceConnection') }}
                      </div>
                      <div v-if="profile" class="flex items-center gap-1.5 text-emerald-600">
                        <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />{{ t('migration.preflight.mappingsSaved') }}
                      </div>
                      <div v-else class="flex items-center gap-1.5 text-muted-foreground">
                        <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />{{ t('migration.preflight.saveUserAndPathMappings') }}
                      </div>
                      <div v-if="profile && preflight.pathMappingsValidated" class="flex items-center gap-1.5 text-emerald-600">
                        <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />{{ t('migration.preflight.pathMappingsValidated') }}
                      </div>
                      <div v-else-if="profile" class="flex items-center gap-1.5 text-muted-foreground">
                        <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />{{
                          t('migration.preflight.savePathMappingsToValidate')
                        }}
                      </div>
                      <div v-if="preflight.dryRunFresh" class="flex items-center gap-1.5 text-emerald-600">
                        <span class="size-1.5 rounded-full bg-emerald-500 flex-none" />{{ t('migration.preflight.dryRunUpToDate') }}
                      </div>
                      <div v-else class="flex items-center gap-1.5 text-muted-foreground">
                        <span class="size-1.5 rounded-full bg-muted-foreground/40 flex-none" />{{ t('migration.preflight.runFreshDryRun') }}
                      </div>
                    </template>
                  </div>

                  <div class="flex flex-wrap gap-2">
                    <template v-if="confirmingMigrationStart">
                      <span class="text-xs text-amber-600 self-center">{{ t('migration.run.confirmPrompt') }}</span>
                      <button class="settings-btn-primary" :disabled="busy.startingRun" @click="onStartMigration">
                        <Loader2 v-if="busy.startingRun" class="size-3.5 animate-spin" />
                        {{ t('migration.run.confirmStart') }}
                      </button>
                      <button class="settings-btn-outline" @click="onCancelMigrationStart">{{ t('common.cancel') }}</button>
                    </template>
                    <template v-else>
                      <button class="settings-btn-primary" :disabled="busy.startingRun || !preflight.ready" @click="onStartMigration">
                        <Loader2 v-if="busy.startingRun" class="size-3.5 animate-spin" />
                        {{ t('migration.run.startMigration') }}
                      </button>
                    </template>
                    <button
                      v-if="run?.state === 'running'"
                      class="settings-btn-outline text-red-600"
                      :disabled="busy.cancellingRun"
                      @click="onCancelRun"
                    >
                      <Loader2 v-if="busy.cancellingRun" class="size-3.5 animate-spin" />
                      {{ t('migration.run.cancelRun') }}
                    </button>
                    <button class="settings-btn-outline" :disabled="busy.loadingProgress || run == null" @click="refreshRunProgress">
                      <Loader2 v-if="busy.loadingProgress" class="size-3.5 animate-spin" />
                      {{ t('migration.run.refreshStatus') }}
                    </button>
                  </div>

                  <div
                    v-if="pollingError"
                    class="rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 flex items-center gap-2 text-xs text-amber-700"
                  >
                    <span>{{ t('migration.run.pollingStopped') }}</span>
                    <button class="underline font-medium" @click="onRetryPolling">{{ t('migration.run.retry') }}</button>
                  </div>

                  <div v-if="run" class="rounded border border-border bg-muted/30 px-4 py-3.5 flex items-center gap-3 text-xs">
                    <span class="inline-flex rounded-full border px-2 py-0.5" :class="runStateClass(run.state)">{{ run.state }}</span>
                    <span class="text-muted-foreground">
                      {{
                        run.state === 'running'
                          ? t('migration.run.stage', { stage: run.currentStage ?? t('migration.run.initializing') })
                          : run.endedAt
                            ? t('migration.run.ended', { time: formatDateTime(new Date(run.endedAt)) })
                            : ''
                      }}
                    </span>
                    <button v-if="run.state !== 'running'" class="text-xs text-primary underline-offset-2 hover:underline ml-auto" @click="goNext">
                      {{ t('migration.footer.viewReport') }}
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
                  <p v-if="!run" class="text-sm text-muted-foreground">{{ t('migration.report.noRunYet') }}</p>

                  <template v-else>
                    <div class="flex flex-wrap items-start justify-between gap-3">
                      <div class="space-y-0.5">
                        <p class="flex items-center gap-2 text-sm font-medium">
                          {{ t('migration.report.runNumber', { id: run.id }) }}
                          <span class="inline-flex rounded-full border px-2 py-0.5 text-xs" :class="runStateClass(run.state)">{{ run.state }}</span>
                        </p>
                        <p class="text-xs text-muted-foreground">
                          {{ run.startedAt ? formatDateTime(new Date(run.startedAt)) : t('migration.report.notStarted') }}
                          <template v-if="reportData.durationMs != null"> &middot; {{ formatDuration(reportData.durationMs) }}</template>
                        </p>
                      </div>
                      <div class="flex flex-wrap gap-2">
                        <button class="settings-btn-outline" :disabled="busy.loadingReport" @click="onRefreshReport">
                          <Loader2 v-if="busy.loadingReport" class="size-3.5 animate-spin" />
                          {{ runReport ? t('migration.report.reloadReport') : t('migration.report.loadFullReport') }}
                        </button>
                        <button class="settings-btn-outline" :disabled="busy.exporting" @click="onExportJson">
                          {{ t('migration.report.exportJson') }}
                        </button>
                        <button class="settings-btn-outline" :disabled="busy.exporting" @click="onExportCsv">
                          {{ t('migration.report.exportCsv') }}
                        </button>
                      </div>
                    </div>

                    <div v-if="run.errorMessage" class="rounded border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-700 space-y-2">
                      <div class="space-y-0.5">
                        <p class="font-medium">{{ t('migration.report.migrationFailed') }}</p>
                        <p>{{ run.errorMessage }}</p>
                      </div>
                      <button v-if="run.state === 'failed'" class="settings-btn-outline text-xs" :disabled="busy.retryingRun" @click="onRetryRun">
                        <Loader2 v-if="busy.retryingRun" class="size-3.5 animate-spin" />
                        {{ t('migration.report.retryFromLastStage') }}
                      </button>
                    </div>

                    <template v-if="runReport || runProgress">
                      <div class="grid gap-3 sm:grid-cols-2">
                        <div class="rounded border border-border p-3 space-y-2">
                          <p class="text-sm font-semibold">{{ t('migration.report.booksSection') }}</p>
                          <div class="space-y-1.5 text-xs">
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.metadataOverlays') }}</span
                              ><span class="font-medium">{{ reportData.bookMetadata?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.authorMappings') }}</span
                              ><span class="font-medium">{{ reportData.bookAuthors?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.narratorMappings') }}</span
                              ><span class="font-medium">{{ reportData.bookNarrators?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.genreMappings') }}</span
                              ><span class="font-medium">{{ reportData.bookGenres?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.tagMappings') }}</span
                              ><span class="font-medium">{{ reportData.bookTags?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between" :class="reportData.coversSkippedAll ? 'text-amber-600' : ''">
                              <span>{{ t('migration.report.coversImported') }}</span
                              ><span class="font-medium">{{ reportData.bookCovers?.imported ?? 0 }}</span>
                            </div>
                            <p v-if="reportData.coversSkippedAll" class="text-amber-600 leading-tight">
                              {{ t('migration.report.coverImportSkipped') }}
                            </p>
                            <div v-if="reportData.unresolvedBooks.length > 0" class="flex justify-between text-amber-600">
                              <span>{{ t('migration.report.couldNotMatch') }}</span
                              ><span class="font-medium">{{ reportData.unresolvedBooks.length }}</span>
                            </div>
                          </div>
                        </div>
                        <div class="rounded border border-border p-3 space-y-2">
                          <p class="text-sm font-semibold">{{ t('migration.report.userDataSection') }}</p>
                          <div class="space-y-1.5 text-xs">
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.readingStatuses') }}</span
                              ><span class="font-medium">{{ reportData.userBookStatus?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.readingProgressEntries') }}</span
                              ><span class="font-medium">{{ reportData.readingProgress?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.audiobookProgressEntries') }}</span
                              ><span class="font-medium">{{ reportData.audiobookProgress?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.readingSessions') }}</span
                              ><span class="font-medium">{{ reportData.readingSessions?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.bookmarks') }}</span
                              ><span class="font-medium">{{ reportData.bookmarks?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.annotations') }}</span
                              ><span class="font-medium">{{ reportData.annotations?.imported ?? 0 }}</span>
                            </div>
                            <div class="flex justify-between">
                              <span class="text-muted-foreground">{{ t('migration.report.collectionEntries') }}</span
                              ><span class="font-medium">{{ reportData.collections?.imported ?? 0 }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                      <p v-if="!runReport && (run.state === 'completed' || run.state === 'failed')" class="text-xs text-muted-foreground">
                        {{ t('migration.report.loadFullReportHint') }}
                      </p>
                    </template>

                    <template v-if="runReport">
                      <div
                        v-if="run.state === 'completed' && reportData.unresolvedBooks.length === 0 && reportData.coverFailureCount === 0"
                        class="rounded border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-700"
                      >
                        {{ t('migration.report.completedNoIssues') }}
                      </div>
                      <div v-if="reportData.matchedBooks.length > 0" class="space-y-2">
                        <div>
                          <p class="text-sm font-semibold">{{ t('migration.report.matchedBooks', { count: reportData.matchedBooks.length }) }}</p>
                          <p class="text-xs text-muted-foreground mt-0.5">
                            {{ t('migration.report.matchedBooksExplanation') }}
                          </p>
                        </div>
                        <div class="space-y-1.5 max-h-56 overflow-y-auto">
                          <div
                            v-for="book in reportData.matchedBooks"
                            :key="`${book.sourceBookId}-${book.targetBookId}`"
                            class="rounded border border-border px-3 py-2 text-xs"
                          >
                            <p class="font-medium text-foreground">
                              {{ book.sourceTitle || t('migration.report.sourceBook', { id: book.sourceBookId }) }}
                            </p>
                            <p v-if="book.sourceAuthor" class="text-muted-foreground mt-0.5">{{ book.sourceAuthor }}</p>
                            <p class="text-muted-foreground mt-0.5">
                              {{ friendlyMatchStrategy(book.strategy) }} -
                              {{ book.targetTitle || t('migration.report.libraryBook', { id: book.targetBookId }) }}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div v-if="reportData.unresolvedBooks.length > 0" class="space-y-2">
                        <div>
                          <p class="text-sm font-semibold text-amber-600">
                            {{ t('migration.report.unresolvedBooks', { count: reportData.unresolvedBooks.length }) }}
                          </p>
                          <p class="text-xs text-muted-foreground mt-0.5">
                            {{ t('migration.report.unresolvedBooksExplanation') }}
                          </p>
                        </div>
                        <div class="space-y-1.5 max-h-48 overflow-y-auto">
                          <div
                            v-for="book in reportData.unresolvedBooks"
                            :key="book.sourceBookId"
                            class="rounded border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs"
                          >
                            <p class="font-medium text-foreground">{{ book.title || t('migration.report.sourceBook', { id: book.sourceBookId }) }}</p>
                            <p v-if="book.author" class="text-muted-foreground mt-0.5">{{ book.author }}</p>
                            <p class="text-muted-foreground mt-0.5">{{ friendlyUnresolvedReason(book.reason) }}</p>
                          </div>
                        </div>
                      </div>
                      <div v-if="reportData.userPreview.length > 0" class="space-y-2">
                        <div>
                          <p class="text-sm font-semibold">{{ t('migration.report.mappedUsers', { count: reportData.userPreview.length }) }}</p>
                          <p class="text-xs text-muted-foreground mt-0.5">
                            {{ t('migration.report.mappedUsersExplanation') }}
                          </p>
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
                      <div
                        v-if="reportData.coverFailureCount > 0"
                        class="rounded border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-700"
                      >
                        {{ t('migration.report.coverFailures', { count: reportData.coverFailureCount }) }}
                      </div>
                    </template>
                  </template>
                </div>
              </template>
            </div>

            <!-- Footer -->
            <div class="shrink-0 border-t border-border px-5 md:px-6 py-4">
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <button
                    class="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    @click="onBackOrCancel"
                  >
                    <X v-if="currentStep === 0" :size="14" />
                    <ChevronLeft v-else :size="14" />
                    {{ currentStep === 0 ? t('common.cancel') : t('common.back') }}
                  </button>
                  <button
                    v-if="canResetSetup"
                    class="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                    :disabled="resettingSource"
                    @click="onResetSetup"
                  >
                    <Loader2 v-if="resettingSource" class="size-3.5 animate-spin" />
                    <RotateCcw v-else :size="14" />
                    {{ t('migration.footer.resetSetup') }}
                  </button>
                </div>

                <span class="text-xs text-muted-foreground hidden md:block">{{
                  t('migration.footer.stepOf', { current: currentStep + 1, total: 5 })
                }}</span>

                <button
                  v-if="currentStep < 4"
                  class="flex items-center gap-1.5 px-5 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
                  @click="goNext"
                >
                  {{ continueLabel }}
                  <ChevronRight :size="14" />
                </button>
                <button
                  v-else
                  class="flex items-center gap-1.5 px-4 py-2 rounded-md border border-border text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  @click="goToSetup"
                >
                  {{ t('migration.footer.backToSetup') }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
