<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import {
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Headphones,
  Images,
  Library,
  Loader2,
  Pin,
  Search,
  SlidersHorizontal,
  User,
  Users,
} from '@lucide/vue'
import {
  AUDIO_FORMAT_LIST,
  BOOK_REQUEST_MEDIA_KINDS,
  canonicalizeBookRequestIsbn,
  COMIC_FORMAT_LIST,
  EBOOK_FORMAT_LIST,
  isBookRequestFulfiller,
  isGrabbableBookRequestStatus,
  MAX_BOOK_REQUEST_SEARCH_ISBNS,
  Permission,
} from '@bookorbit/types'
import type {
  BookRequestMediaKind,
  BookRequestMetadataSource,
  BookRequestSubmitResult,
  MetadataCandidate,
  MetadataProviderKey,
} from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'vue-sonner'
import { useAuth } from '@/features/auth/composables/useAuth'
import { usePermissions } from '@/features/auth/composables/usePermissions'
import { useMetadataSearch } from '@/features/book/composables/useMetadataSearch'
import { providerIconPathSafe } from '@/features/book/lib/provider-icons'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { getProviderColor } from '@/lib/provider-colors'
import { useCandidateGroups, type CandidateGroup, type CandidateIsbnChoice } from '../composables/useCandidateGroups'
import { formatLanguageName } from '@/i18n/formatters'
import { requestLanguageOptions, useRequestDestinationDefault, useRequestLanguageDefault } from '../composables/useRequestDestinationDefault'
import { submitFailureText, useRequestSubmission } from '../composables/useRequestSubmission'
import RequestCover from './RequestCover.vue'

const emit = defineEmits<{ submitted: [] }>()

const { t, locale } = useI18n()
const { filteredResults, coverProviderOrder, resultProviderOrder, interruptedProviders, isStreaming, hasSearched, providers, loadProviders, search } =
  useMetadataSearch()
const { libraries, fetchLibraries } = useLibraries()
const { hasPermission } = usePermissions()
const { user } = useAuth()
const router = useRouter()
const route = useRoute()
const { lastFailure, submitting, mediaKind, annotate, getAvailability, submit, submitFreeText, checkFreeText, candidateKey } = useRequestSubmission()
const { load: loadDefaultDestination, defaultFor: instanceDefaultFor, resolveDestination } = useRequestDestinationDefault()
const {
  defaultLanguage,
  isSaving: savingLanguage,
  load: loadLanguageDefault,
  setDefault: setLanguageDefault,
  resolveLanguage,
} = useRequestLanguageDefault()

const MEDIA_ICONS = { ebook: BookOpen, audiobook: Headphones, comic: Images } as const

/**
 * What each medium may be asked for, taken from the shared lists rather than restated here, so the
 * form can never offer a format the scorer does not know how to recognise.
 */
const FORMATS_BY_MEDIA: Record<BookRequestMediaKind, readonly string[]> = {
  ebook: EBOOK_FORMAT_LIST,
  audiobook: AUDIO_FORMAT_LIST,
  comic: COMIC_FORMAT_LIST,
}

const title = ref('')
const author = ref('')
const language = ref<string | null>(null)
/**
 * A preference, not a filter: a release in another format still appears, it simply scores lower.
 * Kept per medium, because "epub" means nothing to an audiobook search and clearing the whole set
 * on every media-kind press would throw away a choice the requester had just made.
 */
const preferredFormats = ref<Record<BookRequestMediaKind, string[]>>({ ebook: [], audiobook: [], comic: [] })
const note = ref('')
const optionsOpen = ref(false)
const targetLibraryId = ref<number | null>(null)
const targetFolderId = ref<number | null>(null)
const activeCoverUrls = ref<Record<string, string | null>>({})
const failedProviderIcons = ref(new Set<MetadataProviderKey>())
const expandedMetadataGroups = ref(new Set<string>())
const { groups } = useCandidateGroups(filteredResults, mediaKind, getAvailability, coverProviderOrder, language, resultProviderOrder)

// Nobody approves these requests afterwards, so this is the only chance to say where the book goes.
const autoApproves = computed(() => hasPermission(Permission.BookRequestAutoApprove))
/** May download it now rather than asking for it, and pick the release by hand on the next screen. */
const selfFulfils = computed(() => hasPermission(Permission.BookRequestSelfFulfill))
const fulfillmentMode = ref<'automatic' | 'choose_release'>('automatic')
const canChooseFulfillment = computed(() => autoApproves.value && selfFulfils.value)
const choosesRelease = computed(() => selfFulfils.value && (!autoApproves.value || fulfillmentMode.value === 'choose_release'))
/**
 * Either way there is no second pair of eyes, so every destination rule below reads from this
 * rather than from auto-approval alone: the select is shown, an unset destination is fatal, and a
 * single library is worth preselecting.
 */
const settlesOnCreate = computed(() => autoApproves.value || selfFulfils.value)
const selectedLibrary = computed(() => libraries.value.find((library) => library.id === targetLibraryId.value) ?? null)
const folders = computed(() => selectedLibrary.value?.folders ?? [])
const showDestination = computed(() => settlesOnCreate.value || libraries.value.length > 1)
/**
 * Nowhere for the book to go, which for an auto-approving requester is fatal: nobody decides on
 * their request afterwards, so there is no later point where a destination could be picked.
 *
 * The instance default counts. It is applied server-side when the form names nothing, so leaving
 * the select on "Default (Novels)" is a destination, not the absence of one; treating it as
 * missing is what disabled every Request button on an instance that had defaults set.
 */
