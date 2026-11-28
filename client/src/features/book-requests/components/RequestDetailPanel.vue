<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { ArrowRight, BookHeadphones, Ellipsis, EyeOff, Library, Loader2, RefreshCw, RotateCcw, Search, Trash2, Upload, Users, X } from '@lucide/vue'
import {
  bookRequestUploadPlanIsSendable,
  DELIVERY_BY_DOWNLOAD_SOURCE,
  isBookRequestFulfiller,
  isBookRequestMediaKind,
  isFulfillableBookRequestStatus,
  isGrabbableBookRequestStatus,
  NO_RESOLVED_REQUEST_DESTINATION,
  Permission,
} from '@bookorbit/types'
import type { BookRequestItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import EntityNotFound from '@/components/EntityNotFound.vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { formatDate, formatList } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import RequestCover from './RequestCover.vue'
import RequestPairSwitch from './RequestPairSwitch.vue'
import ReleaseUnitChooser from './ReleaseUnitChooser.vue'
import RequestReviewPanel from './RequestReviewPanel.vue'
import RequestDrawerSection from './RequestDrawerSection.vue'
import RequestDrawerToolbar from './RequestDrawerToolbar.vue'
import RequestAttemptsPanel from './RequestAttemptsPanel.vue'
import RequestFulfilDialog from './RequestFulfilDialog.vue'
import RequestSeedPanel from './RequestSeedPanel.vue'
import RequestStatusCard from './RequestStatusCard.vue'
import RequestUploadSection from './RequestUploadSection.vue'
import { useBookRequestActions, type ActionOutcome } from '../composables/useBookRequests'
import { useBookRequestDetail } from '../composables/useBookRequestDetail'
import { useBookRequestProgress } from '../composables/useBookRequestProgress'
import { useCoalescedRefresh } from '../composables/useCoalescedRefresh'
import { formatLanguageName } from '@/i18n/formatters'
import { requestLanguageOptions, useRequestDestinationDefault } from '../composables/useRequestDestinationDefault'
import { useRequestReview } from '../composables/useRequestReview'
import { plannedUploadFiles, requestUploadSummary, useRequestUpload } from '../composables/useRequestUpload'
import { prefetchRequestAttempts } from '../composables/useRequestAttempts'
import { prefetchSeedStatus } from '../composables/useRequestSeedStatus'
import { REQUEST_DRAWER } from '../requestDrawerContext'
import { canCancelRequest, canDeleteRequest, canDismissRequest, canLeaveRequest, cancelStopsATransfer } from '../requestActions'
import { requestBookCoverSources } from '../requestBookCover'
import { requestMediaIcon } from '../requestMedia'
import { localizedRequestActionFailure } from '../requestActionFailure'
import { currentRequestProgress } from '../requestPipeline'
import { sourceDotClass } from '../sourceColors'
import { dragCarriesFiles, pickedFromDrop, pickedFromInput, type PickedUploadFile } from '../requestUploadFiles'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()
const { user } = useAuth()
const drawer = inject(REQUEST_DRAWER, null)

/** The same window the list behind the drawer collapses its own refreshes into. */
const CHANGE_REFRESH_WINDOW_MS = 400

/**
 * Accessor form of the moderator check, declared before the composables that take it: they read
 * the reference at call time, and a `const` further down is still in its temporal dead zone.
 * Composables cannot ask `usePermissions` themselves, because that reaches the router.
 */
const canManageFn = () => hasPermission(Permission.ManageBookRequests)

const { request, loading, error, fetchRequest, setRequest } = useBookRequestDetail()
/**
 * The other half of a pair, read on its own because it is its own request. Only kept when it
 * really is this request's partner and the viewer may see it; anything else hides the switch.
 */
const companionDetail = useBookRequestDetail()
const companion = computed(() => {
  const other = companionDetail.request.value
  return other && request.value && other.id === request.value.companionRequestId && other.companionRequestId === request.value.id ? other : null
})
const { libraries: allLibraries, fetchLibraries } = useLibraries()
const libraries = computed(() => allLibraries.value.filter((library) => !library.readOnly))
const { load: loadDefaultDestination, defaultFor: instanceDefaultFor, resolveDestination } = useRequestDestinationDefault()
const { progressByRequest, onRequestsChanged, pruneSettledProgress } = useBookRequestProgress()
const actions = useBookRequestActions(canManageFn)
const { review, coverUrl: reviewCoverUrl, fetchReview, reset: resetReview } = useRequestReview(canManageFn)
const uploads = useRequestUpload(canManageFn)

const decisionNote = ref('')
/**
 * The offered list plus whatever this request already asks for, which is not always one of them: a
 * metadata provider can seed a language the dropdown does not list. Without this the select would
 * fall back to showing "any language" and quietly misdescribe the request.
 */
const languageOptions = computed(() => {
  const options = requestLanguageOptions(locale.value)
  const current = request.value?.language ?? null
  if (current === null || options.some((option) => option.code === current)) return options
  return [{ code: current, name: formatLanguageName(current) }, ...options]
})
const targetLibraryId = ref<number | null>(null)
const targetFolderId = ref<number | null>(null)

const requestId = computed(() => Number(route.params.id))
const canManage = computed(() => hasPermission(Permission.ManageBookRequests))
/**
 * Fulfilment rights on *this* request, which is a different question from moderating the queue: a
 * self-server drives the rows that are theirs to drive and nobody else's. Usually that is their
 * own, but a submission that collided with somebody else's undriven request takes that row on
 * instead, and `fulfillerUserId` is what records it. Mirrors `assertCanFulfil` on the server,
 * which is what actually enforces it.
 */
const canFulfilThis = computed(
  () =>
    canManage.value ||
    (hasPermission(Permission.BookRequestSelfFulfill) && request.value != null && isBookRequestFulfiller(request.value, user.value?.id)),
)
const busy = computed(() => actions.isPending(request.value?.id))
const mediaIcon = computed(() => requestMediaIcon(request.value?.mediaKind ?? 'ebook'))
const authorLine = computed(() => request.value?.authors.join(', ') ?? '')
const bookCoverSources = computed(() => (request.value ? requestBookCoverSources(request.value) : []))
/** Non-empty only while an attempt is held because its release turned out to hold several books. */
const releaseUnits = computed(() => request.value?.download?.releaseUnits ?? [])
const isHeld = computed(() => request.value?.status === 'needs_review')
const liveProgress = computed(() => {
  if (!request.value) return null
  return currentRequestProgress(request.value, progressByRequest.value[request.value.id])
})
/** A transfer the client is still running, which is the one thing the footer can stop. */
const transferActive = computed(() => {
  const status = liveProgress.value?.status ?? request.value?.download?.status
  return status === 'queued' || status === 'downloading'
})

const isPending = computed(() => request.value?.status === 'pending')
const canDecide = computed(() => canManage.value && isPending.value)
const canGrab = computed(() => canFulfilThis.value && request.value != null && isGrabbableBookRequestStatus(request.value.status))
/** Files can close the request wherever a release could, once it knows which library they go to. */
const targetReadOnly = computed(() => allLibraries.value.some((library) => library.id === request.value?.targetLibraryId && library.readOnly))
const canUpload = computed(() => canGrab.value && request.value?.targetLibraryId != null && !targetReadOnly.value)
const uploadState = computed(() => (request.value ? uploads.stateFor(request.value.id) : null))
/** The request's running upload, whoever started it. */
const activeUpload = computed(() => {
  const download = request.value?.download
  return download?.source === 'upload' && (download.status === 'queued' || download.status === 'downloading') ? download : null
})
/** This page's own record of that upload: the files it is sending, or the ones it came back for. */
const sentHere = computed(() => {
  const state = uploadState.value
  return state && activeUpload.value && state.downloadId === activeUpload.value.id ? state : null
})
/** Files picked here that have not been sent yet. */
const stagedUpload = computed(() => {
  const state = uploadState.value
  return canUpload.value && state && state.downloadId === null && state.picked.length > 0 ? state : null
})
const uploadSectionState = computed(() => sentHere.value ?? stagedUpload.value)
const uploadSummary = computed(() => requestUploadSummary(sentHere.value))
const uploadPaused = computed(() => uploadSummary.value !== null && !uploadSummary.value.here && uploadSummary.value.stalledCount > 0)
const uploadSendCount = computed(() => (stagedUpload.value ? plannedUploadFiles(stagedUpload.value).length : 0))
const canSendUpload = computed(() => {
  const state = stagedUpload.value
  return (
    state !== null &&
    !busy.value &&
    !state.planning &&
    !state.starting &&
    state.plan !== null &&
    bookRequestUploadPlanIsSendable(state.plan.status) &&
    uploadSendCount.value > 0
  )
})
const retryableUploadCount = computed(() => sentHere.value?.files.filter((file) => file.state === 'failed' && file.file !== null).length ?? 0)
const viewerIsRequester = computed(() => request.value?.userId === user.value?.id)

/** Grabbing again after a failure is a retry, and is named as one. */
const isRetry = computed(() => request.value?.status === 'failed' || request.value?.download?.status === 'failed')
const canFulfill = computed(() => canManage.value && request.value != null && isFulfillableBookRequestStatus(request.value.status))
const canCancel = computed(() =>
  request.value ? canCancelRequest(request.value, user.value?.id ?? null, canManage.value, hasPermission(Permission.BookRequestSelfFulfill)) : false,
)
const canDismiss = computed(() => (request.value ? canDismissRequest(request.value) : false))
const canDelete = computed(() => (request.value ? canDeleteRequest(request.value, canManage.value) : false))
const canLeave = computed(() => (request.value ? canLeaveRequest(request.value, user.value?.id ?? null) : false))
const canCancelDownload = computed(() => canCancel.value && transferActive.value && request.value?.download != null)
const hasMenuActions = computed(() => canFulfill.value || canDismiss.value || canLeave.value || canCancel.value || canDelete.value)
/** The quiet items above the rule and the destructive ones below it; the rule needs both. */
const menuNeedsRule = computed(() => (canFulfill.value || canDismiss.value || canLeave.value) && (canCancel.value || canDelete.value))
const canApproveNow = computed(() => canDecide.value && !busy.value && targetLibraryId.value !== null)
/** Both halves waiting on the same decision, which is the moment one press should cover both. */
const canApproveBoth = computed(() => canApproveNow.value && companion.value?.status === 'pending' && !actions.isPending(companion.value.id))
/** In a pair a bare "Approve" could mean either half, so it names the one this drawer is open on. */
const approveLabel = computed(() => {
  if (!companion.value) return t('bookRequests.actions.approve')
  return request.value?.mediaKind === 'audiobook' ? t('bookRequests.actions.pair.approveAudiobook') : t('bookRequests.actions.pair.approveEbook')
})
/** A book on the shelf this request's files will join, said until they have. */
const joinsBookId = computed(() => (request.value && request.value.status !== 'available' ? request.value.targetBookId : null))
/**
 * "File it anyway" is an override, which is the wrong word for an import that passed and is only
 * waiting because whoever sent it asked to look first.
 */
const fileIsOverride = computed(() => !review.value?.heldOnRequest || review.value?.verification?.passed === false)
const goToBookId = computed(() => (request.value?.status === 'available' ? request.value.matchedBookId : null))

type FooterStage = 'decide' | 'transfer' | 'uploading' | 'uploadPaused' | 'uploadReady' | 'grab' | 'review' | 'reviewGone' | 'done'

/** The one action the stage this request is at asks for, which always lives in the footer. */
const footerStage = computed<FooterStage | null>(() => {
  if (!request.value) return null
  if (canDecide.value) return 'decide'
  if (activeUpload.value && (canCancel.value || sentHere.value)) return uploadPaused.value ? 'uploadPaused' : 'uploading'
  if (canCancelDownload.value) return 'transfer'
  if (stagedUpload.value) return 'uploadReady'
  if (canGrab.value) return 'grab'
  if (isHeld.value && canFulfilThis.value && review.value) {
    if (review.value.bookDockFileId !== null) return 'review'
    return canFulfill.value ? 'reviewGone' : null
  }
  if (goToBookId.value !== null) return 'done'
  return null
})

/** Letters the keydown handler matches, shown as they are pressed rather than translated. */
const SHORTCUT_KEYS = { next: 'J', previous: 'K', approve: 'A' } as const
const KBD_CLASS =
  'inline-grid h-[18px] min-w-[18px] place-items-center rounded-[4px] border border-b-2 border-border bg-card px-1 font-mono text-[11px] leading-none font-medium text-foreground'

/** Whether the client still seeds the finished download, which the card's sentence mentions. */
const seeding = ref<boolean | null>(null)
const fulfilOpen = ref(false)

interface RequestFact {
  key: string
  label: string
  value: string
  when?: { iso: string; text: string }
  numeric?: boolean
}

/** A date from this year leaves the year off; an older one says which year. */
function factTime(iso: string | null): RequestFact['when'] {
  if (!iso) return undefined
  const date = new Date(iso)
  const year = date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric'
  return { iso, text: formatDate(date, { year, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
}

const facts = computed<RequestFact[]>(() => {
  const row = request.value
  if (!row) return []
  const rows: RequestFact[] = [
    { key: 'requester', label: t('bookRequests.detail.requestedBy'), value: row.requesterName, when: factTime(row.createdAt) },
  ]
  const decider = row.decidedByName ?? row.decidedByUsername
  if (decider) rows.push({ key: 'decider', label: t('bookRequests.detail.decidedBy'), value: decider, when: factTime(row.decidedAt) })
  rows.push({
    key: 'language',
    label: t('bookRequests.detail.language'),
    value: row.language ? formatLanguageName(row.language) : t('bookRequests.detail.languageAny'),
  })
  if (row.seriesName) rows.push({ key: 'series', label: t('bookRequests.detail.series'), value: row.seriesName })
  const isbn = row.isbn13 ?? row.isbn10
  if (isbn) rows.push({ key: 'isbn', label: t('bookRequests.detail.isbn'), value: isbn, numeric: true })
  if (row.subscribers.length) {
    rows.push({
      key: 'subscribers',
      label: t('bookRequests.detail.alsoWanted'),
      value: formatList(row.subscribers.map((subscriber) => subscriber.name)),
    })
  }
  return rows
})

/** Notes are quoted under the facts, each credited to whoever wrote it. */
const quotes = computed(() => {
  const row = request.value
  if (!row) return []
  const out: { key: string; text: string; caption: string }[] = []
  if (row.note) out.push({ key: 'requester', text: row.note, caption: t('bookRequests.detail.noteFrom', { name: row.requesterName }) })
  if (row.decisionNote) {
    const decider = row.decidedByName ?? row.decidedByUsername
    out.push({
      key: 'decision',
      text: row.decisionNote,
      caption: decider ? t('bookRequests.detail.noteFrom', { name: decider }) : t('bookRequests.detail.decisionNote'),
    })
  }
  return out
})

/** Where the release came from, over what, into which client, how big, and who chose it. */
const releaseMeta = computed(() => {
  const download = request.value?.download
  if (!download) return []
  // A score is only kept for an import that was held, so an upload's line has none to show.
  if (download.source === 'upload') {
    const parts: { text: string; numeric?: boolean }[] = [
      { text: download.uploadedByName ? t('bookRequests.upload.uploadedBy', { name: download.uploadedByName }) : t('bookRequests.upload.uploaded') },
    ]
    if (download.releaseSizeBytes !== null) parts.push({ text: formatBytes(download.releaseSizeBytes), numeric: true })
    parts.push({ text: formatDate(new Date(download.grabbedAt ?? download.createdAt), { month: 'short', day: 'numeric' }), numeric: true })
    return parts
  }
  const delivery = DELIVERY_BY_DOWNLOAD_SOURCE[download.source]
  const parts: { text: string; numeric?: boolean }[] = [
    { text: download.indexerName ?? t('bookRequests.download.source.pasted') },
    { text: t(`bookRequests.releases.protocol.${delivery === 'file' ? 'direct' : delivery}`) },
  ]
  if (download.downloadClientName) parts.push({ text: download.downloadClientName })
  if (download.releaseSizeBytes !== null) parts.push({ text: formatBytes(download.releaseSizeBytes), numeric: true })
  parts.push({ text: t(download.automated ? 'bookRequests.download.source.automatic' : 'bookRequests.download.source.manual') })
  return parts
})

const confirming = ref<'cancel' | 'cancelDownload' | 'cancelUpload' | 'delete' | 'leave' | 'discardImport' | null>(null)

/**
 * Each dialog names both of its answers, so "Cancel" never stands beside "Cancel request" meaning
 * the opposite thing. The counted keys are shared with the list's bulk dialogs, at a count of one.
 */
const CONFIRM_COPY = {
  delete: { title: 'bookRequests.confirm.deleteTitle', label: 'bookRequests.confirm.deleteConfirm', keep: 'bookRequests.confirm.keep' },
  leave: { title: 'bookRequests.confirm.leaveTitle', label: 'bookRequests.confirm.leaveConfirm', keep: 'bookRequests.confirm.stay' },
  discardImport: { title: 'bookRequests.confirm.discardImportTitle', label: 'bookRequests.review.discard', keep: 'bookRequests.confirm.goBack' },
  cancelDownload: {
    title: 'bookRequests.confirm.cancelDownloadTitle',
    label: 'bookRequests.actions.cancelDownload',
    keep: 'bookRequests.confirm.goBack',
  },
  cancelUpload: { title: 'bookRequests.confirm.cancelUploadTitle', label: 'bookRequests.upload.cancel', keep: 'bookRequests.confirm.goBack' },
  cancel: { title: 'bookRequests.confirm.cancelTitle', label: 'bookRequests.confirm.stopConfirm', keep: 'bookRequests.confirm.keep' },
} as const

const confirmTitle = computed(() => t(CONFIRM_COPY[confirming.value ?? 'cancel'].title))
const confirmKeepLabel = computed(() => t(CONFIRM_COPY[confirming.value ?? 'cancel'].keep, { count: 1 }))

const confirmDescription = computed(() => {
  const alwaysDeletesRemote = request.value?.download?.alwaysDeletesRemote ?? false
  if (confirming.value === 'delete') {
    return t(alwaysDeletesRemote ? 'bookRequests.confirm.deleteHideDescriptionRemoteDelete' : 'bookRequests.confirm.deleteHideDescription')
  }
  if (confirming.value === 'leave') return t('bookRequests.confirm.leaveDescription')
  if (confirming.value === 'discardImport') {
    return t(
      request.value?.download?.source === 'upload'
        ? 'bookRequests.confirm.discardUploadDescription'
        : 'bookRequests.confirm.discardImportDescription',
    )
  }
  if (confirming.value === 'cancelUpload') return t('bookRequests.confirm.cancelUploadDescription')
  if (confirming.value === 'cancelDownload') {
    return t(alwaysDeletesRemote ? 'bookRequests.confirm.cancelDownloadDescriptionRemoteDelete' : 'bookRequests.confirm.cancelDownloadDescription')
  }
  if (request.value && cancelStopsATransfer(request.value)) {
    return t(
      alwaysDeletesRemote ? 'bookRequests.confirm.cancelDescriptionWithDownloadRemoteDelete' : 'bookRequests.confirm.cancelDescriptionWithDownload',
    )
  }
  return t('bookRequests.confirm.cancelDescription')
})

const confirmLabel = computed(() => t(CONFIRM_COPY[confirming.value ?? 'cancel'].label, { count: 1 }))

const selectedLibrary = computed(() => libraries.value.find((library) => library.id === targetLibraryId.value) ?? null)
const folders = computed(() => selectedLibrary.value?.folders ?? [])

onMounted(async () => {
  await fetchRequest(requestId.value)
  resetDestination()
  void syncReview()
})

/** The companion follows whichever half is open, and goes away when the open request has none. */
watch(
  () => request.value?.companionRequestId ?? null,
  (companionId) => {
    if (companionId === null) {
      companionDetail.request.value = null
      return
    }
    void companionDetail.fetchRequest(companionId, { background: companionDetail.request.value?.id === companionId })
  },
  { immediate: true },
)

/**
 * Warms what the other half's drawer reads for itself, so the first switch to it shows its panels
 * at once rather than each one loading in turn. Only for somebody who sees those panels at all.
 */
watch(
  () => companion.value?.id ?? null,
  (companionId) => {
    const partner = companion.value
    if (companionId === null || !partner || !canFulfilThis.value) return
    void prefetchRequestAttempts(canManage.value, companionId)
    // The same test the seed panel applies: only a torrent has a seed to read.
    const source = partner.download?.source
    if (source === 'magnet' || source === 'torrent_file') void prefetchSeedStatus(canManage.value, companionId)
  },
)

/** Only a held request has anything to review, and only somebody who can file it may read it. */
async function syncReview(): Promise<void> {
  if (!canFulfilThis.value || !isHeld.value || !request.value) {
    resetReview()
    return
  }
  await fetchReview(request.value.id)
}

/**
 * Permissions arrive with the session, which on a hard load of `/requests/:id` lands after mount.
 * Gating the fetch on `canManage` at mount alone leaves the approver with an empty destination
 * select on exactly the load that went straight to a request.
 */
watch(
  () => canManage.value || canFulfilThis.value,
  (allowed) => {
    if (!allowed) return
    void fetchLibraries()
    if (canManage.value) void loadDefaultDestination()
    void syncReview()
  },
  { immediate: true },
)

// A status transition needs a fresh row, but the request already on screen stays mounted while it
// arrives. Coalesced like the list behind it: approving thirty rows broadcasts thirty changes, and
// answering each of them refetched this one request thirty times over.
onRequestsChanged(
  useCoalescedRefresh(() => {
    if (!Number.isInteger(requestId.value)) return
    void fetchRequest(requestId.value, { background: true }).then(syncReview)
    const companionId = request.value?.companionRequestId
    if (companionId != null) void companionDetail.fetchRequest(companionId, { background: true })
  }, CHANGE_REFRESH_WINDOW_MS),
)

// The fetched row is the authority once its attempt has settled; the last tick is then just noise.
watch(request, (row) => {
  if (row) pruneSettledProgress([row])
})

// Stepping to the next request keeps this component mounted and only swaps the id under it.
watch(requestId, async (id) => {
  if (!Number.isInteger(id)) return
  fulfilOpen.value = false
  seeding.value = null
  decisionNote.value = ''
  resetReview()

  // Switching between the halves of a pair: both are already loaded, so they trade places at once
  // and are refreshed behind the scenes. Fetching from scratch blanked the drawer to a loading line
  // on every switch.
  const partner = companion.value
  const previous = request.value
  if (partner && previous && partner.id === id) {
    setRequest(partner)
    companionDetail.setRequest(previous)
    resetDestination()
    void syncReview()
    void fetchRequest(id, { background: true }).then(syncReview)
    return
  }

  await fetchRequest(id)
  resetDestination()
  void syncReview()
})

/**
 * An upload outlives the page that started it. Its sender, back on the request, reads which files
 * it still waits for, so the missing ones can be picked again rather than the upload abandoned.
 */
watch(
  () => [activeUpload.value?.id ?? null, activeUpload.value?.uploadedByUserId ?? null, user.value?.id ?? null] as const,
  ([downloadId, uploaderId, viewerId]) => {
    if (downloadId === null || uploaderId === null || uploaderId !== viewerId || sentHere.value || !request.value) return
    void uploads.load(request.value.id)
  },
  { immediate: true },
)

/** Once the attempt has ended, filed, failed or cancelled, the request's own row says the rest. */
watch(
  () => [request.value?.id ?? null, request.value?.download?.id ?? null, request.value?.download?.status ?? null] as const,
  ([id, downloadId, status]) => {
    if (id === null) return
    const state = uploads.stateFor(id)
    if (!state || state.downloadId === null || downloadId === null) return
    const ended = downloadId === state.downloadId ? status !== 'queued' && status !== 'downloading' : downloadId > state.downloadId
    if (ended) uploads.clear(id)
  },
)

// Libraries can land after the panel has rendered, and an untouched picker still needs them.
watch(libraries, () => {
  if (targetLibraryId.value === null) resetDestination()
})

/** What approving without touching this would do, which is the instance default for its medium. */
const unpickedDestinationLabel = computed(() => {
  const kind = request.value?.mediaKind
  const fallback = kind && isBookRequestMediaKind(kind) ? instanceDefaultFor(kind) : NO_RESOLVED_REQUEST_DESTINATION
  return fallback.libraryName === null
    ? t('bookRequests.detail.destinationLibraryPlaceholder')
    : t('bookRequests.search.libraryDefault', { library: fallback.libraryName })
})

/** What the request already carries, or the only library there is. */
function resetDestination() {
  const carried = { libraryId: request.value?.targetLibraryId ?? null, folderId: request.value?.targetFolderId ?? null }
  const destination = resolveDestination(libraries.value, carried)
  targetLibraryId.value = destination.libraryId
  targetFolderId.value = destination.folderId
}

function firstFolderId(libraryId: number | null): number | null {
  if (libraryId === null) return null
  return libraries.value.find((library) => library.id === libraryId)?.folders?.[0]?.id ?? null
}

function handleLibraryChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value)
  targetLibraryId.value = Number.isInteger(value) && value > 0 ? value : null
  // A folder from the library we just left would file the book back into it.
  targetFolderId.value = firstFolderId(targetLibraryId.value)
}

function handleFolderChange(event: Event) {
  const value = Number((event.target as HTMLSelectElement).value)
  targetFolderId.value = Number.isInteger(value) && value > 0 ? value : null
}

/** A load that failed once otherwise leaves closing and reopening the drawer as the only retry. */
function handleRetryLoad() {
  if (!Number.isInteger(requestId.value)) return
  void fetchRequest(requestId.value).then(syncReview)
}

/** The query carries the tab and the filters behind the drawer, so every level keeps it. */
function goToReleases() {
  void router.push({ name: 'book-request-releases', params: { id: requestId.value }, query: route.query })
}

/**
 * The drawer traps focus, so it owns these keys outright and cannot collide with the filters on
 * the list behind it. Typing a decision note still has to win, which is the whole exclusion.
 *
 * Bound to the drawer's own root rather than the window, which is what keeps a single-character
 * shortcut inside WCAG 2.1.4: it acts only while the component that documents it holds focus.
 * The footer states them, and the approve button carries `aria-keyshortcuts` so a screen reader
 * announces the one that decides a request.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return

  if (event.key === 'j') {
    event.preventDefault()
    drawer?.goNext()
    return
  }
  if (event.key === 'k') {
    event.preventDefault()
    drawer?.goPrevious()
    return
  }
  if (event.key === 'a' && canApproveNow.value) {
    event.preventDefault()
    void approveRequest()
  }
}

/**
 * Every action returns the updated row, so the panel never re-fetches to learn what it just did.
 * The refusal travels with it rather than being read back off the composable, so one action in
 * flight cannot describe another.
 */
function applyUpdate(outcome: ActionOutcome, failureKey: string): boolean {
  if (!outcome.item) {
    const localized = localizedRequestActionFailure(outcome)
    const description = localized ? t(localized.key, localized.params) : outcome.reason
    toast.error(t(failureKey), description ? { description } : undefined)
    return false
  }
  setRequest(outcome.item)
  return true
}

async function approveRequest(): Promise<boolean> {
  if (!request.value || targetLibraryId.value === null) return false
  const outcome = await actions.approve(request.value.id, {
    decisionNote: decisionNote.value.trim() || undefined,
    targetLibraryId: targetLibraryId.value,
    targetFolderId: targetFolderId.value ?? undefined,
  })
  if (!applyUpdate(outcome, 'bookRequests.errors.approveFailed')) return false
  toast.success(t('bookRequests.toasts.approved'))
  return true
}

/**
 * The language decides which releases can match at all, and it arrives from whichever edition was
 * picked in the metadata results rather than from anything the requester chose. Correcting it here
 * saves cancelling a request and making it again, and the next search runs against the new one.
 */
async function handleLanguageChange(event: Event) {
  const current = request.value
  if (!current) return

  const select = event.target as HTMLSelectElement
  const value = select.value
  const outcome = await actions.setLanguage(current.id, value === '' ? null : value)
  if (!applyUpdate(outcome, 'bookRequests.errors.languageChangeFailed')) {
    // The bound value never changed, so Vue has nothing to re-render and the control is left
    // showing a language the request was not saved with. Put it back by hand.
    select.value = request.value?.language ?? ''
    return
  }
  toast.success(t('bookRequests.toasts.languageChanged'))
}

function handleApprove() {
  void approveRequest()
}

/**
 * This half with the destination picked here, and its partner with its own: the two media are
 * often filed into different libraries, so one choice must not be applied to both. The partner is
 * approved second and reports its own refusal, since this half's approval already stands.
 */
async function handleApproveBoth() {
  const partner = companion.value
  if (!partner || !(await approveRequest())) return

  const outcome = await actions.approve(partner.id, {})
  if (!outcome.item) {
    const localized = localizedRequestActionFailure(outcome)
    const description = localized ? t(localized.key, localized.params) : outcome.reason
    const failed =
      partner.mediaKind === 'audiobook' ? 'bookRequests.errors.approveCompanionFailedAudiobook' : 'bookRequests.errors.approveCompanionFailedEbook'
    toast.error(t(failed), description ? { description } : undefined)
    return
  }
  companionDetail.setRequest(outcome.item)
}

/**
 * The decided row stays in the list, so stepping on lands somewhere real. At the end of the queue
 * there is nowhere to go and the drawer stays put rather than closing out from under the approver.
 */
async function handleApproveAndNext() {
  if (await approveRequest()) drawer?.goNext()
}

async function handleReject() {
  if (!request.value) return
  const outcome = await actions.reject(request.value.id, { decisionNote: decisionNote.value.trim() || undefined })
  if (applyUpdate(outcome, 'bookRequests.errors.rejectFailed')) toast.success(t('bookRequests.toasts.rejected'))
}

async function cancelRequest() {
  if (!request.value) return
  const outcome = await actions.cancel(request.value.id, { deleteFiles: request.value.download?.alwaysDeletesRemote ?? false })
  if (applyUpdate(outcome, 'bookRequests.errors.cancelFailed')) toast.success(t('bookRequests.toasts.cancelled'))
}

async function cancelDownload() {
  if (!request.value?.download) return
  const outcome = await actions.cancelDownload(request.value.id, request.value.download.id, {
    deleteFiles: request.value.download.alwaysDeletesRemote,
  })
  if (applyUpdate(outcome, 'bookRequests.errors.cancelDownloadFailed')) toast.success(t('bookRequests.toasts.downloadCancelled'))
}

async function deleteRequest() {
  if (!request.value) return
  const outcome = await actions.remove(request.value.id, request.value.download?.alwaysDeletesRemote ?? false)
  if (!outcome.ok) {
    toast.error(t('bookRequests.errors.deleteFailed'), outcome.reason ? { description: outcome.reason } : undefined)
    return
  }
  toast.success(t('bookRequests.toasts.deleted'))
  // Nothing left behind this route to look at.
  drawer?.close()
}

/** Stopping a live transfer and deleting a row both ask first; the rest are one click. */
function handleCancel() {
  if (request.value && cancelStopsATransfer(request.value)) confirming.value = 'cancel'
  else void cancelRequest()
}

function handleCancelDownload() {
  confirming.value = 'cancelDownload'
}

function handleCancelUpload() {
  confirming.value = 'cancelUpload'
}

/** Ended on the server first, which closes its sessions; only then does this page stop sending. */
async function cancelUpload() {
  const current = request.value
  const download = activeUpload.value
  if (!current || !download) return
  const outcome = await actions.cancelDownload(current.id, download.id)
  if (!applyUpdate(outcome, 'bookRequests.errors.cancelUploadFailed')) return
  uploads.clear(current.id)
  toast.success(t('bookRequests.toasts.uploadCancelled'))
}

/* ------------------------------------------------------------------ uploading files to the request */

const fileInput = ref<HTMLInputElement | null>(null)
type PickPurpose = 'new' | 'append' | 'resume'
/** What the open file picker is for: files to replace, files to add, or the ones an upload lacks. */
const pickPurpose = ref<PickPurpose>('new')
/** Nested elements each fire their own enter and leave, so the overlay counts rather than toggles. */
const dragDepth = ref(0)

const dropPurpose = computed<PickPurpose | null>(() => {
  if (uploadPaused.value && sentHere.value) return 'resume'
  if (!canUpload.value || activeUpload.value) return null
  return stagedUpload.value ? 'append' : 'new'
})

function openPicker(purpose: PickPurpose) {
  pickPurpose.value = purpose
  fileInput.value?.click()
}

function handleUploadFiles() {
  openPicker('new')
}

function handleAddMore() {
  openPicker('append')
}

function handleAddMissing() {
  openPicker('resume')
}

async function takeFiles(picked: PickedUploadFile[], purpose: PickPurpose) {
  const current = request.value
  if (!current || picked.length === 0) return
  if (purpose === 'resume') {
    if (uploads.resume(current.id, picked) === 0) toast.error(t('bookRequests.upload.noneMatched'))
    return
  }
  await uploads.pick(current.id, picked, { append: purpose === 'append' })
}

async function handleFilesPicked(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files ? pickedFromInput(input.files) : []
  // Cleared, so picking the same file again after clearing it still fires a change.
  input.value = ''
  await takeFiles(picked, pickPurpose.value)
}

function handleDragEnter(event: DragEvent) {
  if (!dropPurpose.value || !dragCarriesFiles(event)) return
  event.preventDefault()
  dragDepth.value++
}

function handleDragOver(event: DragEvent) {
  if (!dropPurpose.value || !dragCarriesFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function handleDragLeave() {
  if (dragDepth.value > 0) dragDepth.value--
}

async function handleDrop(event: DragEvent) {
  dragDepth.value = 0
  const purpose = dropPurpose.value
  if (!purpose || !event.dataTransfer || !dragCarriesFiles(event)) return
  event.preventDefault()
  await takeFiles(await pickedFromDrop(event.dataTransfer), purpose)
}

async function handleStartUpload() {
  const current = request.value
  if (!current || !canSendUpload.value) return
  const outcome = await uploads.start(current.id)
  if (!outcome.ok) {
    toast.error(t('bookRequests.upload.startFailed'), outcome.reason ? { description: outcome.reason } : undefined)
    return
  }
  setRequest(outcome.request)
}

function handleClearUpload() {
  if (request.value) uploads.clear(request.value.id)
}

function handleRetryUpload() {
  if (request.value) uploads.retry(request.value.id)
}

function handleRetryUploadFile(fileId: number) {
  if (request.value) uploads.retry(request.value.id, fileId)
}

function handleChooseUploadUnit(unitIndex: number) {
  if (request.value) uploads.chooseUnit(request.value.id, unitIndex)
}

function handleUploadHold(hold: boolean) {
  if (request.value) uploads.setHold(request.value.id, hold)
}

function handleRemove() {
  confirming.value = 'delete'
}

function handleLeave() {
  confirming.value = 'leave'
}

function handleDiscardImport() {
  confirming.value = 'discardImport'
}

/**
 * The dialog stays open until the action settles. Closing it first left `busy` with nothing to
 * render, so a cancellation that has to reach a download client looked instantaneous and finished
 * somewhere off screen; it also let a second Enter start the same action twice.
 */
async function handleConfirm() {
  const pending = confirming.value
  if (pending === 'delete') await deleteRequest()
  else if (pending === 'cancel') await cancelRequest()
  else if (pending === 'cancelDownload') await cancelDownload()
  else if (pending === 'cancelUpload') await cancelUpload()
  else if (pending === 'leave') await leaveRequest()
  else if (pending === 'discardImport') await discardImport()
  confirming.value = null
}

/**
 * Leaving costs the caller their access to the request, so there is no row to update afterwards
 * and nothing behind this route left to look at.
 */
async function leaveRequest() {
  if (!request.value) return
  const outcome = await actions.leave(request.value.id)
  if (!outcome.ok) {
    toast.error(t('bookRequests.errors.leaveFailed'), outcome.reason ? { description: outcome.reason } : undefined)
    return
  }
  toast.success(t('bookRequests.toasts.left'))
  drawer?.close()
}

async function discardImport() {
  if (!request.value) return
  const outcome = await actions.discardImport(request.value.id)
  if (!applyUpdate(outcome, 'bookRequests.errors.discardImportFailed')) return
  resetReview()
  toast.success(t('bookRequests.toasts.importDiscarded'))
}

function handleConfirmCancel() {
  confirming.value = null
}

async function handleDismiss() {
  if (!request.value) return
  const outcome = await actions.dismiss(request.value.id)
  if (applyUpdate(outcome, 'bookRequests.errors.dismissFailed')) toast.success(t('bookRequests.toasts.dismissed'))
}

async function handleRestore() {
  if (!request.value) return
  const outcome = await actions.restore(request.value.id)
  if (applyUpdate(outcome, 'bookRequests.errors.restoreFailed')) toast.success(t('bookRequests.toasts.restored'))
}

function openFulfil() {
  fulfilOpen.value = true
}

function handleFulfilCancel() {
  fulfilOpen.value = false
}

async function handleFulfill(payload: { matchedBookId?: number; bookDockFileId?: number }) {
  if (!request.value) return
  const outcome = await actions.fulfill(request.value.id, payload)
  if (applyUpdate(outcome, 'bookRequests.errors.fulfilFailed')) {
    fulfilOpen.value = false
    toast.success(t('bookRequests.toasts.fulfilled'))
  }
}

function handleSeeding(value: boolean | null) {
  seeding.value = value
}

async function handleRemoveDownload(payload: { request: BookRequestItem; downloadId: number; deleteFiles: boolean }) {
  const outcome = await actions.removeDownload(payload.request.id, payload.downloadId, { deleteFiles: payload.deleteFiles })
  if (applyUpdate(outcome, 'bookRequests.errors.removeDownloadFailed')) toast.success(t('bookRequests.toasts.downloadRemoved'))
}

async function handleChooseReleaseUnit(unitIndex: number) {
  const download = request.value?.download
  if (!request.value || !download) return

  const outcome = await actions.selectReleaseUnit(request.value.id, download.id, { unitIndex })
  if (applyUpdate(outcome, 'bookRequests.errors.selectUnitFailed')) toast.success(t('bookRequests.toasts.unitChosen'))
}

/** The score was right about what it measured; the approver is overruling it, not correcting it. */
async function handleFileAnyway() {
  if (!request.value) return

  const outcome = await actions.forceFile(request.value.id)
  if (!applyUpdate(outcome, 'bookRequests.review.fileFailed')) return

  resetReview()
  toast.success(t('bookRequests.review.filed'))
}
</script>

<template>
  <!--
    A container query, not a viewport one: this panel is 600px inside a 1920px window, and every
    breakpoint in it would otherwise size itself against the screen it cannot see.
  -->
  <div class="@container relative flex h-full min-h-0 flex-col text-sm leading-[1.45] text-foreground" @keydown="handleKeydown">
    <RequestDrawerToolbar stepper>
      <template #actions>
        <DropdownMenu v-if="hasMenuActions">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" :aria-label="t('bookRequests.card.moreActions', { title: request?.title ?? '' })">
              <Ellipsis :size="16" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="min-w-[220px]">
            <!-- Closing it by hand is the escape hatch, so it is offered here and not in the body. -->
            <DropdownMenuItem v-if="canFulfill" :disabled="busy" @click="openFulfil">
              {{ t('bookRequests.actions.closeRequest') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canDismiss && !request?.dismissed" :disabled="busy" @click="handleDismiss">
              {{ t('bookRequests.actions.hide') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canDismiss && request?.dismissed" :disabled="busy" @click="handleRestore">
              {{ t('bookRequests.actions.unhide') }}
            </DropdownMenuItem>
            <!-- Only for somebody who joined this rather than made it: the way back out of the
                 attach that folds a second request for the same book into the first. -->
            <DropdownMenuItem v-if="canLeave" :disabled="busy" @click="handleLeave">
              {{ t('bookRequests.actions.leave') }}
            </DropdownMenuItem>
            <DropdownMenuSeparator v-if="menuNeedsRule" />
            <DropdownMenuItem v-if="canCancel" variant="destructive" :disabled="busy" @click="handleCancel">
              {{ t('bookRequests.actions.cancel') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canDelete" variant="destructive" :disabled="busy" @click="handleRemove">
              {{ t('bookRequests.actions.delete') }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
    </RequestDrawerToolbar>

    <!-- The whole body takes dropped files, wherever the request can take an upload. -->
    <div
      class="relative flex min-h-0 flex-1 flex-col"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
      <div class="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6 @min-[30rem]:px-5 @min-[30rem]:pt-5 @min-[30rem]:pb-7">
        <div v-if="loading" role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('bookRequests.detail.loading') }}
        </div>

        <EntityNotFound v-else-if="error === 'notFound' || error === 'forbidden'" :entity="t('bookRequests.detail.entityName')" />

        <div v-else-if="error" role="alert" class="flex flex-wrap items-center gap-3">
          <p class="text-sm text-destructive">{{ t(`bookRequests.detail.errors.${error}`) }}</p>
          <Button variant="outline" size="sm" :disabled="loading" @click="handleRetryLoad">{{ t('common.retry') }}</Button>
        </div>

        <template v-else-if="request">
          <RequestPairSwitch v-if="companion" :request="request" :companion="companion" :progress-by-request="progressByRequest" />

          <header class="flex items-start gap-4">
            <RequestCover
              :src="request.coverUrl"
              :fallback-sources="bookCoverSources"
              :media-kind="request.mediaKind"
              class="h-24 w-16 rounded-sm! shadow-[0_6px_16px_oklch(0_0_0/0.22)]"
              :icon-size="22"
            />

            <div class="min-w-0 flex-1 pt-0.5">
              <h2 class="text-[19px] leading-[1.25] font-[650] tracking-[-0.01em] text-balance text-foreground">{{ request.title }}</h2>
              <p class="mt-1 text-sm text-muted-foreground">{{ authorLine || t('bookRequests.detail.unknownAuthor') }}</p>

              <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <component :is="mediaIcon" :size="13" class="flex-none" aria-hidden="true" />
                  {{ t(`bookRequests.mediaKind.${request.mediaKind}`) }}
                </span>
                <span v-if="request.targetLibraryName" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Library :size="13" class="flex-none" aria-hidden="true" />
                  {{ request.targetLibraryName }}
                </span>
                <!-- Where the files go matters more than which library, once there is a book to join. -->
                <RouterLink
                  v-if="joinsBookId !== null"
                  :to="{ name: 'book-detail', params: { bookId: joinsBookId } }"
                  class="inline-flex items-center gap-1.5 rounded-sm text-xs text-foreground hover:underline hover:underline-offset-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  :title="t('bookRequests.detail.joinsBookHint')"
                >
                  <BookHeadphones :size="13" class="flex-none" aria-hidden="true" />
                  {{ t('bookRequests.detail.joinsBook') }}
                </RouterLink>
                <span v-if="request.subscribers.length" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users :size="13" class="flex-none" aria-hidden="true" />
                  {{ t('bookRequests.card.alsoWantedCount', { count: request.subscribers.length }) }}
                </span>
                <span v-if="request.dismissed" class="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <EyeOff :size="13" class="flex-none" aria-hidden="true" />
                  {{ t('bookRequests.card.dismissedBadge') }}
                </span>
              </div>
            </div>
          </header>

          <RequestStatusCard
            :request="request"
            :live="liveProgress"
            :review="review"
            :can-decide="canDecide"
            :seeding="seeding"
            :upload="uploadSummary"
            :viewer-is-requester="viewerIsRequester"
          />

          <RequestUploadSection
            v-if="uploadSectionState"
            :request="request"
            :state="uploadSectionState"
            :busy="busy"
            @choose-unit="handleChooseUploadUnit"
            @hold="handleUploadHold"
            @add-more="handleAddMore"
            @retry-file="handleRetryUploadFile"
          />

          <!-- First, because it is the decision the hold is waiting on. -->
          <ReleaseUnitChooser v-if="canFulfilThis && releaseUnits.length" :units="releaseUnits" :busy="busy" @choose="handleChooseReleaseUnit" />

          <!-- The decision inputs live here; the buttons that consume them sit in the footer. -->
          <RequestDrawerSection v-if="canDecide" :title="t('bookRequests.detail.decideTitle')">
            <div class="grid grid-cols-1 gap-3 @min-[30rem]:grid-cols-2">
              <div class="grid min-w-0 gap-1.5">
                <label for="request-target-library" class="text-xs font-medium text-foreground">
                  {{ t('bookRequests.detail.destinationLibraryLabel') }}
                </label>
                <select
                  id="request-target-library"
                  :value="targetLibraryId ?? ''"
                  class="h-9 w-full rounded-sm border border-input bg-background px-2.5 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  @change="handleLibraryChange"
                >
                  <!-- Names the instance default, so an approver can see where a request that
                     chose nowhere would land rather than guessing from an empty select. -->
                  <option value="">{{ unpickedDestinationLabel }}</option>
                  <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
                </select>
              </div>

              <div class="grid min-w-0 gap-1.5">
                <label for="request-language" class="text-xs font-medium text-foreground">{{ t('bookRequests.detail.languageLabel') }}</label>
                <select
                  id="request-language"
                  :value="request?.language ?? ''"
                  class="h-9 w-full rounded-sm border border-input bg-background px-2.5 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  @change="handleLanguageChange"
                >
                  <option value="">{{ t('bookRequests.detail.languageAny') }}</option>
                  <option v-for="option in languageOptions" :key="option.code" :value="option.code">{{ option.name }}</option>
                </select>
              </div>

              <div v-if="folders.length > 1" class="grid min-w-0 gap-1.5 @min-[30rem]:col-span-2">
                <label for="request-target-folder" class="text-xs font-medium text-foreground">
                  {{ t('bookRequests.detail.destinationFolderLabel') }}
                </label>
                <select
                  id="request-target-folder"
                  :value="targetFolderId ?? ''"
                  class="h-9 w-full rounded-sm border border-input bg-background px-2.5 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  @change="handleFolderChange"
                >
                  <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
                </select>
              </div>

              <div class="grid min-w-0 gap-1.5 @min-[30rem]:col-span-2">
                <label for="request-decision-note" class="text-xs font-medium text-foreground">{{
                  t('bookRequests.detail.decisionNoteLabel')
                }}</label>
                <input
                  id="request-decision-note"
                  v-model="decisionNote"
                  type="text"
                  class="h-9 w-full rounded-sm border border-input bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  :placeholder="t('bookRequests.detail.decisionNotePlaceholder')"
                />
              </div>
            </div>

            <p v-if="targetLibraryId === null" class="mt-2.5 text-[13px] text-muted-foreground">{{ t('bookRequests.detail.destinationRequired') }}</p>
          </RequestDrawerSection>

          <RequestReviewPanel v-if="isHeld && review" :review="review" :cover-url="reviewCoverUrl" :can-manage="canFulfilThis" />

          <RequestDrawerSection v-if="request.download" :title="t('bookRequests.detail.releaseSection')">
            <p class="text-sm font-medium [overflow-wrap:anywhere] text-foreground">{{ request.download.releaseTitle }}</p>
            <p class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
              <Upload v-if="request.download.source === 'upload'" :size="13" class="flex-none" aria-hidden="true" />
              <span v-else class="size-2 flex-none rounded-full" :class="sourceDotClass(request.download.indexerColor)" aria-hidden="true" />
              <template v-for="(part, index) in releaseMeta" :key="index">
                <span v-if="index > 0" aria-hidden="true">·</span>
                <span :class="part.numeric ? 'tabular-nums' : undefined">{{ part.text }}</span>
              </template>
            </p>

            <RequestSeedPanel
              v-if="canFulfilThis"
              :request="request"
              :busy="busy"
              :can-manage="canManage"
              @remove="handleRemoveDownload"
              @seeding="handleSeeding"
            />

            <!-- What was tried before this, and what those sources said. Approvers only: it names indexers. -->
            <RequestAttemptsPanel v-if="canFulfilThis" :request="request" :can-manage="canManage" />
          </RequestDrawerSection>

          <RequestDrawerSection :title="t('bookRequests.detail.requestSection')">
            <dl class="grid grid-cols-2 gap-x-6 gap-y-3.5 @min-[35rem]:grid-cols-3">
              <div v-for="fact in facts" :key="fact.key" class="min-w-0">
                <dt class="text-xs text-muted-foreground">{{ fact.label }}</dt>
                <dd class="mt-0.5 text-sm [overflow-wrap:anywhere] text-foreground" :class="fact.numeric ? 'tabular-nums' : undefined">
                  {{ fact.value }}
                  <time v-if="fact.when" class="mt-px block text-xs text-muted-foreground tabular-nums" :datetime="fact.when.iso">{{
                    fact.when.text
                  }}</time>
                </dd>
              </div>
            </dl>

            <figure v-for="quote in quotes" :key="quote.key" class="mt-4 border-s-2 border-border py-px ps-3">
              <blockquote class="text-sm [overflow-wrap:anywhere] text-foreground">{{ quote.text }}</blockquote>
              <figcaption class="mt-[3px] text-xs text-muted-foreground">{{ quote.caption }}</figcaption>
            </figure>
          </RequestDrawerSection>
        </template>
      </div>

      <div
        v-if="dragDepth > 0"
        class="pointer-events-none absolute inset-2.5 z-[5] grid place-items-center rounded-[calc(var(--radius)+4px)] border-2 border-dashed border-[color-mix(in_oklab,var(--primary)_65%,transparent)] bg-[color-mix(in_oklab,var(--primary)_9%,color-mix(in_oklab,var(--background)_82%,transparent))] backdrop-blur-[2px]"
        aria-hidden="true"
      >
        <div class="grid max-w-[340px] justify-items-center gap-1.5 p-6 text-center">
          <span class="mb-1 grid size-11 place-items-center rounded-lg bg-[color-mix(in_oklab,var(--primary)_14%,transparent)] text-primary">
            <Upload :size="22" />
          </span>
          <p class="text-[15px] font-semibold text-foreground">{{ t('bookRequests.upload.drop.title') }}</p>
          <p class="text-[13px] leading-[1.45] text-muted-foreground">{{ t('bookRequests.upload.drop.body') }}</p>
        </div>
      </div>
    </div>

    <input ref="fileInput" type="file" multiple class="hidden" tabindex="-1" aria-hidden="true" @change="handleFilesPicked" />

    <!--
      The action the stage this request is at asks for, always here and never in the body. On a
      phone the key legend is hidden, so a footer with no action is not drawn there at all.
    -->
    <footer
      v-if="request"
      class="shrink-0 flex-wrap items-center gap-2 border-t border-border bg-background p-3 @min-[30rem]:px-4"
      :class="footerStage ? 'flex' : 'hidden @min-[30rem]:flex'"
    >
      <template v-if="footerStage === 'decide'">
        <Button v-if="canApproveBoth" :disabled="!canApproveBoth" @click="handleApproveBoth">
          <BookHeadphones :size="14" aria-hidden="true" />
          {{ t('bookRequests.actions.pair.approveBoth') }}
        </Button>
        <Button
          v-if="drawer?.hasNext.value"
          :variant="canApproveBoth ? 'outline' : 'default'"
          :disabled="!canApproveNow"
          @click="handleApproveAndNext"
        >
          {{ t('bookRequests.actions.approveAndNext') }}
        </Button>
        <Button
          :variant="drawer?.hasNext.value || canApproveBoth ? 'outline' : 'default'"
          :disabled="!canApproveNow"
          aria-keyshortcuts="a"
          @click="handleApprove"
        >
          {{ approveLabel }}
        </Button>
        <Button variant="destructive-outline" :disabled="busy" @click="handleReject">{{ t('bookRequests.actions.reject') }}</Button>
      </template>

      <Button v-else-if="footerStage === 'transfer'" variant="destructive-outline" :disabled="busy" @click="handleCancelDownload">
        {{ t('bookRequests.actions.cancelDownload') }}
      </Button>

      <template v-else-if="footerStage === 'uploading' || footerStage === 'uploadPaused'">
        <template v-if="footerStage === 'uploadPaused'">
          <Button v-if="retryableUploadCount > 0" :disabled="busy" @click="handleRetryUpload">
            <RotateCcw :size="15" aria-hidden="true" />
            {{ t('bookRequests.upload.retry', { count: retryableUploadCount }) }}
          </Button>
          <Button v-else :disabled="busy" @click="handleAddMissing">
            <Upload :size="15" aria-hidden="true" />
            {{ t('bookRequests.upload.addMissing') }}
          </Button>
        </template>
        <Button v-if="canCancel" variant="destructive-outline" :disabled="busy" @click="handleCancelUpload">
          <X :size="15" aria-hidden="true" />
          {{ t('bookRequests.upload.cancel') }}
        </Button>
      </template>

      <template v-else-if="footerStage === 'uploadReady' && stagedUpload">
        <Button :disabled="!canSendUpload" @click="handleStartUpload">
          <Loader2 v-if="stagedUpload.starting" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          <Upload v-else :size="15" aria-hidden="true" />
          {{ uploadSendCount > 0 ? t('bookRequests.upload.send', { count: uploadSendCount }) : t('bookRequests.upload.action') }}
        </Button>
        <Button variant="ghost" :disabled="stagedUpload.starting" @click="handleClearUpload">{{ t('bookRequests.upload.clear') }}</Button>
      </template>

      <template v-else-if="footerStage === 'grab'">
        <Button :disabled="busy" @click="goToReleases">
          <RefreshCw v-if="isRetry" :size="15" aria-hidden="true" />
          <Search v-else :size="15" aria-hidden="true" />
          {{ isRetry ? t('bookRequests.actions.retryRelease') : t('bookRequests.actions.pickRelease') }}
        </Button>
        <!-- Closing it by hand stays in the menu; the footer offers the files instead. -->
        <Button
          v-if="canUpload || targetReadOnly"
          variant="outline"
          :disabled="busy || targetReadOnly"
          :title="targetReadOnly ? t('library.readOnly.reason') : undefined"
          @click="handleUploadFiles"
        >
          <Upload :size="15" aria-hidden="true" />
          {{ t('bookRequests.upload.action') }}
        </Button>
        <Button v-else-if="canFulfill" variant="ghost" class="hidden @min-[30rem]:inline-flex" :disabled="busy" @click="openFulfil">
          {{ t('bookRequests.actions.closeRequest') }}
        </Button>
      </template>

      <template v-else-if="footerStage === 'review' && review">
        <Button :disabled="!review.canFile || busy" @click="handleFileAnyway">
          <Loader2 v-if="busy" class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ fileIsOverride ? t('bookRequests.review.fileAnyway') : t('bookRequests.review.fileIt') }}
        </Button>
        <!--
          The other answer, beside the first rather than behind a menu: a held import is a question
          with exactly two answers, and "wrong book" must not mean cancelling and orphaning the file.
        -->
        <Button variant="destructive-outline" :disabled="busy" @click="handleDiscardImport">
          <Trash2 :size="15" aria-hidden="true" />
          {{ t('bookRequests.review.discard') }}
        </Button>
        <Button as-child variant="ghost" class="hidden @min-[30rem]:inline-flex">
          <RouterLink :to="{ name: 'book-dock' }">{{ t('bookRequests.review.openDock') }}</RouterLink>
        </Button>
      </template>

      <Button v-else-if="footerStage === 'reviewGone'" :disabled="busy" @click="openFulfil">{{ t('bookRequests.actions.closeRequest') }}</Button>

      <Button v-else-if="footerStage === 'done' && goToBookId !== null" as-child>
        <RouterLink :to="{ name: 'book-detail', params: { bookId: goToBookId } }">
          {{ t('bookRequests.actions.goToBook') }}
          <ArrowRight :size="15" class="rtl:rotate-180" aria-hidden="true" />
        </RouterLink>
      </Button>

      <!-- A legend for sighted keyboard users; the same keys are spoken from the line after it. -->
      <p class="ms-auto hidden items-center gap-[3px] text-xs whitespace-nowrap text-muted-foreground @min-[30rem]:inline-flex" aria-hidden="true">
        <kbd :class="KBD_CLASS">{{ SHORTCUT_KEYS.next }}</kbd>
        <kbd :class="KBD_CLASS">{{ SHORTCUT_KEYS.previous }}</kbd>
        <span class="ms-0.5 me-1.5">{{ t('bookRequests.drawer.keys.move') }}</span>
        <template v-if="canDecide">
          <kbd :class="KBD_CLASS">{{ SHORTCUT_KEYS.approve }}</kbd>
          <span class="ms-0.5 me-1.5">{{ t('bookRequests.drawer.keys.approve') }}</span>
        </template>
        <kbd :class="KBD_CLASS">{{ t('bookRequests.drawer.keys.esc') }}</kbd>
        <span class="ms-0.5">{{ t('bookRequests.drawer.keys.close') }}</span>
      </p>
      <p class="sr-only">{{ canDecide ? t('bookRequests.drawer.shortcuts') : t('bookRequests.drawer.shortcutsNoApprove') }}</p>
    </footer>

    <ConfirmDialog
      :open="confirming !== null"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-label="confirmLabel"
      :cancel-label="confirmKeepLabel"
      :busy="busy"
      @confirm="handleConfirm"
      @cancel="handleConfirmCancel"
    />

    <RequestFulfilDialog :open="fulfilOpen" :busy="busy" @fulfil="handleFulfill" @cancel="handleFulfilCancel" />
  </div>
</template>
