import { computed, onBeforeUnmount, onMounted, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import { Permission, type StoryGuideFixesChoice, type StoryGuideStatus } from '@bookorbit/types'

import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useAppInfo } from '@/features/settings/composables/useAppInfo'
import { errorMessage } from '@/lib/api-json'
import { buildStoryGuide, cancelStoryGuide, deleteStoryGuide, getStoryGuideStatus, retryStoryGuide } from '../api/story-guide.api'
import { watchStoryGuide } from '../lib/story-guide-socket'
import {
  isStoryGuideBuilding,
  isStoryGuideChecking,
  storyGuidePresentation,
  type StoryGuideAction,
  type StoryGuidePresentation,
} from '../lib/story-guide-presentation'

export const STORY_GUIDE_FIRST_POLL_MS = 5_000
export const STORY_GUIDE_LONGEST_POLL_MS = 60_000
export const STORY_GUIDE_CHECKING_AGAIN_MS = 3_000
export const STORY_GUIDE_STILL_THE_CASE_MS = 4_000

function failureKey(action: StoryGuideAction): string {
  switch (action) {
    case 'build':
    case 'update':
    case 'rebuild':
      return 'book.detail.storyGuide.failed.build'
    case 'retry':
    case 'keepBuilding':
    case 'resume':
      return 'book.detail.storyGuide.failed.retry'
    case 'cancelBuild':
    case 'dismiss':
      return 'book.detail.storyGuide.failed.cancel'
    case 'delete':
      return 'book.detail.storyGuide.failed.delete'
  }
}

/**
 * One book's story guide status for its page, for people who may build guides. Asked for when the
 * page opens, when the server offers story guides at all, and again whenever the `/story-guides`
 * socket says the book changed. While a build is queued or running and the page is visible it is
 * also polled: once a minute while the socket pushes, since another server may be running the job,
 * and otherwise starting at 5 seconds and doubling while nothing changes, up to a minute. Each ask
 * sends the last ETag, so an unchanged status is a `304`. A change heard while the page is hidden
 * is asked for when it is visible again, as is a build in progress. A status that says the server
 * is still reading the file is asked once more after 3 seconds; after that the socket says when the
 * reading is done, and without the socket it is asked again, waiting twice as long each time up to
 * a minute. Answers for a book the page has since left, and answers older than one already shown,
 * are dropped.
 */
