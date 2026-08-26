<script setup lang="ts">
import { computed, inject, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  BookOpen,
  ChevronDown,
  Ellipsis,
  ExternalLink,
  EyeOff,
  FileText,
  Headphones,
  Images,
  Library,
  Loader2,
  Search,
  TriangleAlert,
  Users,
} from '@lucide/vue'
import { isBookRequestFulfiller, isFulfillableBookRequestStatus, isGrabbableBookRequestStatus, Permission } from '@bookorbit/types'
import type { BookCard, BookDockFile, BookRequestItem } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import BookCoverImage from '@/features/book/components/BookCoverImage.vue'
import EntityNotFound from '@/components/EntityNotFound.vue'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { formatDateTime } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import RequestCover from './RequestCover.vue'
import ReleaseUnitChooser from './ReleaseUnitChooser.vue'
import RequestReviewPanel from './RequestReviewPanel.vue'
import RequestDownloadProgress from './RequestDownloadProgress.vue'
import RequestDrawerToolbar from './RequestDrawerToolbar.vue'
import RequestPipeline from './RequestPipeline.vue'
import RequestAttemptsPanel from './RequestAttemptsPanel.vue'
import RequestSeedPanel from './RequestSeedPanel.vue'
import RequestStatusBadge from './RequestStatusBadge.vue'
import { useBookRequestActions, type ActionOutcome } from '../composables/useBookRequests'
import { useBookRequestDetail } from '../composables/useBookRequestDetail'
import { useBookRequestProgress } from '../composables/useBookRequestProgress'
import { useCoalescedRefresh } from '../composables/useCoalescedRefresh'
import { useFulfilmentPicker, type FulfilmentSource } from '../composables/useFulfilmentPicker'
import { formatLanguageName } from '@/i18n/formatters'
import { requestLanguageOptions, useRequestDestinationDefault } from '../composables/useRequestDestinationDefault'
import { useRequestReview } from '../composables/useRequestReview'
import { REQUEST_DRAWER } from '../requestDrawerContext'
import { canCancelRequest, canDeleteRequest, canDismissRequest, canLeaveRequest, cancelStopsATransfer } from '../requestActions'
import { requestFailureText } from '../requestOutcome'
import { currentRequestProgress, requestPresentationStatus } from '../requestPipeline'

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const { hasPermission } = usePermissions()
const { user } = useAuth()
const drawer = inject(REQUEST_DRAWER, null)

const MEDIA_ICONS = { ebook: BookOpen, audiobook: Headphones, comic: Images } as const

/** The same window the list behind the drawer collapses its own refreshes into. */
const CHANGE_REFRESH_WINDOW_MS = 400

/**
 * Accessor form of the moderator check, declared before the composables that take it: they read
 * the reference at call time, and a `const` further down is still in its temporal dead zone.
 * Composables cannot ask `usePermissions` themselves, because that reaches the router.
 */
const canManageFn = () => hasPermission(Permission.ManageBookRequests)

const { request, loading, error, fetchRequest, setRequest } = useBookRequestDetail()
const { libraries, fetchLibraries } = useLibraries()
const { load: loadDefaultDestination, defaultFor: instanceDefaultFor, resolveDestination } = useRequestDestinationDefault()
const { progressByRequest, onRequestsChanged, pruneSettledProgress } = useBookRequestProgress()
const actions = useBookRequestActions(canManageFn)
const picker = useFulfilmentPicker()
const { review, fetchReview, reset: resetReview } = useRequestReview(canManageFn)

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
const mediaIcon = computed(() => (request.value ? (MEDIA_ICONS[request.value.mediaKind] ?? BookOpen) : BookOpen))
const authorLine = computed(() => request.value?.authors.join(', ') ?? '')
/** Non-empty only while an attempt is held because its release turned out to hold several books. */
const releaseUnits = computed(() => request.value?.download?.releaseUnits ?? [])
const isHeld = computed(() => request.value?.status === 'needs_review')
/**
 * The panel restates the hold in full only when it has a score to show. With no score, or with
 * the dock entry gone, the server's own sentence is the only record of why this stopped, so it
 * stays. It also stays for every ordinary failure, which has no panel at all.
 */