const destinationMissing = computed(
  () => settlesOnCreate.value && targetLibraryId.value === null && instanceDefaultFor(mediaKind.value).libraryId === null,
)

const canSearch = computed(() => title.value.trim() !== '' || author.value.trim() !== '')

/**
 * What "no library chosen" actually means for this medium. The instance default is applied by the
 * server, so without naming it here the requester submits with no idea where the book lands.
 */
const unpickedDestinationLabel = computed(() => {
  const fallback = instanceDefaultFor(mediaKind.value)
  if (fallback.libraryName !== null) return t('bookRequests.search.libraryDefault', { library: fallback.libraryName })
  return settlesOnCreate.value ? t('bookRequests.search.libraryChoose') : t('bookRequests.search.libraryAny')
})

const isLanguagePinned = computed(() => language.value !== null && defaultLanguage.value === language.value)

const languageOptions = computed(() => requestLanguageOptions(locale.value))

onMounted(async () => {
  await Promise.all([loadProviders(), fetchLibraries(), loadDefaultDestination(), loadLanguageDefault()])
  // Your own interface language, until you pin one. Never the edition's: that is the silent
  // inheritance that turned a request for a book into a request for a translation.
  language.value = resolveLanguage(locale.value)
  // One library is only worth preselecting for the requester who is also the approver.
  targetLibraryId.value = resolveDestination(libraries.value, undefined, settlesOnCreate.value).libraryId
})

// A folder only means anything inside its own library, so it never outlives the library choice.
watch(targetLibraryId, () => {
  targetFolderId.value = folders.value[0]?.id ?? null
})

// Results stream in provider by provider, so annotate as they land rather than once at the end.
watch(filteredResults, (results) => {
  if (results.length) annotate(results)
})

async function runSearch() {
  if (!canSearch.value) return
  activeCoverUrls.value = {}
  await search({
    title: title.value.trim() || undefined,
    author: author.value.trim() || undefined,
    mediaKind: mediaKind.value,
  })
}

function handleSearchSubmit(event: Event) {
  event.preventDefault()
  void runSearch()
}

function selectMediaKind(kind: BookRequestMediaKind) {
  mediaKind.value = kind
  if (hasSearched.value) void runSearch()
}

function selectAutomaticFulfillment() {
  fulfillmentMode.value = 'automatic'
}

function selectReleaseFulfillment() {
  fulfillmentMode.value = 'choose_release'
}

function handleLanguageChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  language.value = value === '' ? null : value
}

async function toggleLanguageDefault() {
  if (savingLanguage.value) return

  const wasPinned = isLanguagePinned.value
  if (!(await setLanguageDefault(wasPinned ? null : language.value))) {
    toast.error(t('bookRequests.search.languageDefaultFailed'))
    return
  }

  toast.success(
    wasPinned
      ? t('bookRequests.search.languageDefaultCleared')
      : t('bookRequests.search.languageDefaultSaved', { language: formatLanguageName(language.value ?? '') }),
  )
}

const mediaFormats = computed(() => FORMATS_BY_MEDIA[mediaKind.value])
const activeFormats = computed(() => preferredFormats.value[mediaKind.value])

/** What the collapsed row has to say for itself, so a set preference is never silently hidden. */
const optionsSummary = computed(() => {
  const formats = activeFormats.value
  const hasNote = note.value.trim() !== ''
  if (formats.length === 0 && !hasNote) return null
  if (formats.length === 0) return t('bookRequests.search.noteLabel')
  const listed = formats.map((format) => format.toUpperCase()).join(', ')
  return hasNote ? t('bookRequests.search.optionsSummary', { formats: listed }) : listed
})

function isPreferredFormat(format: string): boolean {
  return activeFormats.value.includes(format)
}

function togglePreferredFormat(format: string) {
  const current = activeFormats.value
  const next = current.includes(format) ? current.filter((value) => value !== format) : [...current, format]
  preferredFormats.value = { ...preferredFormats.value, [mediaKind.value]: next }
}

function toggleOptions() {
  optionsOpen.value = !optionsOpen.value
}

/** The two the request carries beyond the work itself, sent by both submission paths. */
function requestExtras(): { note: string | null; preferredFormats: string[] } {
  return { note: note.value.trim() || null, preferredFormats: [...activeFormats.value] }
}

function handleLibraryChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  targetLibraryId.value = value === '' ? null : Number(value)
}

function handleFolderChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  targetFolderId.value = value === '' ? null : Number(value)
}

const providerLabels = computed(() => new Map(providers.value.map((provider) => [provider.key, provider.label])))

/** A provider that never answered leaves a shorter list, which otherwise reads as a thin catalogue. */
const interruptedMessage = computed(() => {
  const names = interruptedProviders.value.map(({ provider }) => providerLabels.value.get(provider) ?? provider)
  return names.length ? t('bookRequests.search.sourcesUnavailable', { sources: names.join(', ') }) : null
})

function sourceNames(group: CandidateGroup): string {
  return group.providers.map((provider) => providerLabels.value.get(provider) ?? provider).join(', ')
}

