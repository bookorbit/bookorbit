<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Ban,
  BookHeadphones,
  BookOpen,
  Check,
  ChevronDown,
  CircleCheck,
  CircleX,
  Clock,
  EyeOff,
  FileArchive,
  FileAudio,
  FileQuestion,
  FileText,
  Headphones,
  Image,
  Images,
  Library,
  ListChecks,
  Loader2,
  LoaderCircle,
  RotateCcw,
} from '@lucide/vue'
import { BOOK_REQUEST_UPLOAD_MAX_FILES, bookRequestUploadPlanIsSendable } from '@bookorbit/types'
import type { BookRequestItem, BookRequestUploadPlanFile, BookRequestUploadPlanUnit } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { formatConjunctionList } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { formatColorVar } from '@/features/book/lib/format-colors'
import { plannedUploadFiles, type RequestUploadFile, type RequestUploadState } from '../composables/useRequestUpload'
import { baseName } from '../requestUploadFiles'
import RequestDrawerSection from './RequestDrawerSection.vue'

const props = defineProps<{
  request: BookRequestItem
  state: RequestUploadState
  busy: boolean
}>()

const emit = defineEmits<{
  chooseUnit: [unitIndex: number]
  hold: [hold: boolean]
  addMore: []
  retryFile: [fileId: number]
}>()

const { t } = useI18n()

/** Rows a collapsed list shows of the book itself; the cover and anything left out always show. */
const COLLAPSED_CONTENT_ROWS = 3
const COLLAPSED_OTHER_ROWS = 4
/** An expanded list stops here; a folder of two thousand files says how many it left unlisted. */
const EXPANDED_ROWS = 200
/** Finished files kept in view while an upload runs, so the list shows it moving without growing. */
const RECENT_DONE_ROWS = 3

type PlanTone = 'ok' | 'later' | 'choose' | 'bad'