const failureText = computed(() => (request.value ? requestFailureText(request.value, (key, named) => t(key, named)) : null))
const showFailureReason = computed(() => failureText.value != null && !(isHeld.value && review.value?.verification != null))
/** Only a request that stopped badly earns the destructive treatment; a hand-back is information. */
const failureIsAlarming = computed(() => request.value?.status === 'failed' || request.value?.status === 'needs_review')
/** Whoever is going to say it, the transfer line is not the one that should say it twice. */
const showDownloadError = computed(() => !showFailureReason.value && !(isHeld.value && review.value !== null))
const liveProgress = computed(() => {
  if (!request.value) return null
  return currentRequestProgress(request.value, progressByRequest.value[request.value.id])
})
const presentationStatus = computed(() => (request.value ? requestPresentationStatus(request.value, liveProgress.value) : null))

const isPending = computed(() => request.value?.status === 'pending')
const canDecide = computed(() => canManage.value && isPending.value)
const canGrab = computed(() => canFulfilThis.value && request.value != null && isGrabbableBookRequestStatus(request.value.status))
const showTransferRetry = computed(() => canGrab.value && request.value?.download?.status === 'failed')
const canFulfill = computed(() => canManage.value && request.value != null && isFulfillableBookRequestStatus(request.value.status))
const canCancel = computed(() =>
  request.value ? canCancelRequest(request.value, user.value?.id ?? null, canManage.value, hasPermission(Permission.BookRequestSelfFulfill)) : false,
)
const canDismiss = computed(() => (request.value ? canDismissRequest(request.value) : false))
const canDelete = computed(() => (request.value ? canDeleteRequest(request.value, canManage.value) : false))
const canLeave = computed(() => (request.value ? canLeaveRequest(request.value, user.value?.id ?? null) : false))
const hasMenuActions = computed(() => canDismiss.value || canLeave.value || canCancel.value || canDelete.value)
const canApproveNow = computed(() => canDecide.value && !busy.value && targetLibraryId.value !== null)
const showFooter = computed(() => canDecide.value || (canGrab.value && !showTransferRetry.value))

const confirming = ref<'cancel' | 'delete' | 'leave' | 'discardImport' | null>(null)

const CONFIRM_COPY = {
  delete: { title: 'bookRequests.confirm.deleteTitle', label: 'bookRequests.actions.delete' },
  leave: { title: 'bookRequests.confirm.leaveTitle', label: 'bookRequests.actions.leave' },
  discardImport: { title: 'bookRequests.confirm.discardImportTitle', label: 'bookRequests.review.discard' },
  cancel: { title: 'bookRequests.confirm.cancelTitle', label: 'bookRequests.actions.cancel' },
} as const

const confirmTitle = computed(() => t(CONFIRM_COPY[confirming.value ?? 'cancel'].title))

const confirmDescription = computed(() => {
  if (confirming.value === 'delete') return t('bookRequests.confirm.deleteDescription')
  if (confirming.value === 'leave') return t('bookRequests.confirm.leaveDescription')
  if (confirming.value === 'discardImport') return t('bookRequests.confirm.discardImportDescription')
  return request.value && cancelStopsATransfer(request.value)
    ? t('bookRequests.confirm.cancelDescriptionWithDownload')
    : t('bookRequests.confirm.cancelDescription')
})

const confirmLabel = computed(() => t(CONFIRM_COPY[confirming.value ?? 'cancel'].label))

const selectedLibrary = computed(() => libraries.value.find((library) => library.id === targetLibraryId.value) ?? null)
const folders = computed(() => selectedLibrary.value?.folders ?? [])
const grabLabel = computed(() => (request.value?.status === 'failed' ? 'bookRequests.actions.retryRelease' : 'bookRequests.actions.grab'))

const pickerResults = computed(() => (picker.source.value === 'book' ? picker.books.value : picker.dockFiles.value))
const hasSearched = computed(() => picker.query.value.trim() !== '')