function providerLabel(provider: MetadataProviderKey): string {
  return providerLabels.value.get(provider) ?? provider
}

function providerFallback(provider: MetadataProviderKey): string {
  return providerLabel(provider).slice(0, 2).toUpperCase()
}

function providerSourceStyle(provider: MetadataProviderKey): Record<string, string> {
  const color = getProviderColor(provider)
  return {
    borderColor: `${color}66`,
    backgroundColor: `${color}12`,
  }
}

function handleProviderIconError(provider: MetadataProviderKey): void {
  failedProviderIcons.value = new Set([...failedProviderIcons.value, provider])
}

function identifierSummary(group: CandidateGroup): string {
  if (group.isbns.length === 0) return t('bookRequests.search.identifiers.none')
  if (group.isbns.length > 1) return t('bookRequests.search.identifiers.count', { count: group.isbns.length })
  const agreeingSources = group.candidates.filter(
    (candidate) => canonicalizeBookRequestIsbn(candidate.isbn10, candidate.isbn13) === group.isbns[0],
  ).length
  return agreeingSources > 1 ? t('bookRequests.search.identifiers.confirmed') : t('bookRequests.search.identifiers.one')
}

function isMetadataExpanded(group: CandidateGroup): boolean {
  return expandedMetadataGroups.value.has(group.key)
}

function toggleMetadataDetails(group: CandidateGroup): void {
  const next = new Set(expandedMetadataGroups.value)
  if (next.has(group.key)) next.delete(group.key)
  else next.add(group.key)
  expandedMetadataGroups.value = next
}

function candidateProviderLabel(candidate: MetadataCandidate): string {
  return providerLabel(candidate.provider)
}

function candidateDisplayTitle(candidate: MetadataCandidate): string {
  return candidate.displayTitle ?? candidate.title ?? t('bookRequests.search.identifiers.notProvided')
}

function candidateIsbn(candidate: MetadataCandidate): string {
  return canonicalizeBookRequestIsbn(candidate.isbn10, candidate.isbn13) ?? t('bookRequests.search.identifiers.notProvided')
}

function candidateYear(candidate: MetadataCandidate): string {
  return candidate.publishedYear != null ? String(candidate.publishedYear) : t('bookRequests.search.yearUnknown')
}

function candidateLanguage(candidate: MetadataCandidate): string {
  return candidate.language ? formatLanguageName(candidate.language) : t('bookRequests.search.identifiers.notProvided')
}

function requestMetadataSources(group: CandidateGroup): BookRequestMetadataSource[] {
  return group.candidates.map((candidate) => ({
    providerKey: candidate.provider,
    providerId: candidate.providerId,
    providerLabel: candidateProviderLabel(candidate),
    isbn10: candidate.isbn10 ?? null,
    isbn13: candidate.isbn13 ?? null,
  }))
}

function searchScopeText(group: CandidateGroup): string {
  return group.isbns.length === 0
    ? t('bookRequests.search.identifiers.titleAuthorOnly')
    : t('bookRequests.search.identifiers.searchScope', { count: Math.min(group.isbns.length, MAX_BOOK_REQUEST_SEARCH_ISBNS) })
}

function isbnSearchChoices(group: CandidateGroup): CandidateIsbnChoice[] {
  return group.isbnChoices.slice(0, MAX_BOOK_REQUEST_SEARCH_ISBNS)
}

function recommendedSearchChoice(group: CandidateGroup): CandidateIsbnChoice | null {
  return group.recommendedIsbnChoice
}

function searchChoiceProviders(choice: CandidateIsbnChoice): string {
  return choice.providers.map(providerLabel).join(', ')
}

function isRecommendedChoice(group: CandidateGroup, choice: CandidateIsbnChoice): boolean {
  return group.recommendedIsbnChoice?.isbn === choice.isbn
}

function recommendedSearchLabel(group: CandidateGroup): string {
  return group.recommendedIsbnChoice
    ? t('bookRequests.search.identifiers.primaryIsbn', { isbn: group.recommendedIsbnChoice.isbn })
    : t('bookRequests.search.identifiers.primaryTitleAuthor')
}

function isGroupSubmitting(group: CandidateGroup): boolean {
  return group.candidates.some((candidate) => submitting.value === candidateKey(candidate))
}

/** Joining a request someone else already made never touches the destination, so it stays open. */
function isRequestDisabled(group: CandidateGroup): boolean {
  if (isGroupSubmitting(group) || group.availability?.alreadySubscribed) return true
  if (group.availability?.existingRequestId) return false
  return destinationMissing.value
}

/**
 * Three different actions wear this button. Joining wins over downloading: the work is already
 * claimed, and a self-server who presses it is subscribing, not starting a second download.
 */
function requestLabel(group: CandidateGroup): string {
  if (isJoinable(group)) return t('bookRequests.search.joinRequest')
  if (choosesRelease.value) return t('bookRequests.search.chooseRelease')
  return autoApproves.value ? t('bookRequests.search.getAutomatically') : t('bookRequests.search.request')
}

function isJoinable(group: CandidateGroup): boolean {
  return Boolean(group.availability?.existingRequestId) && !group.availability?.alreadySubscribed
}

