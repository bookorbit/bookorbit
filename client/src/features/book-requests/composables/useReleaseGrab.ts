import { ref, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { findGrabRefusal, releaseInspectionBlocksGrab } from '@bookorbit/types'
import type {
  BookRequestItem,
  GrabBookRequestPayload,
  GrabFailureCode,
  GrabRefusal,
  ReleaseCandidateItem,
  ReleaseFileInspection,
} from '@bookorbit/types'

/** Only the refusals that rule another release out get a note; the rest are about one row. */
const REFUSAL_KEYS: Partial<Record<GrabFailureCode, string>> = {
  GRAB_SOURCE_REFUSED: 'sourceRefused',
  GRAB_SOURCE_UNAVAILABLE: 'sourceUnavailable',
  GRAB_VIP_REQUIRED: 'vipRequired',
  GRAB_CLIENT_REFUSED: 'clientRefused',
}

/** The refusal travels back with the call it belongs to, so one grab cannot describe another. */
export interface ReleaseGrabOutcome {
  item: BookRequestItem | null
  reason: string | null
  errorCode: GrabFailureCode | null
}

export interface ReleaseGrabOptions {
  request: Ref<BookRequestItem | null>
  requestId: Ref<number>
  grab: (id: number, body: GrabBookRequestPayload) => Promise<ReleaseGrabOutcome>
  setRequest: (value: BookRequestItem) => void
  inspectRelease: (requestId: number, release: ReleaseCandidateItem) => Promise<ReleaseFileInspection | null>
  /** Opens a row's file list, which is where a blocked inspection explains itself. */
  setFilesExpanded: (release: ReleaseCandidateItem, expanded: boolean) => void
  /** Whether this release's source joins a swarm, which decides if a client refusal generalises. */
  seedsBack: (release: ReleaseCandidateItem) => boolean
}

/**
 * Sending a release, and remembering what this visit was already told.
 *
 * A tracker that refuses one release refuses the rest of its list the same way, and clicking down
 * a source's rows to collect the same 406 four times is the part worth taking off the approver.
 */
export function useReleaseGrab(options: ReleaseGrabOptions) {
  const { t } = useI18n()
  const route = useRoute()
  const router = useRouter()
  const { request, requestId, grab, setRequest, inspectRelease, setFilesExpanded, seedsBack } = options

  const manualOpen = ref(false)
  const refusals = ref<GrabRefusal[]>([])
  /**
   * One release at a time, from the click rather than from the request.
   *
   * Inspecting a release is a tracker round trip of up to twenty-five seconds, and only the
   * inspecting row was disabled for it: a second Send during that window started its own
   * inspection and went on to its own grab, and `submitGrab` re-checks nothing. Two releases were
   * sent for one request. The request's own busy flag is no help, because neither grab has been
   * called yet while the inspections run.
   */
  const grabbing = ref(false)

  function openManual() {
    manualOpen.value = true
  }

  function closeManual() {
    manualOpen.value = false
  }

  /** A fresh search is also how an approver retries a source that was merely slow. */
  function forgetRefusals() {
    refusals.value = []
  }

  /** A sent release leaves nothing to pick, so the drawer pops back to the request it belongs to. */
  async function sendGrab(body: GrabBookRequestPayload) {
    if (!request.value) return
    const outcome = await grab(request.value.id, body)
    if (!outcome.item) {
      rememberRefusal(body, outcome.errorCode)
      toast.error(t('bookRequests.errors.grabFailed'), outcome.reason ? { description: outcome.reason } : undefined)
      return
    }
    setRequest(outcome.item)
    manualOpen.value = false
    toast.success(t('bookRequests.toasts.grabbed'))
    void router.push({ name: 'book-request-detail', params: { id: request.value.id }, query: route.query })
  }

  async function submitGrab(body: GrabBookRequestPayload) {
    if (grabbing.value) return
    grabbing.value = true
    try {
      await sendGrab(body)
    } finally {
      grabbing.value = false
    }
  }

  /**
   * Held from the click rather than from the send: the inspection in between is the window a
   * second click used to slip through.
   */
  async function handleGrab(release: ReleaseCandidateItem): Promise<void> {
    if (grabbing.value) return
    grabbing.value = true
    try {
      const inspection = await inspectRelease(requestId.value, release)
      if (!inspection || releaseInspectionBlocksGrab(inspection.status)) {
        setFilesExpanded(release, true)
        return
      }
      await sendGrab({ indexerId: release.indexerId, releaseGuid: release.guid })
    } finally {
      grabbing.value = false
    }
  }

  function handleManualGrab(payload: { request: BookRequestItem; body: GrabBookRequestPayload }) {
    void submitGrab(payload.body)
  }

  /** Only a refusal the server classified; anything else says nothing about the other releases. */
  function rememberRefusal(body: GrabBookRequestPayload, code: GrabFailureCode | null) {
    if (!code) return
    refusals.value = [...refusals.value, { indexerId: body.indexerId ?? null, code }]
  }

  function refusalFor(release: ReleaseCandidateItem): GrabRefusal | null {
    return findGrabRefusal({ indexerId: release.indexerId, vipOnly: release.vipOnly, seedsBack: seedsBack(release) }, refusals.value)
  }

  function isRefused(release: ReleaseCandidateItem): boolean {
    return refusalFor(release) !== null
  }

  function refusalText(release: ReleaseCandidateItem): string | null {
    const refusal = refusalFor(release)
    const key = refusal ? REFUSAL_KEYS[refusal.code] : undefined
    return key ? t(`bookRequests.releases.refused.${key}`) : null
  }

  return { manualOpen, grabbing, refusals, openManual, closeManual, forgetRefusals, submitGrab, handleGrab, handleManualGrab, isRefused, refusalText }
}