const PLAN_TONE: Record<PlanTone, string> = {
  ok: 'var(--success)',
  later: 'var(--info)',
  choose: 'var(--warning)',
  bad: 'var(--destructive)',
}
const PLAN_CHIP_ICON = { ok: Check, later: Clock, choose: ListChecks, bad: Ban } as const
const MEDIUM_ICON = { ebook: BookOpen, audiobook: Headphones, comic: Images } as const
const AUDIO_FORMATS = new Set(['mp3', 'm4b', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav', 'wma'])
const ARCHIVE_FORMATS = new Set(['zip', 'rar', '7z'])
const IMAGE_FORMATS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'])

const expanded = ref(false)

const started = computed(() => props.state.downloadId !== null)
const plan = computed(() => props.state.plan)
const sending = computed(() => plannedUploadFiles(props.state))
const sendingBytes = computed(() => sending.value.reduce((sum, file) => sum + file.sizeBytes, 0))
const requestMedium = computed(() =>
  props.request.mediaKind === 'audiobook' ? 'audiobook' : props.request.mediaKind === 'comic' ? 'comic' : 'ebook',
)

function upper(formats: readonly string[]): string {
  return formatConjunctionList(formats.map((format) => format.toUpperCase()))
}

function unitTitle(unit: BookRequestUploadPlanUnit): string {
  if (unit.mediaKind === 'audiobook') return t('bookRequests.upload.plan.audiobook', { count: unit.contentFileCount })
  if (unit.mediaKind === 'comic') return t('bookRequests.upload.plan.comic')
  return unit.formats.length > 1 ? t('bookRequests.upload.plan.ebookFormats', { count: unit.formats.length }) : t('bookRequests.upload.plan.ebook')
}

function unitSub(unit: BookRequestUploadPlanUnit, files: readonly BookRequestUploadPlanFile[], bytes: number): string {
  const named = { formats: upper(unit.formats), size: formatBytes(bytes) }
  return files.some((file) => file.role === 'artwork') ? t('bookRequests.upload.plan.subWithArt', named) : t('bookRequests.upload.plan.sub', named)
}

interface PlanHead {
  tone: PlanTone
  icon: typeof BookOpen
  title: string
  sub: string
  chip: string
}

/** The one line that says what the picked files come to, and whether they can close the request. */
const head = computed<PlanHead | null>(() => {
  const current = plan.value
  if (!current) return null
  const selected = current.selectedUnitIndex !== null ? (current.units[current.selectedUnitIndex] ?? null) : null
  const archiveHead = (): Omit<PlanHead, 'tone' | 'chip'> => {
    const archive = current.files.find((file) => file.role === 'archive')
    return {
      icon: FileArchive,
      title: t('bookRequests.upload.plan.archive'),
      sub: t('bookRequests.upload.plan.sub', { formats: (archive?.format ?? '').toUpperCase(), size: formatBytes(archive?.sizeBytes ?? 0) }),
    }
  }

  switch (current.status) {
    case 'ready':
      return selected
        ? {
            tone: 'ok',
            icon: MEDIUM_ICON[selected.mediaKind],
            title: unitTitle(selected),
            sub: unitSub(selected, sending.value, sendingBytes.value),
            chip: t('bookRequests.upload.plan.chip.matches'),
          }
        : null
    case 'archive':
      return { tone: 'later', ...archiveHead(), chip: t('bookRequests.upload.plan.chip.later') }
    case 'choose':
      return {
        tone: 'choose',
        icon: Library,
        title: t('bookRequests.upload.plan.choose', { count: choosable.value.length }),
        sub: t('bookRequests.upload.plan.subChoose'),
        chip: t('bookRequests.upload.plan.chip.pickOne'),
      }
    case 'wrong_medium': {
      const unit = current.units[0]!
      const files = current.files.filter((file) => file.unitIndex === unit.index && file.role !== 'skipped')
      return {
        tone: 'bad',
        icon: MEDIUM_ICON[unit.mediaKind],
        title: unitTitle(unit),
        sub: unitSub(unit, files, unit.sizeBytes),
        chip: t(
          `bookRequests.upload.plan.chip.${requestMedium.value === 'audiobook' ? 'notAudiobook' : requestMedium.value === 'comic' ? 'notComic' : 'notEbook'}`,
        ),
      }
    }
    case 'several_archives':
      return {
        tone: 'bad',
        icon: FileArchive,
        title: t('bookRequests.upload.plan.severalArchives', { count: current.files.filter((file) => file.role === 'archive').length }),
        sub: t('bookRequests.upload.plan.subArchives'),
        chip: t('bookRequests.upload.plan.chip.oneArchive'),
      }
    case 'no_book':
      return {
        tone: 'bad',
        icon: FileQuestion,
        title: t('bookRequests.upload.plan.noBook'),
        sub: t('bookRequests.upload.plan.subNoBook'),
        chip: t('bookRequests.upload.plan.chip.noBook'),
      }
    case 'file_too_large':
      return selected
        ? {
            tone: 'bad',
            icon: MEDIUM_ICON[selected.mediaKind],
            title: unitTitle(selected),
            sub: unitSub(selected, sending.value, sendingBytes.value),
            chip: t('bookRequests.upload.plan.chip.tooLarge'),
          }
        : { tone: 'bad', ...archiveHead(), chip: t('bookRequests.upload.plan.chip.tooLarge') }
  }
  return null
})

/** A plan the server could not make at all, said in the same box a plan would have filled. */
const planFailure = computed(() => {
  const error = props.state.planError
  if (!error) return null
  if (error === 'refused' && props.state.planReason) return props.state.planReason
  return t(`bookRequests.upload.plan.blocked.${error}`, { max: BOOK_REQUEST_UPLOAD_MAX_FILES })
})

/** Only the books this request can take are offered; the rest are already listed as left out. */
const choosable = computed(() => (plan.value?.status === 'choose' ? plan.value.units.filter((unit) => unit.matchesMedium) : []))

function unitChoiceSub(unit: BookRequestUploadPlanUnit): string {
  return t('bookRequests.upload.plan.sub', { formats: upper(unit.formats), size: formatBytes(unit.sizeBytes) })
}

const blocked = computed(() => {
  if (planFailure.value) return planFailure.value
  const current = plan.value
  if (!current) return null
  switch (current.status) {
    case 'wrong_medium':
      return t(
        `bookRequests.upload.plan.blocked.${requestMedium.value === 'audiobook' ? 'wrongAudiobook' : requestMedium.value === 'comic' ? 'wrongComic' : 'wrongEbook'}`,
      )
    case 'no_book':
      return t('bookRequests.upload.plan.blocked.noBook')
    case 'several_archives':
      return t('bookRequests.upload.plan.blocked.severalArchives')
    case 'file_too_large': {
      const file = sending.value.find((candidate) => candidate.tooLarge)
      return file
        ? t('bookRequests.upload.plan.blocked.tooLarge', {
            name: baseName(file.path),
            size: formatBytes(file.sizeBytes),
            limit: formatBytes(current.maxFileSizeBytes),
          })
        : null
    }
    default:
      return null
  }
})

const sendable = computed(() => plan.value !== null && bookRequestUploadPlanIsSendable(plan.value.status) && blocked.value === null)

const destination = computed(() => {
  if (props.request.targetBookId !== null) {
    return {
      icon: BookHeadphones,
      text: t(`bookRequests.upload.plan.joins.${props.request.mediaKind === 'audiobook' ? 'audiobook' : 'ebook'}`, { title: props.request.title }),
    }
  }
  if (!props.request.targetLibraryName) return null
  return { icon: Library, text: t('bookRequests.upload.plan.destination', { library: props.request.targetLibraryName }) }
})

function fileIcon(file: Pick<BookRequestUploadPlanFile, 'role' | 'format'>) {
  if (file.role === 'artwork') return Image
  if (file.role === 'skipped') return EyeOff
  if (file.format && ARCHIVE_FORMATS.has(file.format)) return FileArchive
  if (file.format && AUDIO_FORMATS.has(file.format)) return FileAudio
  return FileText
}

function pillStyle(format: string | null): Record<string, string> {
  return { '--tone': formatColorVar(format) }
}

/**
 * A collapsed list shows the start of the book and every file that is not the book, which is where
 * the surprises are: the cover it found, the file it left out and why.
 */
const pickedRows = computed(() => {
  const files = plan.value?.files ?? []
  if (expanded.value) return files.slice(0, EXPANDED_ROWS)
  const content = files.filter((file) => file.role === 'content' || file.role === 'archive')
  const others = files.filter((file) => file.role !== 'content' && file.role !== 'archive')
  const shownContent = new Set(content.slice(0, COLLAPSED_CONTENT_ROWS))
  const shownOthers = new Set(others.slice(0, COLLAPSED_OTHER_ROWS))
  return files.filter((file) => shownContent.has(file) || shownOthers.has(file))
})

const hiddenPicked = computed(() => (plan.value?.files ?? []).filter((file) => !pickedRows.value.includes(file)))

const hiddenLabel = computed(() => {
  const hidden = hiddenPicked.value
  const tracks = hidden.length > 0 && hidden.every((file) => file.role === 'content' && file.format !== null && AUDIO_FORMATS.has(file.format))
  return t(tracks ? 'bookRequests.upload.moreTracks' : 'bookRequests.upload.moreFiles', { count: hidden.length })
})

function expand() {
  expanded.value = true
}

function skipText(file: BookRequestUploadPlanFile): string {
  return t('bookRequests.upload.skipped', { reason: t(`bookRequests.upload.skip.${file.skipReason ?? 'unsupported'}`) })
}

function handleChoose(unit: BookRequestUploadPlanUnit) {
  emit('chooseUnit', unit.index)
}

function handleHold(event: Event) {
  emit('hold', (event.target as HTMLInputElement).checked)
}

function handleAddMore() {
  emit('addMore')
}

function handleRetry(file: RequestUploadFile) {
  emit('retryFile', file.id)
}

/* ------------------------------------------------------------------ once the upload has started */

const doneFiles = computed(() => props.state.files.filter((file) => file.state === 'done'))
const failedFiles = computed(() => props.state.files.filter((file) => file.state === 'failed'))
const movingFiles = computed(() => props.state.files.filter((file) => file.state === 'sending'))
const waitingFiles = computed(() => props.state.files.filter((file) => file.state === 'waiting'))
/** Nothing is moving and something did not arrive: the upload waits on whoever started it. */
const paused = computed(() => started.value && failedFiles.value.length > 0 && movingFiles.value.length === 0 && waitingFiles.value.length === 0)

const progressRows = computed(() =>
  paused.value ? failedFiles.value : [...doneFiles.value.slice(-RECENT_DONE_ROWS), ...failedFiles.value, ...movingFiles.value],
)
const arrivedBytes = computed(() => doneFiles.value.reduce((sum, file) => sum + file.sizeBytes, 0))

const progressAside = computed(() => {
  const named = { done: doneFiles.value.length, arrived: doneFiles.value.length, total: props.state.files.length }
  return paused.value ? t('bookRequests.upload.arrivedCount', named) : t('bookRequests.upload.doneCount', named)
})

function sentPercent(file: RequestUploadFile): number {
  return file.sizeBytes > 0 ? Math.min(99, Math.floor((file.sentBytes / file.sizeBytes) * 100)) : 0
}

function fileError(file: RequestUploadFile): string {
  if (file.file === null) return t('bookRequests.upload.notSent')
  if (file.error === 'connection') {
    return t('bookRequests.upload.fileErrors.connection', { sent: formatBytes(file.sentBytes), total: formatBytes(file.sizeBytes) })
  }
  return t(`bookRequests.upload.fileErrors.${file.error ?? 'other'}`)
}

function sentFileIcon(file: RequestUploadFile) {
  const format = formatOf(file.name)
  return fileIcon({ role: format !== null && IMAGE_FORMATS.has(format) ? 'artwork' : 'content', format })
}

function formatOf(name: string): string | null {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null
}

const ROW = 'relative flex min-h-[38px] items-center gap-[9px] px-3 py-1.5 text-[13px] text-foreground [&+&]:border-t [&+&]:border-border'
const LIST = 'm-0 list-none overflow-hidden rounded-lg border border-border bg-card p-0'
const NAME = 'min-w-0 flex-1 leading-[1.35] [overflow-wrap:anywhere]'
const META = 'flex-none text-xs whitespace-nowrap text-muted-foreground tabular-nums'
const PILL =
  'inline-grid h-[18px] min-w-10 flex-none place-items-center rounded-[5px] bg-[color-mix(in_oklab,var(--tone)_13%,transparent)] px-[5px] text-[10px] font-bold tracking-[0.04em] text-[var(--tone)] uppercase'
const MORE = 'bg-[color-mix(in_oklab,var(--muted)_45%,transparent)]'
const CHIP =
  'inline-flex h-[22px] flex-none items-center gap-1 rounded-full border border-[color-mix(in_oklab,var(--tone)_40%,transparent)] bg-[color-mix(in_oklab,var(--tone)_10%,transparent)] px-2 text-xs font-medium whitespace-nowrap text-[var(--tone)]'
</script>

<template>
  <RequestDrawerSection :title="t('bookRequests.upload.section')">
    <template #aside>
      <span v-if="started" class="inline-flex items-baseline gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{{
        progressAside
      }}</span>
      <span v-else class="inline-flex items-baseline gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
        {{ t('bookRequests.upload.fileCount', { count: state.picked.length }) }}
        <span aria-hidden="true">·</span>
        <button
          type="button"
          class="rounded-xs text-xs font-medium text-foreground underline decoration-border underline-offset-[3px] hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
          :disabled="busy || state.starting"
          @click="handleAddMore"
        >
          {{ t('bookRequests.upload.addMore') }}
        </button>
      </span>
    </template>

    <!-- Before anything is sent: what the picked files come to. -->
    <div v-if="!started" class="@container grid gap-3">
      <p v-if="state.planning" role="status" class="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        {{ t('bookRequests.upload.planning') }}
      </p>

      <div
        v-else-if="head || planFailure"
        class="grid gap-3 rounded-lg border border-[color-mix(in_oklab,var(--tone)_30%,var(--border))] bg-[color-mix(in_oklab,var(--tone)_5%,var(--card))] px-3.5 py-3"
        :style="{ '--tone': PLAN_TONE[head?.tone ?? 'bad'] }"
      >
        <div v-if="head" class="grid grid-cols-[36px_minmax(0,1fr)_auto] items-start gap-x-3">
          <span
            class="grid size-9 flex-none place-items-center rounded-md bg-[color-mix(in_oklab,var(--tone)_15%,transparent)] text-[var(--tone)]"
            aria-hidden="true"
          >
            <component :is="head.icon" :size="18" />
          </span>
          <div class="min-w-0">
            <p class="text-[15px] leading-[1.3] font-semibold text-foreground">{{ head.title }}</p>
            <p class="mt-[3px] text-[13px] leading-[1.4] text-muted-foreground">{{ head.sub }}</p>
          </div>
          <span :class="CHIP" class="@max-[420px]:col-start-2 @max-[420px]:row-start-2 @max-[420px]:mt-[7px] @max-[420px]:justify-self-start">
            <component :is="PLAN_CHIP_ICON[head.tone]" :size="12" aria-hidden="true" />
            {{ head.chip }}
          </span>
        </div>

        <ul v-if="choosable.length" class="m-0 grid list-none gap-1.5 p-0" role="radiogroup" :aria-label="t('bookRequests.upload.plan.unitsLabel')">
          <li v-for="unit in choosable" :key="unit.index">
            <button
              type="button"
              role="radio"
              :aria-checked="state.chosenUnit === unit.index"
              class="flex min-h-12 w-full items-center gap-2.5 rounded-md border px-2.5 py-[7px] text-start text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none @max-[420px]:flex-wrap @max-[420px]:gap-y-1.5"
              :class="
                state.chosenUnit === unit.index
                  ? 'border-primary bg-[color-mix(in_oklab,var(--primary)_8%,var(--card))]'
                  : 'border-border bg-card hover:bg-accent'
              "
              :disabled="busy || state.starting"
              @click="handleChoose(unit)"
            >
              <span
                class="size-4 flex-none rounded-full"
                :class="state.chosenUnit === unit.index ? 'border-[5px] border-primary' : 'border-[1.5px] border-muted-foreground'"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1 @max-[420px]:basis-[calc(100%-26px)]">
                <span class="block text-sm leading-[1.3] font-medium [overflow-wrap:anywhere]">{{
                  unit.title ?? t('bookRequests.releases.manifest.untitledUnit')
                }}</span>
                <span class="block text-xs text-muted-foreground">{{ unitChoiceSub(unit) }}</span>
              </span>
              <span v-if="unit.matchesTitle" :class="CHIP" class="@max-[420px]:ms-[26px]" :style="{ '--tone': 'var(--success)' }">
                <Check :size="12" aria-hidden="true" />
                {{ t('bookRequests.upload.plan.chip.matchesTitle') }}
              </span>
            </button>
          </li>
        </ul>

        <p
          v-if="blocked"
          class="flex items-start gap-1.5 text-[13px] leading-[1.45] text-destructive"
          :class="head && '@min-[30rem]:ps-12'"
          role="alert"
        >
          <Ban :size="14" class="mt-0.5 flex-none" aria-hidden="true" />
          <span>{{ blocked }}</span>
        </p>
        <p v-else-if="destination && sendable" class="flex items-start gap-1.5 text-[12.5px] leading-[1.45] text-muted-foreground @min-[30rem]:ps-12">
          <component :is="destination.icon" :size="13" class="mt-0.5 flex-none" aria-hidden="true" />
          <span>{{ destination.text }}</span>
        </p>
      </div>

      <ul v-if="plan && plan.status !== 'choose'" :class="LIST" :aria-label="t('bookRequests.upload.plan.filesLabel')">
        <li v-for="file in pickedRows" :key="file.path" :class="ROW">
          <component :is="fileIcon(file)" :size="15" class="flex-none text-muted-foreground" aria-hidden="true" />
          <span :class="[NAME, file.role === 'skipped' && 'text-muted-foreground']">{{ baseName(file.path) }}</span>
          <template v-if="file.role === 'skipped'">
            <span :class="META">{{ skipText(file) }}</span>
          </template>
          <template v-else>
            <span v-if="file.format" :class="PILL" :style="pillStyle(file.format)">{{ file.format }}</span>
            <span v-else :class="PILL" class="invisible" aria-hidden="true" />
            <span :class="[META, 'min-w-[52px] text-end', file.tooLarge && 'text-destructive']">{{ formatBytes(file.sizeBytes) }}</span>
          </template>
        </li>
        <li v-if="hiddenPicked.length && !expanded" :class="[ROW, MORE, 'p-0']">
          <button
            type="button"
            class="flex min-h-[38px] w-full items-center gap-[9px] px-3 py-1.5 text-start text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
            :aria-expanded="false"
            @click="expand"
          >
            <ChevronDown :size="15" class="flex-none" aria-hidden="true" />
            <span :class="NAME">{{ hiddenLabel }}</span>
          </button>
        </li>
        <li v-else-if="hiddenPicked.length" :class="[ROW, MORE]">
          <ChevronDown :size="15" class="flex-none text-muted-foreground" aria-hidden="true" />
          <span :class="[NAME, 'text-muted-foreground']">{{ hiddenLabel }}</span>
        </li>
      </ul>

      <label v-if="sendable" class="flex cursor-pointer items-start gap-2.5">
        <input
          type="checkbox"
          class="mt-0.5 size-4 flex-none accent-primary"
          :checked="state.holdForReview"
          :disabled="busy || state.starting"
          aria-describedby="request-upload-hold-hint"
          @change="handleHold"
        />
        <span>
          <span class="block text-[13.5px] text-foreground">{{ t('bookRequests.upload.hold.title') }}</span>
          <span id="request-upload-hold-hint" class="mt-px block text-xs leading-[1.45] text-muted-foreground">{{
            t('bookRequests.upload.hold.hint')
          }}</span>
        </span>
      </label>
    </div>

    <!-- While it is sent: what is arriving, and what did not. -->
    <ul v-else :class="LIST">
      <li
        v-for="file in progressRows"
        :key="file.id"
        :class="[ROW, file.state === 'failed' && 'bg-[color-mix(in_oklab,var(--destructive)_6%,var(--card))]']"
      >
        <CircleX v-if="file.state === 'failed'" :size="15" class="flex-none text-destructive" aria-hidden="true" />
        <LoaderCircle
          v-else-if="file.state === 'sending'"
          :size="15"
          class="flex-none animate-spin text-info motion-reduce:animate-none"
          aria-hidden="true"
        />
        <component :is="sentFileIcon(file)" v-else :size="15" class="flex-none text-muted-foreground" aria-hidden="true" />

        <span :class="NAME">
          {{ file.name }}
          <span v-if="file.state === 'failed'" class="block text-xs text-destructive">{{ fileError(file) }}</span>
        </span>
        <span v-if="formatOf(file.name)" :class="PILL" :style="pillStyle(formatOf(file.name))">{{ formatOf(file.name) }}</span>

        <span v-if="file.state === 'done'" class="inline-flex min-w-[52px] flex-none items-center justify-end gap-1 text-xs text-success">
          <CircleCheck :size="14" aria-hidden="true" />
          {{ t('bookRequests.upload.fileDone') }}
        </span>
        <template v-else-if="file.state === 'sending'">
          <span class="inline-flex min-w-[52px] flex-none items-center justify-end text-xs font-semibold text-info tabular-nums"
            >{{ sentPercent(file) }}%</span
          >
          <span
            class="absolute start-9 end-3 bottom-0 h-0.5 overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--info)_18%,var(--border))]"
            aria-hidden="true"
          >
            <span class="block h-full bg-info" :style="{ width: `${sentPercent(file)}%` }" />
          </span>
        </template>
        <Button
          v-else-if="file.state === 'failed' && file.file !== null"
          variant="ghost"
          size="icon-sm"
          class="size-7"
          :disabled="busy"
          :aria-label="t('bookRequests.upload.retryFile', { name: file.name })"
          @click="handleRetry(file)"
        >
          <RotateCcw :size="14" aria-hidden="true" />
        </Button>
      </li>

      <li v-if="!paused && waitingFiles.length" :class="[ROW, MORE]">
        <Clock :size="15" class="flex-none text-muted-foreground" aria-hidden="true" />
        <span :class="[NAME, 'text-muted-foreground']">{{ t('bookRequests.upload.moreWaiting', { count: waitingFiles.length }) }}</span>
      </li>
      <li v-if="paused && doneFiles.length" :class="[ROW, MORE]">
        <CircleCheck :size="15" class="flex-none text-success" aria-hidden="true" />
        <span :class="[NAME, 'text-muted-foreground']">{{ t('bookRequests.upload.othersArrived', { count: doneFiles.length }) }}</span>
        <span :class="[META, 'min-w-[52px] text-end']">{{ formatBytes(arrivedBytes) }}</span>
      </li>
    </ul>
  </RequestDrawerSection>
</template>