export function useStoryGuideStatus(bookId: MaybeRefOrGetter<number>) {
  const { hasPermission } = usePermissions()
  const { ensureAppInfo, supportsFeature, storyGuides } = useAppInfo()

  const status = ref<StoryGuideStatus | null>(null)
  /** An action on its way to the server; controls wait for it. */
  const pending = ref<StoryGuideAction | null>(null)
  /** Shown under a paused job's sentence for a few seconds after Try again found the same cause. */
  const stillTheCase = ref(false)

  const mayBuild = computed(() => hasPermission(Permission.LibraryGenerateStoryGuide))
  const managesSettings = computed(() => hasPermission(Permission.ManageAppSettings))
  const presentation = computed<StoryGuidePresentation>(() =>
    storyGuidePresentation({ status: status.value, managesSettings: managesSettings.value, stillTheCase: stillTheCase.value }),
  )

  let etag: string | null = null
  let generation = 0
  let mounted = false
  let polling = false
  /** Bumped whenever polling stops, so a poll already waiting on the server cannot carry on as a second loop. */
  let pollToken = 0
  /** The server pushes this book's changes; polling only backs it up. */
  let live = false
  /** A change was heard while the page was hidden. */
  let stale = false
  let unwatch: (() => void) | null = null
  let refreshing = false
  let refreshAgain = false
  /** Asks numbered in order sent, so a slow answer cannot overwrite a newer one. */
  let asked = 0
  let applied = 0
  let pollTimer: ReturnType<typeof setTimeout> | null = null
  let checkingTimer: ReturnType<typeof setTimeout> | null = null
  let stillTheCaseTimer: ReturnType<typeof setTimeout> | null = null
  /** "Checking this book" is asked about once more; after that only while the socket is not pushing. */
  let askedAgain = false
  let checkingWait = STORY_GUIDE_CHECKING_AGAIN_MS
  /** Bumped when an action's answer is shown, so a poll that left before it cannot undo it. */
  let revision = 0

  function pageVisible(): boolean {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden'
  }

  /**
   * Whether asking is worth it: the server advertises story guides, and either builds them now or
   * has some built. A server that has neither gets no status calls at all.
   */
  function serverOffersGuides(): boolean {
    if (!supportsFeature('story-guides')) return false
    const info = storyGuides.value
    return info === null || info.building || info.served
  }

  function stopPolling() {
    polling = false
    pollToken += 1
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
  }

  function stopTimers() {
    stopPolling()
    if (checkingTimer) {
      clearTimeout(checkingTimer)
      checkingTimer = null
      // It never asked, so the page may ask once more when it is next visible.
      askedAgain = false
      checkingWait = STORY_GUIDE_CHECKING_AGAIN_MS
    }
  }

  function showStillTheCase() {
    if (stillTheCaseTimer) clearTimeout(stillTheCaseTimer)
    stillTheCase.value = true
    stillTheCaseTimer = setTimeout(() => {
      stillTheCaseTimer = null
      stillTheCase.value = false
    }, STORY_GUIDE_STILL_THE_CASE_MS)
  }

  /** Asks the server once, with the last ETag. Returns whether the status changed. */
  async function fetchStatus(current: number): Promise<boolean> {
    const atRevision = revision
    const ask = ++asked
    try {
      const answer = await getStoryGuideStatus(toValue(bookId), null, etag)
      if (current !== generation || atRevision !== revision || ask < applied) return false
      applied = ask
      if (answer.kind === 'not-modified') return false
      if (answer.kind === 'missing') {
        const changed = status.value !== null
        status.value = null
        etag = null
        return changed
      }
      const changed = JSON.stringify(answer.status) !== JSON.stringify(status.value)
      etag = answer.etag
      status.value = answer.status
      return changed
    } catch {
      // Offline or refused: the last status stays.
      return false
    }
  }

  function startPolling(current: number) {
    if (polling) return
    polling = true
    const token = ++pollToken
    const next = (wait: number) => {
      pollTimer = setTimeout(async () => {
        pollTimer = null
        if (token !== pollToken || current !== generation) return
        const changed = await fetchStatus(current)
        if (token !== pollToken || current !== generation) return
        if (!isStoryGuideBuilding(status.value)) {
          polling = false
          schedule()
          return
        }
        if (live) next(STORY_GUIDE_LONGEST_POLL_MS)
        else next(changed ? STORY_GUIDE_FIRST_POLL_MS : Math.min(wait * 2, STORY_GUIDE_LONGEST_POLL_MS))
      }, wait)
    }
    next(live ? STORY_GUIDE_LONGEST_POLL_MS : STORY_GUIDE_FIRST_POLL_MS)
  }

  /**
   * Asks now, for a pushed change or a page that is visible again. Asks that arrive while one is
   * on its way make one more ask after it, not one each. A fresh answer restarts the poll's wait.
   */
  async function refreshNow(): Promise<void> {
    if (!mounted) return
    if (!pageVisible()) {
      stale = true
      return
    }
    stale = false
    if (refreshing) {
      refreshAgain = true
      return
    }
    refreshing = true
    const current = generation
    try {
      do {
        refreshAgain = false
        await fetchStatus(current)
      } while (refreshAgain && current === generation)
    } finally {
      refreshing = false
    }
    if (current !== generation) return
    stopPolling()
    schedule()
  }

  function stopWatching() {
    unwatch?.()
    unwatch = null
    live = false
  }

  function startWatching(current: number) {
    stopWatching()
    unwatch = watchStoryGuide(toValue(bookId), {
      changed: () => {
        if (current === generation) void refreshNow()
      },
      queueChanged: () => {
        if (current === generation && status.value?.job?.state === 'queued') void refreshNow()
      },
      live: (value) => {
        if (current !== generation) return
        live = value
        // Joining (again) catches up on anything missed; losing the push hands back to quick polling.
        if (value) void refreshNow()
        else {
          stopPolling()
          schedule()
        }
      },
    })
  }

  function schedule() {
    if (!mounted || !pageVisible()) return
    const current = generation
    if (isStoryGuideBuilding(status.value)) startPolling(current)
    else stopPolling()
    if (!isStoryGuideChecking(status.value)) checkingWait = STORY_GUIDE_CHECKING_AGAIN_MS
    else if (!checkingTimer && (!askedAgain || !live)) {
      const wait = checkingWait
      askedAgain = true
      checkingWait = Math.min(wait * 2, STORY_GUIDE_LONGEST_POLL_MS)
      checkingTimer = setTimeout(async () => {
        checkingTimer = null
        if (current !== generation || !pageVisible()) return
        await fetchStatus(current)
        if (current === generation) schedule()
      }, wait)
    }
  }

  async function load() {
    generation += 1
    const current = generation
    stopTimers()
    stopWatching()
    stale = false
    status.value = null
    etag = null
    askedAgain = false
    checkingWait = STORY_GUIDE_CHECKING_AGAIN_MS
    pending.value = null
    stillTheCase.value = false
    if (!mayBuild.value) return
    await ensureAppInfo()
    if (current !== generation || !serverOffersGuides()) return
    await fetchStatus(current)
    if (current !== generation) return
    startWatching(current)
    schedule()
  }

  /** Sends an action and shows the status it answers with. `fixes` is for delete. */
  async function perform(action: StoryGuideAction, fixes: StoryGuideFixesChoice = 'keep'): Promise<void> {
    const before = status.value
    if (!before || pending.value) return
    const current = generation
    const id = toValue(bookId)
    const fileId = before.fileId
    pending.value = action
    try {
      let next: StoryGuideStatus
      switch (action) {
        case 'build':
        case 'update':
        case 'rebuild':
          next = await buildStoryGuide(id, fileId, action)
          break
        case 'retry':
        case 'keepBuilding':
        case 'resume':
          next = await retryStoryGuide(id, fileId)
          break
        case 'cancelBuild':
        case 'dismiss':
          next = await cancelStoryGuide(id, fileId)
          break
        case 'delete':
          next = await deleteStoryGuide(id, fileId, fixes)
          break
      }
      if (current !== generation) return
      revision += 1
      // The answer is newer than any ETag held; the next poll asks afresh.
      etag = null
      status.value = next
      if (action === 'retry' && before.job?.state === 'paused' && next.job?.state === 'paused' && before.job.reason === next.job.reason) {
        showStillTheCase()
      }
      schedule()
    } catch (reason) {
      if (current !== generation) return
      toast.error(errorMessage(reason, failureKey(action)))
      // Someone else may have moved the build on, or the permission may be gone: ask again.
      await fetchStatus(current)
      if (current === generation) schedule()
    } finally {
      if (current === generation) pending.value = null
    }
  }

  function handleVisibilityChange() {
    if (!pageVisible()) stopTimers()
    else if (stale || isStoryGuideBuilding(status.value)) void refreshNow()
    else schedule()
  }

  onMounted(() => {
    mounted = true
    document.addEventListener('visibilitychange', handleVisibilityChange)
    void load()
  })

  watch(
    () => toValue(bookId),
    () => {
      if (mounted) void load()
    },
  )

  onBeforeUnmount(() => {
    mounted = false
    generation += 1
    stopTimers()
    stopWatching()
    if (stillTheCaseTimer) clearTimeout(stillTheCaseTimer)
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  })

  return { status, presentation, pending, perform, reload: load }
}