/**
 * Only once a provider search has come back empty, and only for somebody who will pick the release
 * themselves. An approver handed a row that says nothing but a typed string has no way to tell
 * whether it is the book that was meant.
 */
const canSearchIndexersManually = computed(() => selfFulfils.value && hasSearched.value && title.value.trim() !== '')
const showFreeTextOption = computed(() => canSearchIndexersManually.value && groups.value.length === 0)
const showManualSearchOverride = computed(() => canSearchIndexersManually.value && groups.value.length > 0)

const freeTextBusy = ref(false)
const freeTextNotice = ref<string | null>(null)

/** One sentence either way: the indexer fallback is a longer answer to the same question. */
const noResultsHint = computed(() =>
  showFreeTextOption.value ? t('bookRequests.search.noResultsIndexerHint', { title: title.value.trim() }) : t('bookRequests.search.noResultsHint'),
)

/**
 * What the library and the queue already know about the typed text, shown before anything is
 * created. Free text is the weakest identity the dedupe rules see, so this is a hint for a person
 * rather than a gate: it can miss a match a provider result would have caught.
 *
 * Debounced, because the empty state stays on screen while the requester keeps typing and the
 * unthrottled version asked the server once per keystroke. The generation counter is the other
 * half: without it a slow answer to "Frank" can land after a fast one to "Frankenstein" and
 * describe a title nobody is looking at any more.
 */
const FREE_TEXT_HINT_DEBOUNCE_MS = 350
let hintHandle: ReturnType<typeof setTimeout> | null = null
let hintGeneration = 0

watch([showFreeTextOption, title, author, mediaKind], () => {
  freeTextNotice.value = null
  hintGeneration++
  if (hintHandle !== null) clearTimeout(hintHandle)
  if (!showFreeTextOption.value) return

  const generation = hintGeneration
  hintHandle = setTimeout(async () => {
    const found = await checkFreeText({ title: title.value, author: author.value })
    if (generation !== hintGeneration) return
    if (found?.ownedBookId) freeTextNotice.value = t('bookRequests.search.alreadyInLibrary')
    else if (found?.existingRequestId) freeTextNotice.value = t('bookRequests.search.alreadyRequested')
  }, FREE_TEXT_HINT_DEBOUNCE_MS)
})

onUnmounted(() => {
  if (hintHandle !== null) clearTimeout(hintHandle)
})

/**
 * Where a submitted request leaves you.
 *
 * `subscribed` means the work was already claimed, which is often somebody else's request. It is
 * not always: choosing a release twice folds you into *your own* row, and a self-fulfiller whose
 * submission collides with an undriven request takes that row on rather than queueing behind it.
 * Opening the picker therefore requires both manual intent and a request this person can drive.
 */
async function afterSubmit(result: BookRequestSubmitResult, openPicker: boolean, searchIsbn?: string | null): Promise<void> {
  const mine = isBookRequestFulfiller(result.request, user.value?.id)
  if (openPicker && mine && isGrabbableBookRequestStatus(result.request.status)) {
    await router.push({ name: 'book-request-releases', params: { id: result.request.id }, query: releasesQuery(searchIsbn) })
    return
  }

  toast.success(result.subscribed ? t('bookRequests.search.joinedExisting') : t('bookRequests.search.submitted'))
  emit('submitted')
}

/**
 * The query the release picker opens with: the tab and filters the list behind this panel is on,
 * plus what to search for. Carried across rather than replaced, because the picker is a route on
 * top of that list and closing it returns to whatever was underneath; both keys are cleared first,
 * so a request submitted without an ISBN cannot inherit the one the last request was opened with.
 */
function releasesQuery(searchIsbn?: string | null): LocationQuery {
  const carried = { ...route.query }
  delete carried.isbn
  delete carried.search
  if (searchIsbn === undefined) return carried
  return searchIsbn ? { ...carried, isbn: searchIsbn } : { ...carried, search: 'title-author' }
}

async function startFreeTextSearch() {
  freeTextBusy.value = true
  try {
    const result = await submitFreeText(
      { title: title.value, author: author.value },
      {
        targetLibraryId: targetLibraryId.value,
        targetFolderId: targetFolderId.value,
        language: language.value,
        selfServe: true,
        ...requestExtras(),
      },
    )
    if (!result) {
      toast.error(submitFailureText(lastFailure.value, t) ?? t('bookRequests.search.submitFailed'))
      return
    }
    await afterSubmit(result, true)
  } finally {
    freeTextBusy.value = false
  }
}

async function requestGroup(group: CandidateGroup) {
  const choice = recommendedSearchChoice(group)
  await requestGroupChoice(group, choice?.candidate ?? group.candidate, choice?.isbn ?? null, choosesRelease.value)
}

async function requestCandidate(group: CandidateGroup, candidate: MetadataCandidate): Promise<void> {
  await requestGroupChoice(group, candidate, canonicalizeBookRequestIsbn(candidate.isbn10, candidate.isbn13), true)
}

async function requestTitleAuthor(group: CandidateGroup): Promise<void> {
  await requestGroupChoice(group, group.candidate, null, true)
}

