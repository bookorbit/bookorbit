<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Loader2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  BOOK_REQUEST_IMPORT_FORMATS,
  BOOK_REQUEST_MEDIA_KINDS,
  MAX_AUTO_GRAB_ATTEMPTS_LIMIT,
  MAX_AUTO_SEARCH_INTERVAL_HOURS,
  MAX_AUTO_SEARCH_MAX_AGE_DAYS,
  MIN_AUTO_GRAB_SCORE_FLOOR,
  MIN_AUTO_SEARCH_INTERVAL_HOURS,
  MIN_AUTO_SEARCH_MAX_AGE_DAYS,
} from '@bookorbit/types'
import type { BookRequestImportFormats, BookRequestMediaKind, ReleaseTier, RequestDestination } from '@bookorbit/types'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'
import ReleaseProfileEditor from './components/ReleaseProfileEditor.vue'
import RequestDestinationRow from './components/RequestDestinationRow.vue'
import SettingsRow from './components/SettingsRow.vue'
import SettingsSlider from './components/SettingsSlider.vue'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { useIndexers } from '@/features/book-requests/composables/useIndexers'
import { useRequestAutomation } from '@/features/book-requests/composables/useRequestAutomation'
import { useRequestSourceStatus } from '@/features/book-requests/composables/useRequestSourceStatus'

const { t } = useI18n()

const { settings, loading, loadFailed, fetchSettings, save } = useRequestAutomation()
const { libraries, fetchLibraries } = useLibraries()
const { indexers, fetchIndexers } = useIndexers()
/**
 * Auto-grab switched on with nothing to search is the one setting on this tab that reports success
 * and does nothing. Every request it touches is handed straight back, and the summary above it
 * says BookOrbit will grab anything clearing the score - about a search that will never run.
 *
 * The counts rather than the indexer list, even though this is an admin page: the list carries a
 * row per source with its credential state, and all this needs to know is whether any of them is
 * on. The counts also answer for an operator who holds `manage_app_settings` alone.
 */
const { noSourcesEnabled, noSourcesConfigured, fetchSourceStatus } = useRequestSourceStatus()

const MEDIA_KINDS = BOOK_REQUEST_MEDIA_KINDS

/**
 * The sliders are dragged, so they need a local value to move against. Everything else writes
 * straight through, and every save adopts what the server reports back.
 */
const minScore = ref(settings.value.autoGrabMinScore)
const attempts = ref(settings.value.maxAutoGrabAttempts)
const threshold = ref(settings.value.verificationThreshold)
const searchInterval = ref(settings.value.autoSearchIntervalHours)
const searchMaxAge = ref(settings.value.autoSearchMaxAgeDays)

/** What these five refs were last taken from, so an unrelated save can be told apart from a change. */
let adopted = {
  autoGrabMinScore: settings.value.autoGrabMinScore,
  maxAutoGrabAttempts: settings.value.maxAutoGrabAttempts,
  verificationThreshold: settings.value.verificationThreshold,
  autoSearchIntervalHours: settings.value.autoSearchIntervalHours,
  autoSearchMaxAgeDays: settings.value.autoSearchMaxAgeDays,
}

/**
 * Adopt a field only where the server's own value for it moved.
 *
 * Every control on this tab writes through and adopts what comes back, so flipping one checkbox
 * re-emits the whole settings object; overwriting all five local values from it wiped a number
 * half-typed in the box beside it and snapped a slider back mid-drag. Comparing against what these
 * refs were last taken from leaves them alone on an unrelated save, while a genuine change - this
 * page's own save, a refetch, another operator - still wins.
 */
watch(settings, (next) => {
  if (next.autoGrabMinScore !== adopted.autoGrabMinScore) minScore.value = next.autoGrabMinScore
  if (next.maxAutoGrabAttempts !== adopted.maxAutoGrabAttempts) attempts.value = next.maxAutoGrabAttempts
  if (next.verificationThreshold !== adopted.verificationThreshold) threshold.value = next.verificationThreshold
  if (next.autoSearchIntervalHours !== adopted.autoSearchIntervalHours) searchInterval.value = next.autoSearchIntervalHours
  if (next.autoSearchMaxAgeDays !== adopted.autoSearchMaxAgeDays) searchMaxAge.value = next.autoSearchMaxAgeDays

  adopted = {
    autoGrabMinScore: next.autoGrabMinScore,
    maxAutoGrabAttempts: next.maxAutoGrabAttempts,
    verificationThreshold: next.verificationThreshold,
    autoSearchIntervalHours: next.autoSearchIntervalHours,
    autoSearchMaxAgeDays: next.autoSearchMaxAgeDays,
  }
})