onMounted(async () => {
  await fetchRequest(requestId.value)
  resetDestination()
  void syncReview()
})

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
  canManage,
  (allowed) => {
    if (!allowed) return
    void fetchLibraries()
    void loadDefaultDestination()
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
  }, CHANGE_REFRESH_WINDOW_MS),
)

// The fetched row is the authority once its attempt has settled; the last tick is then just noise.
watch(request, (row) => {
  if (row) pruneSettledProgress([row])
})

// Stepping to the next request keeps this component mounted and only swaps the id under it.
watch(requestId, async (id) => {
  if (!Number.isInteger(id)) return
  picker.reset()
  decisionNote.value = ''
  resetReview()
  await fetchRequest(id)
  resetDestination()
  void syncReview()
})

// Libraries can land after the panel has rendered, and an untouched picker still needs them.
watch(libraries, () => {
  if (targetLibraryId.value === null) resetDestination()
})

/** What approving without touching this would do, which is the instance default for its medium. */
const unpickedDestinationLabel = computed(() => {
  const fallback = instanceDefaultFor(request.value?.mediaKind ?? 'ebook')
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
    // The reason is third-party prose from a tracker or download client, so it is shown as the
    // server wrote it under a translated heading rather than matched against known English.
    toast.error(t(failureKey), outcome.reason ? { description: outcome.reason } : undefined)
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
  const outcome = await actions.cancel(request.value.id)
  if (applyUpdate(outcome, 'bookRequests.errors.cancelFailed')) toast.success(t('bookRequests.toasts.cancelled'))
}

async function deleteRequest() {
  if (!request.value) return
  const outcome = await actions.remove(request.value.id)
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

async function handleFulfill() {
  const payload = picker.toPayload()
  if (!request.value || !payload) return
  const outcome = await actions.fulfill(request.value.id, payload)
  if (applyUpdate(outcome, 'bookRequests.errors.fulfilFailed')) {
    picker.reset()
    toast.success(t('bookRequests.toasts.fulfilled'))
  }
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

function handlePickerQuery(event: Event) {
  picker.search((event.target as HTMLInputElement).value)
}

function selectBookSource() {
  picker.setSource('book' satisfies FulfilmentSource)
}

function selectDockSource() {
  picker.setSource('dockFile' satisfies FulfilmentSource)
}

function selectBook(book: BookCard) {
  picker.select({ source: 'book', id: book.id })
}

function selectDockFile(file: BookDockFile) {
  picker.select({ source: 'dockFile', id: file.id })
}

function dockFileMeta(file: BookDockFile): string {
  return [file.format?.toUpperCase(), file.fileSize === null ? null : formatBytes(file.fileSize)].filter(Boolean).join(' · ')
}
</script>

<template>
  <!--
    A container query, not a viewport one: this panel is 600px inside a 1920px window, and every
    `sm:` or `xl:` in it would otherwise size itself against the screen it cannot see.
  -->
  <div class="@container flex h-full min-h-0 flex-col" @keydown="handleKeydown">
    <RequestDrawerToolbar stepper>
      <template #actions>
        <DropdownMenu v-if="hasMenuActions">
          <DropdownMenuTrigger as-child>
            <Button variant="ghost" size="icon-sm" :aria-label="t('bookRequests.card.moreActions', { title: request?.title ?? '' })">
              <Ellipsis :size="16" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem v-if="canDismiss && !request?.dismissed" :disabled="busy" @click="handleDismiss">
              {{ t('bookRequests.actions.dismiss') }}
            </DropdownMenuItem>
            <DropdownMenuItem v-if="canDismiss && request?.dismissed" :disabled="busy" @click="handleRestore">
              {{ t('bookRequests.actions.restore') }}
            </DropdownMenuItem>
            <!-- Only for somebody who joined this rather than made it: the way back out of the
                 attach that folds a second request for the same book into the first. -->
            <DropdownMenuItem v-if="canLeave" :disabled="busy" @click="handleLeave">
              {{ t('bookRequests.actions.leave') }}
            </DropdownMenuItem>
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

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div v-if="loading" role="status" class="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 class="size-4 animate-spin" aria-hidden="true" />
        {{ t('bookRequests.detail.loading') }}
      </div>

      <EntityNotFound v-else-if="error === 'notFound' || error === 'forbidden'" :entity="t('bookRequests.detail.entityName')" />

      <div v-else-if="error" role="alert" class="flex flex-wrap items-center gap-3">
        <p class="text-sm text-destructive">{{ t(`bookRequests.detail.errors.${error}`) }}</p>
        <Button variant="outline" size="sm" :disabled="loading" @click="handleRetryLoad">{{ t('common.retry') }}</Button>
      </div>

      <template v-else-if="request">
        <header class="flex items-start gap-4">
          <RequestCover :src="request.coverUrl" :media-kind="request.mediaKind" class="h-[105px] w-[70px] shadow-sm" :icon-size="24" />

          <div class="min-w-0 flex-1 space-y-1.5">
            <h2 class="text-lg leading-snug font-semibold tracking-tight text-foreground">{{ request.title }}</h2>
            <p class="text-sm text-muted-foreground">{{ authorLine || t('bookRequests.detail.unknownAuthor') }}</p>

            <div class="flex flex-wrap items-center gap-1.5 pt-1">
              <RequestStatusBadge :status="presentationStatus ?? request.status" />
              <span class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
                <component :is="mediaIcon" :size="12" aria-hidden="true" />
                {{ t(`bookRequests.mediaKind.${request.mediaKind}`) }}
              </span>
              <span
                v-if="request.targetLibraryName"
                class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                <Library :size="12" aria-hidden="true" />
                {{ request.targetLibraryName }}
              </span>
              <Button
                v-if="request.status === 'available' && request.matchedBookId !== null"
                as-child
                variant="outline"
                size="sm"
                class="h-6 rounded-full px-2 text-xs shadow-none"
              >
                <RouterLink :to="{ name: 'book-detail', params: { bookId: request.matchedBookId } }">
                  <ExternalLink class="size-3" aria-hidden="true" />
                  {{ t('bookRequests.actions.goToBook') }}
                </RouterLink>
              </Button>
              <span
                v-if="request.subscribers.length"
                class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                <Users :size="12" aria-hidden="true" />
                {{ t('bookRequests.card.alsoWantedCount', { count: request.subscribers.length }) }}
              </span>
              <span
                v-if="request.dismissed"
                class="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground"
              >
                <EyeOff :size="12" aria-hidden="true" />
                {{ t('bookRequests.card.dismissedBadge') }}
              </span>
            </div>
          </div>
        </header>

        <div class="mt-5 space-y-4">
          <section class="rounded-lg border border-border bg-card p-4" :aria-label="t('bookRequests.pipeline.label')">
            <h3 class="mb-3.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookRequests.pipeline.label') }}</h3>
            <RequestPipeline :request="request" :live="liveProgress" />
          </section>

          <section v-if="request.download" class="rounded-lg border border-border bg-card p-4" :aria-label="t('bookRequests.detail.transfer')">
            <h3 class="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookRequests.detail.transfer') }}</h3>
            <RequestDownloadProgress
              :download="request.download"
              :live="liveProgress"
              :show-error="showDownloadError"
              :can-retry="showTransferRetry"
              @retry="goToReleases"
            />
          </section>

          <!--
            Under the current transfer, because that is the question it answers: what was tried
            before this, and what did those sources say. Approvers only: it names indexers.
          -->
          <RequestAttemptsPanel v-if="canFulfilThis" :request="request" :can-manage="canManage" />

          <!-- Sits above the failure reason: the reason says a choice is needed, and this is it. -->
          <ReleaseUnitChooser v-if="canFulfilThis && releaseUnits.length" :units="releaseUnits" :busy="busy" @choose="handleChooseReleaseUnit" />

          <RequestReviewPanel
            v-if="isHeld && review"
            :review="review"
            :can-manage="canFulfilThis"
            :busy="busy"
            @file="handleFileAnyway"
            @discard="handleDiscardImport"
          />

          <!--
            Alarm styling and `role="alert"` are for a request that actually failed. Automation also
            hands a request back at `approved` with a reason on it, and shouting an interruption at
            somebody about a request that is simply waiting for them is the wrong register.
          -->
          <p
            v-if="showFailureReason"
            :role="failureIsAlarming ? 'alert' : 'status'"
            class="flex items-start gap-2 rounded-lg border p-3"
            :class="failureIsAlarming ? 'border-destructive/40 bg-destructive/8' : 'border-border bg-muted'"
          >
            <TriangleAlert
              :size="15"
              class="mt-0.5 shrink-0"
              :class="failureIsAlarming ? 'text-destructive' : 'text-muted-foreground'"
              aria-hidden="true"
            />
            <span class="text-sm" :class="failureIsAlarming ? 'text-destructive' : 'text-foreground'">{{ failureText }}</span>
          </p>

          <!-- The decision inputs live here; the buttons that consume them sit in the footer. -->
          <section v-if="canDecide" class="space-y-3 rounded-lg border border-border bg-card p-4">
            <h3 class="text-sm font-semibold text-foreground">{{ t('bookRequests.detail.decideTitle') }}</h3>

            <div class="grid gap-3 @xl:grid-cols-2">
              <div>
                <label for="request-target-library" class="mb-1 block text-sm font-medium text-foreground">
                  {{ t('bookRequests.detail.destinationLibraryLabel') }}
                </label>
                <select
                  id="request-target-library"
                  :value="targetLibraryId ?? ''"
                  class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  @change="handleLibraryChange"
                >
                  <!-- Names the instance default, so an approver can see where a request that
                       chose nowhere would land rather than guessing from an empty select. -->
                  <option value="">{{ unpickedDestinationLabel }}</option>
                  <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
                </select>
              </div>

              <div>
                <label for="request-language" class="mb-1 block text-sm font-medium text-foreground">
                  {{ t('bookRequests.detail.languageLabel') }}
                </label>
                <select
                  id="request-language"
                  :value="request?.language ?? ''"
                  class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  @change="handleLanguageChange"
                >
                  <option value="">{{ t('bookRequests.detail.languageAny') }}</option>
                  <option v-for="option in languageOptions" :key="option.code" :value="option.code">{{ option.name }}</option>
                </select>
              </div>

              <div v-if="folders.length > 1">
                <label for="request-target-folder" class="mb-1 block text-sm font-medium text-foreground">
                  {{ t('bookRequests.detail.destinationFolderLabel') }}
                </label>
                <select
                  id="request-target-folder"
                  :value="targetFolderId ?? ''"
                  class="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  @change="handleFolderChange"
                >
                  <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
                </select>
              </div>
            </div>

            <div>
              <label for="request-decision-note" class="mb-1 block text-sm font-medium text-foreground">
                {{ t('bookRequests.detail.decisionNoteLabel') }}
              </label>
              <Input id="request-decision-note" v-model="decisionNote" :placeholder="t('bookRequests.detail.decisionNotePlaceholder')" />
            </div>

            <p v-if="targetLibraryId === null" class="text-sm text-muted-foreground">{{ t('bookRequests.detail.destinationRequired') }}</p>
          </section>

          <!--
            Was two number inputs asking for a database id. Now it searches the thing being named,
            and the id never reaches the screen.

            Shut by default, and keyed on the request so it shuts again when the drawer steps on:
            closing a request by hand is the escape hatch, not the reason anyone opened this.
          -->
          <details v-if="canFulfill" :key="requestId" class="group rounded-lg border border-border bg-card">
            <summary
              class="flex cursor-pointer list-none items-center gap-2 rounded-lg p-4 text-sm font-semibold text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&::-webkit-details-marker]:hidden"
            >
              {{ t('bookRequests.detail.fulfilTitle') }}
              <ChevronDown
                :size="15"
                class="ms-auto shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                aria-hidden="true"
              />
            </summary>

            <div class="space-y-3 px-4 pb-4">
              <p class="text-sm text-muted-foreground">{{ t('bookRequests.detail.fulfilHint') }}</p>

              <div
                class="inline-flex gap-0.5 rounded-lg border border-border bg-muted p-0.5"
                role="group"
                :aria-label="t('bookRequests.detail.fulfilSourceLabel')"
              >
                <button
                  type="button"
                  class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                  :class="picker.source.value === 'book' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
                  :aria-pressed="picker.source.value === 'book'"
                  @click="selectBookSource"
                >
                  {{ t('bookRequests.detail.fulfilFromLibrary') }}
                </button>
                <button
                  type="button"
                  class="rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                  :class="
                    picker.source.value === 'dockFile' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
                  "
                  :aria-pressed="picker.source.value === 'dockFile'"
                  @click="selectDockSource"
                >
                  {{ t('bookRequests.detail.fulfilFromDock') }}
                </button>
              </div>

              <div class="relative">
                <Search :size="15" class="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <label for="fulfil-search" class="sr-only">{{ t('bookRequests.detail.fulfilSearchLabel') }}</label>
                <input
                  id="fulfil-search"
                  type="search"
                  :value="picker.query.value"
                  class="h-9 w-full rounded-md border border-input bg-background ps-9 pe-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  :placeholder="
                    picker.source.value === 'book' ? t('bookRequests.detail.fulfilSearchBooks') : t('bookRequests.detail.fulfilSearchDock')
                  "
                  @input="handlePickerQuery"
                />
              </div>

              <p v-if="picker.searching.value" role="status" class="text-sm text-muted-foreground">{{ t('bookRequests.detail.fulfilSearching') }}</p>

              <p v-else-if="hasSearched && pickerResults.length === 0" role="status" class="text-sm text-muted-foreground">
                {{ t('bookRequests.detail.fulfilNoResults') }}
              </p>

              <ul v-else-if="picker.source.value === 'book' && picker.books.value.length" class="grid gap-2 @xl:grid-cols-2">
                <li v-for="book in picker.books.value" :key="book.id">
                  <button
                    type="button"
                    class="flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                    :class="
                      picker.isSelected({ source: 'book', id: book.id })
                        ? 'border-primary bg-primary/8'
                        : 'border-border bg-card hover:border-ring/50'
                    "
                    :aria-pressed="picker.isSelected({ source: 'book', id: book.id })"
                    @click="selectBook(book)"
                  >
                    <BookCoverImage
                      :book-id="book.id"
                      type="thumbnail"
                      :version="book.updatedAt"
                      class="h-[42px] w-7 shrink-0 rounded bg-muted object-cover"
                      :alt="''"
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-foreground">{{ book.title }}</span>
                      <span class="block truncate text-xs text-muted-foreground">{{ book.authors.join(', ') }}</span>
                    </span>
                  </button>
                </li>
              </ul>

              <ul v-else-if="picker.source.value === 'dockFile' && picker.dockFiles.value.length" class="grid gap-2 @xl:grid-cols-2">
                <li v-for="file in picker.dockFiles.value" :key="file.id">
                  <button
                    type="button"
                    class="flex w-full items-center gap-2.5 rounded-lg border p-2.5 text-start transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                    :class="
                      picker.isSelected({ source: 'dockFile', id: file.id })
                        ? 'border-primary bg-primary/8'
                        : 'border-border bg-card hover:border-ring/50'
                    "
                    :aria-pressed="picker.isSelected({ source: 'dockFile', id: file.id })"
                    @click="selectDockFile(file)"
                  >
                    <FileText :size="16" class="shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-sm font-medium text-foreground">{{ file.fileName }}</span>
                      <span class="block truncate text-xs text-muted-foreground">{{ dockFileMeta(file) }}</span>
                    </span>
                  </button>
                </li>
              </ul>

              <Button :disabled="busy || picker.selected.value === null" @click="handleFulfill">
                {{ t('bookRequests.actions.markFulfilled') }}
              </Button>
            </div>
          </details>

          <RequestSeedPanel v-if="canFulfilThis" :request="request" :busy="busy" :can-manage="canManage" @remove="handleRemoveDownload" />

          <section class="rounded-lg border border-border bg-card p-4">
            <h3 class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookRequests.detail.requestSection') }}</h3>
            <dl class="space-y-2.5">
              <div class="flex items-baseline justify-between gap-4">
                <dt class="text-sm text-muted-foreground">{{ t('bookRequests.detail.requestedBy') }}</dt>
                <dd class="text-end text-sm text-foreground">{{ request.requesterName }}</dd>
              </div>
              <div class="flex items-baseline justify-between gap-4">
                <dt class="text-sm text-muted-foreground">{{ t('bookRequests.detail.requestedOn') }}</dt>
                <dd class="text-end text-sm text-foreground tabular-nums">{{ formatDateTime(new Date(request.createdAt)) }}</dd>
              </div>
              <div v-if="request.decidedByUsername" class="flex items-baseline justify-between gap-4">
                <dt class="text-sm text-muted-foreground">{{ t('bookRequests.detail.decidedBy') }}</dt>
                <dd class="text-end text-sm text-foreground">{{ request.decidedByUsername }}</dd>
              </div>
              <div v-if="request.seriesName" class="flex items-baseline justify-between gap-4">
                <dt class="text-sm text-muted-foreground">{{ t('bookRequests.detail.series') }}</dt>
                <dd class="text-end text-sm text-foreground">{{ request.seriesName }}</dd>
              </div>
              <div v-if="request.isbn13" class="flex items-baseline justify-between gap-4">
                <dt class="text-sm text-muted-foreground">{{ t('bookRequests.detail.isbn') }}</dt>
                <dd class="text-end text-sm text-foreground tabular-nums">{{ request.isbn13 }}</dd>
              </div>
            </dl>
          </section>

          <section v-if="request.note || request.decisionNote" class="space-y-3 rounded-lg border border-border bg-card p-4">
            <div v-if="request.note">
              <h3 class="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {{ t('bookRequests.detail.requesterNote') }}
              </h3>
              <p class="text-sm text-muted-foreground">{{ request.note }}</p>
            </div>
            <div v-if="request.decisionNote">
              <h3 class="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {{ t('bookRequests.detail.decisionNote') }}
              </h3>
              <p class="text-sm text-muted-foreground">{{ request.decisionNote }}</p>
            </div>
          </section>

          <section v-if="request.subscribers.length" class="rounded-lg border border-border bg-card p-4">
            <h3 class="mb-3 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookRequests.detail.alsoWanted') }}</h3>
            <ul class="space-y-1.5">
              <li v-for="subscriber in request.subscribers" :key="subscriber.userId" class="text-sm text-muted-foreground">
                {{ subscriber.name }}
              </li>
            </ul>
          </section>
        </div>
      </template>
    </div>

    <!-- The action that matters for the stage this request is at, and nothing else. -->
    <footer v-if="request && showFooter" class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3">
      <template v-if="canDecide">
        <Button v-if="drawer?.hasNext.value" :disabled="!canApproveNow" @click="handleApproveAndNext">
          {{ t('bookRequests.actions.approveAndNext') }}
        </Button>
        <Button :variant="drawer?.hasNext.value ? 'outline' : 'default'" :disabled="!canApproveNow" aria-keyshortcuts="a" @click="handleApprove">
          {{ t('bookRequests.actions.approve') }}
        </Button>
        <Button variant="destructive-outline" :disabled="busy" @click="handleReject">{{ t('bookRequests.actions.reject') }}</Button>
      </template>

      <Button v-else-if="canGrab" :disabled="busy" @click="goToReleases">{{ t(grabLabel) }}</Button>

      <!-- A keyboard hint the keyboard user cannot see is not a hint. The footer already wraps. -->
      <p class="ms-auto text-xs text-muted-foreground">{{ t('bookRequests.drawer.shortcuts') }}</p>
    </footer>

    <ConfirmDialog
      :open="confirming !== null"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-label="confirmLabel"
      :busy="busy"
      @confirm="handleConfirm"
      @cancel="handleConfirmCancel"
    />
  </div>
</template>