async function requestGroupChoice(group: CandidateGroup, candidate: MetadataCandidate, isbn: string | null, openPicker = true): Promise<void> {
  const hasSelectedCover = Object.prototype.hasOwnProperty.call(activeCoverUrls.value, group.key)
  const result = await submit(candidate, {
    targetLibraryId: targetLibraryId.value,
    targetFolderId: targetFolderId.value,
    language: language.value,
    coverUrl: hasSelectedCover ? (activeCoverUrls.value[group.key] ?? null) : group.coverUrl,
    selfServe: openPicker,
    isbn10: null,
    isbn13: isbn,
    providerKey: candidate.provider,
    providerId: candidate.providerId,
    metadataSources: requestMetadataSources(group),
    ...requestExtras(),
  })
  if (!result) {
    toast.error(submitFailureText(lastFailure.value, t) ?? t('bookRequests.search.submitFailed'))
    return
  }
  await afterSubmit(result, openPicker, isbn)
}

function handleCoverSourceChange(payload: { key: string | undefined; src: string | null }) {
  if (!payload.key) return
  activeCoverUrls.value = { ...activeCoverUrls.value, [payload.key]: payload.src }
}

function mediaIconFor(kind: BookRequestMediaKind) {
  return MEDIA_ICONS[kind] ?? BookOpen
}
</script>