onMounted(fetchSettings)
onMounted(fetchLibraries)
onMounted(fetchSourceStatus)
onMounted(() => fetchIndexers({ withAdapters: false }))

/**
 * What this server will actually do to an approved request, in one sentence. Assembled from the
 * dragged values rather than the saved ones so it answers the question while the slider moves.
 */
const downloadsSummary = computed(() => {
  if (!settings.value.autoGrabEnabled) return t('settings.system.requests.automation.summaryOff')
  const score = minScore.value
  if (!settings.value.autoRetryEnabled) return t('settings.system.requests.automation.summaryNoRetry', { score })
  const count = Number.isInteger(attempts.value) ? attempts.value : settings.value.maxAutoGrabAttempts
  return t('settings.system.requests.automation.summaryRetry', { score, count })
})

const importsSummary = computed(() =>
  settings.value.verificationEnabled ? t('settings.system.requests.automation.verifyOnHint') : t('settings.system.requests.automation.verifyOffHint'),
)

function stateLabel(enabled: boolean) {
  return enabled ? t('settings.system.requests.automation.stateOn') : t('settings.system.requests.automation.stateOff')
}

/**
 * Bumped when a write-through save is refused.
 *
 * The destination rows and the profile editor are driven entirely by props, so a refusal leaves
 * their props exactly as they were and Vue with nothing to re-render: the select goes on pointing
 * at a library that was never stored, and the tier name box keeps the text that never left the
 * browser. Re-keying them rebuilds both from the settings actually in force.
 */
const editorRevision = ref(0)

/** How long the profile editor is left alone before its accumulated edits are sent. */
const PROFILE_SAVE_DEBOUNCE_MS = 700
const profileHandles = new Map<BookRequestMediaKind, ReturnType<typeof setTimeout>>()
const pendingProfiles = new Map<BookRequestMediaKind, ReleaseTier[]>()

onScopeDispose(() => {
  for (const mediaKind of pendingProfiles.keys()) flushProfile(mediaKind)
})

/** `successKey` of null saves quietly: the control that asked already shows what it did. */
async function persist(payload: Parameters<typeof save>[0], successKey: string | null) {
  if (await save(payload)) {
    if (successKey) toast.success(t(successKey))
    return
  }
  toast.error(t('settings.system.requests.automation.saveFailed'))
  editorRevision.value++
}

function handleAutoGrabChange(enabled: boolean) {
  void persist(
    { autoGrabEnabled: enabled },
    enabled ? 'settings.system.requests.automation.autoGrabEnabled' : 'settings.system.requests.automation.autoGrabDisabled',
  )
}

/**
 * Radios rather than a toggle: neither value is the "off" one, and a switch would have to pick a
 * side to be off. Both are ordinary choices about what a library should hold.
 */
const IMPORT_FORMAT_OPTIONS = BOOK_REQUEST_IMPORT_FORMATS

function handleImportFormatsChange(importFormats: BookRequestImportFormats) {
  void persist({ importFormats }, 'settings.system.requests.automation.saved')
}

/**
 * One medium at a time, so changing where audiobooks go cannot resend, and therefore cannot
 * clobber, a destination somebody else set for ebooks between this page loading and saving.
 */
function handleDestinationChange(mediaKind: BookRequestMediaKind, destination: RequestDestination) {
  void persist({ destinations: { [mediaKind]: destination } }, 'settings.system.requests.automation.saved')
}

/**
 * One medium at a time, for the same reason destinations are: a profile is an ordered list, and
 * resending all three would clobber a list somebody else reordered between this page loading and
 * this one saving.
 *
 * Debounced, and quiet on success. A tier is built by clicking through a row of format chips, two
 * checkboxes and two number boxes, and each of those used to be its own PUT and its own "Saved"
 * toast: eight round trips and a stack of eight identical toasts for one tier nobody had finished
 * describing. The editor shows the change immediately, so what this waits for is the typing to
 * stop; a refusal still says so, because that is the one outcome the operator cannot see.
 */
function handleProfileChange(mediaKind: BookRequestMediaKind, tiers: ReleaseTier[]) {
  pendingProfiles.set(mediaKind, tiers)
  const running = profileHandles.get(mediaKind)
  if (running) clearTimeout(running)

  profileHandles.set(
    mediaKind,
    setTimeout(() => flushProfile(mediaKind), PROFILE_SAVE_DEBOUNCE_MS),
  )
}

/** Sends the last complete local profile, including when navigation disposes the debounce timer. */
function flushProfile(mediaKind: BookRequestMediaKind) {
  const handle = profileHandles.get(mediaKind)
  if (handle) clearTimeout(handle)
  profileHandles.delete(mediaKind)
  const next = pendingProfiles.get(mediaKind)
  pendingProfiles.delete(mediaKind)
  if (next) void persist({ profiles: { [mediaKind]: next } }, null)
}

function handleAutoRetryChange(enabled: boolean) {
  void persist({ autoRetryEnabled: enabled }, 'settings.system.requests.automation.saved')
}

function handleMinScoreChange() {
  void persist({ autoGrabMinScore: minScore.value }, 'settings.system.requests.automation.saved')
}

/**
 * `v-model.number` hands back an empty string for a cleared box, and the spinner does not clamp
 * what is typed into it. Anything the endpoint would reject is put back to the running value
 * rather than sent for a 400.
 */
function handleAttemptsChange() {
  const next = Number(attempts.value)
  if (!Number.isInteger(next) || next < 1 || next > MAX_AUTO_GRAB_ATTEMPTS_LIMIT) {
    attempts.value = settings.value.maxAutoGrabAttempts
    return
  }
  void persist({ maxAutoGrabAttempts: next }, 'settings.system.requests.automation.saved')
}

function handleAutoSearchChange(enabled: boolean) {
  void persist(
    { autoSearchEnabled: enabled },
    enabled ? 'settings.system.requests.automation.autoSearchEnabledToast' : 'settings.system.requests.automation.autoSearchDisabledToast',
  )
}

/** Same guard as the attempts box: a cleared spinner is an empty string, and neither box clamps. */
function handleSearchIntervalChange() {
  const next = Number(searchInterval.value)
  if (!Number.isInteger(next) || next < MIN_AUTO_SEARCH_INTERVAL_HOURS || next > MAX_AUTO_SEARCH_INTERVAL_HOURS) {
    searchInterval.value = settings.value.autoSearchIntervalHours
    return
  }
  void persist({ autoSearchIntervalHours: next }, 'settings.system.requests.automation.saved')
}

function handleSearchMaxAgeChange() {
  const next = Number(searchMaxAge.value)
  if (!Number.isInteger(next) || next < MIN_AUTO_SEARCH_MAX_AGE_DAYS || next > MAX_AUTO_SEARCH_MAX_AGE_DAYS) {
    searchMaxAge.value = settings.value.autoSearchMaxAgeDays
    return
  }
  void persist({ autoSearchMaxAgeDays: next }, 'settings.system.requests.automation.saved')
}

function handleThresholdChange() {
  void persist({ verificationThreshold: threshold.value }, 'settings.system.requests.automation.saved')
}

function handleVerificationChange(enabled: boolean) {
  void persist(
    { verificationEnabled: enabled },
    enabled ? 'settings.system.requests.automation.verificationEnabled' : 'settings.system.requests.automation.verificationDisabled',
  )
}
</script>