<template>
  <div class="space-y-5">
    <form @submit="handleSearchSubmit">
      <!--
        The query is one object, so it is one card. The fields carry their own fill and border
        because a transparent input reads as a caption, and the secondary controls sit in a strip
        attached to the same card rather than floating on their own line below it.
      -->
      <div class="overflow-hidden rounded-xl border border-border bg-card">
        <div class="flex flex-col gap-2.5 p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div
            class="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40 sm:w-auto sm:min-w-[13rem] sm:flex-[2]"
          >
            <Search :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            <label for="request-title" class="sr-only">{{ t('bookRequests.search.titleLabel') }}</label>
            <input
              id="request-title"
              v-model="title"
              type="text"
              class="h-full w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              :placeholder="t('bookRequests.search.titlePlaceholder')"
            />
          </div>

          <div
            class="flex h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-3 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40 sm:w-auto sm:min-w-[11rem] sm:flex-[1.4]"
          >
            <User :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            <label for="request-author" class="sr-only">{{ t('bookRequests.search.authorLabel') }}</label>
            <input
              id="request-author"
              v-model="author"
              type="text"
              class="h-full w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none"
              :placeholder="t('bookRequests.search.authorPlaceholder')"
            />
          </div>

          <Button type="submit" class="w-full sm:w-auto sm:shrink-0" :disabled="isStreaming || !canSearch">
            <Loader2 v-if="isStreaming" class="animate-spin" aria-hidden="true" />
            {{ t('bookRequests.search.submit') }}
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-x-3.5 gap-y-2.5 border-t border-border bg-muted px-3 py-2.5">
          <!-- A real track, so three buttons read as one control rather than as loose links. -->
          <fieldset class="inline-flex h-9 items-center gap-0.5 rounded-lg border border-border bg-card p-[3px]">
            <legend class="sr-only">{{ t('bookRequests.search.mediaKindLabel') }}</legend>
            <button
              v-for="kind in BOOK_REQUEST_MEDIA_KINDS"
              :key="kind"
              type="button"
              class="inline-flex h-full items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              :class="mediaKind === kind ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="mediaKind === kind"
              @click="selectMediaKind(kind)"
            >
              <component :is="mediaIconFor(kind)" :size="13" aria-hidden="true" />
              {{ t(`bookRequests.mediaKind.${kind}`) }}
            </button>
          </fieldset>

          <fieldset
            v-if="canChooseFulfillment"
            class="inline-flex h-9 w-full items-center gap-0.5 rounded-lg border border-border bg-card p-[3px] sm:w-auto"
          >
            <legend class="sr-only">{{ t('bookRequests.search.fulfillmentLabel') }}</legend>
            <button
              type="button"
              class="inline-flex h-full flex-1 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none sm:flex-none"
              :class="fulfillmentMode === 'automatic' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'"
              :aria-pressed="fulfillmentMode === 'automatic'"
              @click="selectAutomaticFulfillment"
            >
              {{ t('bookRequests.search.fulfillmentAutomatic') }}
            </button>
            <button
              type="button"
              class="inline-flex h-full flex-1 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none sm:flex-none"
              :class="
                fulfillmentMode === 'choose_release' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground'
              "
              :aria-pressed="fulfillmentMode === 'choose_release'"
              @click="selectReleaseFulfillment"
            >
              {{ t('bookRequests.search.fulfillmentChooseRelease') }}
            </button>
          </fieldset>

          <template v-if="showDestination">
            <div class="flex w-full items-center gap-1.5 sm:w-auto">
              <label for="request-library" class="sr-only">{{ t('bookRequests.search.libraryLabel') }}</label>
              <select
                id="request-library"
                :value="targetLibraryId ?? ''"
                class="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:max-w-[15rem] sm:min-w-[11rem] sm:flex-none"
                @change="handleLibraryChange"
              >
                <!-- Names the instance default rather than saying nothing, so leaving this alone
                     is a visible choice instead of a request going somewhere unstated. -->
                <option value="">{{ unpickedDestinationLabel }}</option>
                <option v-for="library in libraries" :key="library.id" :value="library.id">{{ library.name }}</option>
              </select>
            </div>

            <template v-if="settlesOnCreate && folders.length > 1">
              <label for="request-folder" class="sr-only">{{ t('bookRequests.search.folderLabel') }}</label>
              <select
                id="request-folder"
                :value="targetFolderId ?? ''"
                class="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:w-auto sm:max-w-[15rem] sm:min-w-[11rem]"
                @change="handleFolderChange"
              >
                <option v-for="folder in folders" :key="folder.id" :value="folder.id">{{ folder.path }}</option>
              </select>
            </template>
          </template>

          <!-- Always offered, unlike the destination: the language decides what gets grabbed. -->
          <div class="flex w-full items-center gap-1.5 sm:w-auto">
            <label for="request-language" class="sr-only">{{ t('bookRequests.search.languageLabel') }}</label>
            <select
              id="request-language"
              :value="language ?? ''"
              class="h-9 min-w-0 flex-1 rounded-md border border-input bg-card px-3 text-sm text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:max-w-[15rem] sm:min-w-[11rem] sm:flex-none"
              @change="handleLanguageChange"
            >
              <option value="">{{ t('bookRequests.search.languageAny') }}</option>
              <option v-for="option in languageOptions" :key="option.code" :value="option.code">{{ option.name }}</option>
            </select>

            <!-- Asking for the same language every time is a preference, not a decision. -->
            <button
              v-if="language !== null"
              type="button"
              class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-card transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none"
              :class="isLanguagePinned ? 'text-primary' : 'text-muted-foreground hover:text-foreground focus-visible:text-foreground'"
              :aria-pressed="isLanguagePinned"
              :aria-label="t('bookRequests.search.languageDefaultToggleLabel')"
              :title="isLanguagePinned ? t('bookRequests.search.languageDefaultClearHint') : t('bookRequests.search.languageDefaultSetHint')"
              :disabled="savingLanguage"
              @click="toggleLanguageDefault"
            >
              <Pin :size="15" :class="isLanguagePinned ? 'fill-current' : undefined" aria-hidden="true" />
            </button>
          </div>

          <!--
            Collapsed by default: the common path is type, search, press Request, and neither of
            these is needed for it. The summary is what keeps a set preference from disappearing
            along with the panel that holds it.
          -->
          <button
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
            :aria-expanded="optionsOpen"
            aria-controls="request-more-options"
            @click="toggleOptions"
          >
            <SlidersHorizontal :size="13" aria-hidden="true" />
            {{ optionsOpen ? t('bookRequests.search.fewerOptions') : t('bookRequests.search.moreOptions') }}
            <span v-if="!optionsOpen && optionsSummary" class="text-primary">{{ optionsSummary }}</span>
          </button>

          <button
            v-if="showManualSearchOverride"
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60 motion-reduce:transition-none"
            :disabled="freeTextBusy || destinationMissing"
            @click="startFreeTextSearch"
          >
            <Search :size="13" aria-hidden="true" />
            {{ t('bookRequests.search.manualSearchAction') }}
          </button>
        </div>

        <div v-show="optionsOpen" id="request-more-options" class="grid gap-3 border-t border-border bg-muted px-3 py-3">
          <fieldset class="grid gap-1.5">
            <legend class="text-xs font-medium text-foreground">{{ t('bookRequests.search.preferredFormatsLabel') }}</legend>
            <p class="text-xs text-muted-foreground">{{ t('bookRequests.search.preferredFormatsHint') }}</p>
            <div class="mt-0.5 flex flex-wrap gap-1.5">
              <button
                v-for="format in mediaFormats"
                :key="format"
                type="button"
                class="inline-flex h-7 items-center rounded-full border px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
                :class="
                  isPreferredFormat(format)
                    ? 'border-primary bg-primary/12 text-primary'
                    : 'border-input bg-card text-muted-foreground hover:text-foreground focus-visible:text-foreground'
                "
                :aria-pressed="isPreferredFormat(format)"
                :aria-label="t('bookRequests.search.formatToggleAria', { format: format.toUpperCase() })"
                @click="togglePreferredFormat(format)"
              >
                {{ format.toUpperCase() }}
              </button>
            </div>
          </fieldset>

          <div class="grid gap-1.5">
            <label for="request-note" class="text-xs font-medium text-foreground">{{ t('bookRequests.search.noteLabel') }}</label>
            <textarea
              id="request-note"
              v-model="note"
              rows="2"
              maxlength="2000"
              class="w-full resize-y rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              :placeholder="t('bookRequests.search.notePlaceholder')"
            ></textarea>
          </div>
        </div>
      </div>
    </form>

    <p v-if="destinationMissing" class="text-sm text-muted-foreground">{{ t('bookRequests.search.libraryRequired') }}</p>

    <p v-if="isStreaming" role="status" class="sr-only">{{ t('bookRequests.search.searching') }}</p>

    <!--
      One card, on the same edges as the search card above it. The escape hatch is the answer to an
      empty search rather than a second notice about it, so it shares this block instead of adding a
      second one indented to its own left edge. It is offered only to somebody who can fulfil the
      request themselves: without the picker on the other side it would create a request an approver
      could not identify.
    -->
    <div
      v-else-if="hasSearched && groups.length === 0"
      role="status"
      class="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-5"
    >
      <div class="min-w-0 flex-1 space-y-0.5">
        <p class="text-sm font-medium text-foreground">{{ t('bookRequests.search.noResultsTitle') }}</p>
        <p class="text-sm text-muted-foreground">{{ noResultsHint }}</p>
        <p v-if="freeTextNotice" class="pt-1 text-sm text-muted-foreground">{{ freeTextNotice }}</p>
      </div>

      <Button
        v-if="showFreeTextOption"
        variant="outline"
        size="sm"
        class="w-full shrink-0 sm:w-auto"
        :disabled="freeTextBusy || destinationMissing"
        @click="startFreeTextSearch"
      >
        {{ t('bookRequests.search.freeTextAction') }}
      </Button>
    </div>

    <p v-if="interruptedMessage" role="status" class="text-sm text-muted-foreground">{{ interruptedMessage }}</p>

    <!-- One row per work. The records behind it are a footnote on the row, not rows of their own. -->
    <ul v-if="groups.length" class="space-y-2">
      <li
        v-for="group in groups"
        :key="group.key"
        class="flex flex-wrap items-center gap-3.5 rounded-lg border border-border bg-card p-3 transition-colors hover:border-ring/50 motion-reduce:transition-none"
      >
        <RequestCover
          :src="group.coverUrl"
          :fallback-sources="group.coverUrls.slice(1)"
          :source-key="group.key"
          :media-kind="mediaKind"
          class="h-[74px] w-[50px]"
          :icon-size="18"
          @source-change="handleCoverSourceChange"
        />

        <div class="min-w-0 flex-1 space-y-1">
          <p class="truncate text-[15px] font-semibold text-foreground">{{ group.title }}</p>
          <p v-if="group.authors.length" class="truncate text-sm text-muted-foreground">{{ group.authors.join(', ') }}</p>

          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span class="tabular-nums">{{ group.publishedYear ?? t('bookRequests.search.yearUnknown') }}</span>

            <span class="size-[3px] rounded-full bg-border" aria-hidden="true"></span>
            <span
              class="inline-flex items-center gap-1"
              :title="sourceNames(group)"
              :aria-label="t('bookRequests.search.sourcesLabel', { sources: sourceNames(group) })"
              role="img"
            >
              <span
                v-for="provider in group.providers"
                :key="provider"
                class="inline-flex size-6 items-center justify-center rounded-md border"
                :style="providerSourceStyle(provider)"
                :title="providerLabel(provider)"
                aria-hidden="true"
              >
                <img
                  v-if="providerIconPathSafe(provider) && !failedProviderIcons.has(provider)"
                  :src="providerIconPathSafe(provider) ?? undefined"
                  alt=""
                  class="size-3.5 rounded-[2px] object-contain"
                  loading="lazy"
                  @error="handleProviderIconError(provider)"
                />
                <span v-else class="text-[8px] font-bold leading-none text-foreground">{{ providerFallback(provider) }}</span>
              </span>
            </span>

            <button
              type="button"
              class="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40"
              :aria-expanded="isMetadataExpanded(group)"
              :aria-controls="`request-metadata-${group.key}`"
              @click="toggleMetadataDetails(group)"
            >
              {{ identifierSummary(group) }}
              <ChevronDown
                :size="12"
                class="transition-transform motion-reduce:transition-none"
                :class="isMetadataExpanded(group) ? 'rotate-180' : ''"
                aria-hidden="true"
              />
            </button>

            <template v-if="group.availability?.ownedBookId">
              <span class="size-[3px] rounded-full bg-border" aria-hidden="true"></span>
              <span class="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-success">
                <Library :size="12" aria-hidden="true" />
                {{ t('bookRequests.search.alreadyInLibrary') }}
              </span>
            </template>
            <template v-else-if="group.availability?.existingRequestId">
              <span class="size-[3px] rounded-full bg-border" aria-hidden="true"></span>
              <span class="inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-info">
                <component :is="group.availability.alreadySubscribed ? Check : Users" :size="12" aria-hidden="true" />
                {{
                  group.availability.alreadySubscribed ? t('bookRequests.search.alreadyRequestedByYou') : t('bookRequests.search.alreadyRequested')
                }}
              </span>
            </template>
          </div>
        </div>

        <div v-if="choosesRelease && !isJoinable(group)" class="flex shrink-0 items-center gap-1.5">
          <Popover>
            <PopoverTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                class="rounded-full text-muted-foreground"
                :aria-label="t('bookRequests.search.identifiers.recommendationHelpLabel')"
              >
                <CircleHelp :size="15" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" class="w-80 max-w-[calc(100vw-2rem)] space-y-3">
              <div>
                <p class="text-sm font-semibold text-foreground">{{ t('bookRequests.search.identifiers.recommendationTitle') }}</p>
                <p class="mt-1 text-xs text-muted-foreground">{{ recommendedSearchLabel(group) }}</p>
              </div>
              <ol class="list-decimal space-y-1 ps-4 text-xs text-muted-foreground">
                <li>{{ t('bookRequests.search.identifiers.recommendationLanguage') }}</li>
                <li>{{ t('bookRequests.search.identifiers.recommendationAgreement') }}</li>
                <li>{{ t('bookRequests.search.identifiers.recommendationProvider') }}</li>
                <li>{{ t('bookRequests.search.identifiers.recommendationRelevance') }}</li>
                <li>{{ t('bookRequests.search.identifiers.recommendationYear') }}</li>
                <li>{{ t('bookRequests.search.identifiers.recommendationStable') }}</li>
              </ol>
              <p class="text-xs text-muted-foreground">{{ t('bookRequests.search.identifiers.recommendationFallback') }}</p>
            </PopoverContent>
          </Popover>

          <div class="inline-flex rounded-md shadow-xs">
            <Button
              size="sm"
              class="rounded-e-none border-e border-primary-foreground/20"
              :disabled="isRequestDisabled(group)"
              @click="requestGroup(group)"
            >
              {{ t('bookRequests.search.chooseRelease') }}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  size="sm"
                  class="rounded-s-none px-2"
                  :disabled="isRequestDisabled(group)"
                  :aria-label="t('bookRequests.search.identifiers.chooseSearch')"
                >
                  <ChevronDown :size="14" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-80 max-w-[calc(100vw-2rem)]">
                <DropdownMenuLabel>{{ t('bookRequests.search.identifiers.searchByEdition') }}</DropdownMenuLabel>
                <DropdownMenuItem
                  v-for="choice in isbnSearchChoices(group)"
                  :key="choice.isbn"
                  class="items-center gap-3 py-2"
                  @click="requestGroupChoice(group, choice.candidate, choice.isbn)"
                >
                  <span class="min-w-0 flex-1">
                    <span class="block truncate font-mono text-xs text-foreground">{{ choice.isbn }}</span>
                    <span class="block truncate text-xs text-muted-foreground">{{ searchChoiceProviders(choice) }}</span>
                  </span>
                  <span class="flex shrink-0 flex-col items-end text-xs font-medium">
                    <span v-if="isRecommendedChoice(group, choice)" class="text-success">
                      {{ t('bookRequests.search.identifiers.recommended') }}
                    </span>
                    <span class="text-primary">{{ t('bookRequests.search.identifiers.findRelease') }}</span>
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem class="items-center gap-3 py-2" @click="requestTitleAuthor(group)">
                  <span class="min-w-0 flex-1">
                    <span class="block text-sm text-foreground">{{ t('bookRequests.search.identifiers.withoutIsbn') }}</span>
                    <span class="block truncate text-xs text-muted-foreground">{{ group.title }} · {{ group.authors[0] }}</span>
                  </span>
                  <span class="text-xs font-medium text-primary">{{ t('bookRequests.search.identifiers.findRelease') }}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <Button
          v-else
          size="sm"
          class="shrink-0"
          :variant="isJoinable(group) ? 'outline' : 'default'"
          :disabled="isRequestDisabled(group)"
          @click="requestGroup(group)"
        >
          {{ requestLabel(group) }}
        </Button>

        <div
          v-if="isMetadataExpanded(group)"
          :id="`request-metadata-${group.key}`"
          class="basis-full rounded-lg border border-border bg-muted/30 p-3"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="text-xs font-semibold text-foreground">{{ t('bookRequests.search.identifiers.sourcesTitle') }}</h3>
            <p class="text-xs text-muted-foreground">{{ searchScopeText(group) }}</p>
          </div>
          <div class="mt-2 overflow-x-auto">
            <table class="w-full min-w-[40rem] text-start text-xs">
              <thead class="text-muted-foreground">
                <tr class="border-b border-border">
                  <th scope="col" class="px-2 py-1.5 text-start font-medium">{{ t('bookRequests.search.identifiers.provider') }}</th>
                  <th scope="col" class="px-2 py-1.5 text-start font-medium">{{ t('bookRequests.search.identifiers.providerTitle') }}</th>
                  <th scope="col" class="px-2 py-1.5 text-start font-medium">{{ t('bookRequests.search.identifiers.isbn') }}</th>
                  <th scope="col" class="px-2 py-1.5 text-start font-medium">{{ t('bookRequests.search.identifiers.year') }}</th>
                  <th scope="col" class="px-2 py-1.5 text-start font-medium">{{ t('bookRequests.search.identifiers.language') }}</th>
                  <th v-if="choosesRelease && !isJoinable(group)" scope="col" class="px-2 py-1.5 text-end font-medium">
                    {{ t('bookRequests.search.identifiers.action') }}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="candidate in group.candidates"
                  :key="`${candidate.provider}:${candidate.providerId}`"
                  class="border-b border-border/60 last:border-0"
                >
                  <td class="px-2 py-2 font-medium text-foreground">{{ candidateProviderLabel(candidate) }}</td>
                  <td class="max-w-72 truncate px-2 py-2 text-foreground" :title="candidateDisplayTitle(candidate)">
                    {{ candidateDisplayTitle(candidate) }}
                  </td>
                  <td class="px-2 py-2 font-mono text-foreground">{{ candidateIsbn(candidate) }}</td>
                  <td class="px-2 py-2 tabular-nums text-muted-foreground">{{ candidateYear(candidate) }}</td>
                  <td class="px-2 py-2 text-muted-foreground">{{ candidateLanguage(candidate) }}</td>
                  <td v-if="choosesRelease && !isJoinable(group)" class="px-2 py-2 text-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      class="h-7"
                      :disabled="isRequestDisabled(group)"
                      @click="requestCandidate(group, candidate)"
                    >
                      {{ t('bookRequests.search.identifiers.findRelease') }}
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