<template>
  <div v-if="loading" class="settings-loading-state">
    <Loader2 class="size-5 animate-spin text-muted-foreground" />
    <span class="sr-only">{{ t('settings.system.requests.automation.loading') }}</span>
  </div>

  <section v-else aria-labelledby="request-automation-heading" class="space-y-3">
    <h2 id="request-automation-heading" class="sr-only">{{ t('settings.system.requests.automation.title') }}</h2>

    <p v-if="loadFailed" role="alert" class="text-sm text-destructive">{{ t('settings.system.requests.automation.loadFailed') }}</p>

    <div class="settings-card">
      <div class="settings-card-header">
        <span class="settings-card-title">{{ t('settings.system.requests.automation.groupDownloads') }}</span>
        <span class="settings-state-pill">{{ stateLabel(settings.autoGrabEnabled) }}</span>
      </div>

      <p class="settings-hint settings-prose bg-card px-4 py-3 md:px-5">{{ downloadsSummary }}</p>

      <p
        v-if="settings.autoGrabEnabled && noSourcesEnabled"
        role="status"
        class="settings-hint settings-prose bg-card px-4 pb-3 text-warning md:px-5"
      >
        {{
          noSourcesConfigured
            ? t('settings.system.requests.automation.noSourcesConfigured')
            : t('settings.system.requests.automation.noSourcesEnabled')
        }}
      </p>

      <SettingsRow :label="t('settings.system.requests.automation.autoGrab')">
        <ToggleSwitch
          :model-value="settings.autoGrabEnabled"
          :aria-label="t('settings.system.requests.automation.autoGrab')"
          @update:model-value="handleAutoGrabChange"
        />
      </SettingsRow>

      <div v-if="settings.autoGrabEnabled" class="settings-subgroup ml-4 md:ml-5">
        <SettingsRow
          class="pl-3 md:pl-4"
          control-id="auto-grab-min-score"
          :label="t('settings.system.requests.automation.minScore')"
          :hint="t('settings.system.requests.automation.minScoreShort')"
        >
          <SettingsSlider
            id="auto-grab-min-score"
            v-model="minScore"
            :min="MIN_AUTO_GRAB_SCORE_FLOOR"
            :max="100"
            :step="5"
            @change="handleMinScoreChange"
          />
        </SettingsRow>

        <SettingsRow
          class="pl-3 md:pl-4"
          :label="t('settings.system.requests.automation.autoRetry')"
          :hint="t('settings.system.requests.automation.autoRetryShort')"
        >
          <ToggleSwitch
            :model-value="settings.autoRetryEnabled"
            :aria-label="t('settings.system.requests.automation.autoRetry')"
            @update:model-value="handleAutoRetryChange"
          />
        </SettingsRow>

        <SettingsRow
          class="pl-3 md:pl-4"
          control-id="auto-grab-attempts"
          :label="t('settings.system.requests.automation.maxAttempts')"
          :hint="t('settings.system.requests.automation.maxAttemptsShort')"
        >
          <input
            id="auto-grab-attempts"
            v-model.number="attempts"
            type="number"
            inputmode="numeric"
            min="1"
            :max="MAX_AUTO_GRAB_ATTEMPTS_LIMIT"
            step="1"
            class="input-field w-20"
            @change="handleAttemptsChange"
          />
        </SettingsRow>

        <SettingsRow
          class="pl-3 md:pl-4"
          :label="t('settings.system.requests.automation.autoSearch')"
          :hint="t('settings.system.requests.automation.autoSearchShort')"
        >
          <ToggleSwitch
            :model-value="settings.autoSearchEnabled"
            :aria-label="t('settings.system.requests.automation.autoSearch')"
            @update:model-value="handleAutoSearchChange"
          />
        </SettingsRow>

        <template v-if="settings.autoSearchEnabled">
          <SettingsRow
            class="pl-6 md:pl-8"
            control-id="auto-search-interval"
            :label="t('settings.system.requests.automation.autoSearchInterval')"
            :hint="t('settings.system.requests.automation.autoSearchIntervalShort')"
          >
            <div class="flex items-center gap-2">
              <input
                id="auto-search-interval"
                v-model.number="searchInterval"
                type="number"
                inputmode="numeric"
                :min="MIN_AUTO_SEARCH_INTERVAL_HOURS"
                :max="MAX_AUTO_SEARCH_INTERVAL_HOURS"
                step="1"
                class="input-field w-20"
                @change="handleSearchIntervalChange"
              />
              <span class="text-xs text-muted-foreground">{{ t('settings.system.requests.automation.autoSearchIntervalUnit') }}</span>
            </div>
          </SettingsRow>

          <SettingsRow
            class="pl-6 md:pl-8"
            control-id="auto-search-max-age"
            :label="t('settings.system.requests.automation.autoSearchMaxAge')"
            :hint="t('settings.system.requests.automation.autoSearchMaxAgeShort')"
          >
            <div class="flex items-center gap-2">
              <input
                id="auto-search-max-age"
                v-model.number="searchMaxAge"
                type="number"
                inputmode="numeric"
                :min="MIN_AUTO_SEARCH_MAX_AGE_DAYS"
                :max="MAX_AUTO_SEARCH_MAX_AGE_DAYS"
                step="1"
                class="input-field w-20"
                @change="handleSearchMaxAgeChange"
              />
              <span class="text-xs text-muted-foreground">{{ t('settings.system.requests.automation.autoSearchMaxAgeUnit') }}</span>
            </div>
          </SettingsRow>
        </template>
      </div>

      <details class="group bg-card px-4 py-3 md:px-5">
        <summary
          class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight class="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          {{ t('settings.system.requests.automation.howDownloads') }}
        </summary>
        <div class="mt-2 space-y-2 settings-prose">
          <p class="settings-hint">{{ t('settings.system.requests.automation.autoGrabHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.minScoreHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.autoRetryHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.maxAttemptsHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.autoSearchHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.autoSearchIntervalHint') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.autoSearchMaxAgeHint') }}</p>
        </div>
      </details>
    </div>

    <div class="settings-card">
      <div class="settings-card-header">
        <span class="settings-card-title">{{ t('settings.system.requests.automation.groupImports') }}</span>
        <span class="settings-state-pill">{{ stateLabel(settings.verificationEnabled) }}</span>
      </div>

      <p class="settings-hint settings-prose bg-card px-4 py-3 md:px-5">{{ importsSummary }}</p>

      <SettingsRow :label="t('settings.system.requests.automation.verify')">
        <ToggleSwitch
          :model-value="settings.verificationEnabled"
          :aria-label="t('settings.system.requests.automation.verify')"
          @update:model-value="handleVerificationChange"
        />
      </SettingsRow>

      <SettingsRow
        v-if="settings.verificationEnabled"
        class="settings-subgroup ml-4 pl-3 md:ml-5 md:pl-4"
        control-id="request-verification-threshold"
        :label="t('settings.system.requests.automation.verification')"
        :hint="t('settings.system.requests.automation.verificationShort')"
      >
        <SettingsSlider id="request-verification-threshold" v-model="threshold" :min="0" :max="100" :step="5" @change="handleThresholdChange" />
      </SettingsRow>

      <details class="group bg-card px-4 py-3 md:px-5">
        <summary
          class="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <ChevronRight class="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
          {{ t('settings.system.requests.automation.howImports') }}
        </summary>
        <div class="mt-2 space-y-2 settings-prose">
          <p class="settings-hint">{{ t('settings.system.requests.automation.pipeline') }}</p>
          <p class="settings-hint">{{ t('settings.system.requests.automation.verificationHint') }}</p>
        </div>
      </details>
    </div>

    <div class="settings-card">
      <fieldset>
        <legend class="settings-card-header w-full">
          <span class="settings-card-title">{{ t('settings.system.requests.automation.destinations') }}</span>
        </legend>

        <div class="border-t border-border px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-hint settings-prose">{{ t('settings.system.requests.automation.destinationsHint') }}</p>

          <div class="mt-3 grid gap-3">
            <RequestDestinationRow
              v-for="mediaKind in MEDIA_KINDS"
              :key="`${mediaKind}-${editorRevision}`"
              :media-kind="mediaKind"
              :libraries="libraries"
              :destination="settings.destinations[mediaKind]"
              @update="handleDestinationChange"
            />
          </div>
        </div>
      </fieldset>
    </div>

    <div class="settings-card">
      <fieldset>
        <legend class="settings-card-header w-full">
          <span class="settings-card-title">{{ t('settings.system.requests.profiles.title') }}</span>
        </legend>

        <div class="border-t border-border px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-hint settings-prose">{{ t('settings.system.requests.profiles.hint') }}</p>

          <div class="mt-3 grid gap-4">
            <div v-for="mediaKind in MEDIA_KINDS" :key="mediaKind">
              <h3 class="text-xs font-medium text-foreground">{{ t(`bookRequests.mediaKind.${mediaKind}`) }}</h3>
              <div class="mt-1.5">
                <ReleaseProfileEditor
                  :key="`${mediaKind}-${editorRevision}`"
                  :media-kind="mediaKind"
                  :tiers="settings.profiles[mediaKind]"
                  :indexers="indexers"
                  @update="handleProfileChange"
                />
              </div>
            </div>
          </div>
        </div>
      </fieldset>
    </div>

    <div class="settings-card">
      <fieldset>
        <legend class="settings-card-header w-full">
          <span class="settings-card-title">{{ t('settings.system.requests.automation.importFormats') }}</span>
        </legend>

        <div class="border-t border-border px-4 py-3.5 md:px-5 md:py-4">
          <p class="settings-hint settings-prose">{{ t('settings.system.requests.automation.importFormatsHint') }}</p>

          <div class="mt-3 grid gap-2">
            <label v-for="option in IMPORT_FORMAT_OPTIONS" :key="option" class="flex items-start gap-2.5">
              <input
                type="radio"
                name="import-formats"
                class="mt-0.5 accent-primary"
                :value="option"
                :checked="settings.importFormats === option"
                @change="handleImportFormatsChange(option)"
              />
              <span class="min-w-0 settings-prose">
                <span class="block text-xs font-medium text-foreground">
                  {{ t(`settings.system.requests.automation.importFormatsOption.${option}`) }}
                </span>
                <span class="settings-hint block">
                  {{ t(`settings.system.requests.automation.importFormatsOption.${option}Hint`) }}
                </span>
              </span>
            </label>
          </div>
        </div>
      </fieldset>
    </div>
  </section>
</template>
