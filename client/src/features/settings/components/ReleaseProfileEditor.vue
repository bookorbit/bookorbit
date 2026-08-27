<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDown, ArrowUp, Plus, X } from '@lucide/vue'
import {
  AUDIO_FORMAT_LIST,
  COMIC_FORMAT_LIST,
  EBOOK_FORMAT_LIST,
  MAX_RELEASE_TIER_NAME_LENGTH,
  MAX_RELEASE_TIERS,
  REQUEST_LANGUAGE_CODES,
} from '@bookorbit/types'
import type { BookRequestMediaKind, IndexerItem, ReleaseFileLayout, ReleaseTier, ReleaseTierConditions } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import TokenSelect from '@/components/ui/TokenSelect.vue'
import { formatLanguageName } from '@/i18n/formatters'

/**
 * One medium's release profile: an ordered list of the shapes an operator will accept, best first.
 * Order is the whole meaning here, so reordering is a first-class control rather than a detail.
 */
const props = defineProps<{
  mediaKind: BookRequestMediaKind
  tiers: ReleaseTier[]
  indexers: readonly Pick<IndexerItem, 'id' | 'name'>[]
}>()

const emit = defineEmits<{ update: [mediaKind: BookRequestMediaKind, tiers: ReleaseTier[]] }>()

const { t, locale } = useI18n()

/**
 * The list this editor draws, held locally so a chip responds to the click rather than to the save.
 *
 * Driven straight from the prop, every control on a tier waited for its own round trip before it
 * looked pressed, which is also what made a debounce impossible: the save was the only thing that
 * moved the UI. The prop is still the authority; it is adopted whenever it says something this
 * editor did not.
 */
const tiers = ref<ReleaseTier[]>(clone(props.tiers))
/** What `tiers` was last taken from, so an unrelated save re-emitting the settings is not a change. */
let adopted = JSON.stringify(props.tiers)
/** True while the server has not yet echoed the latest local profile back. */
let dirty = false

watch(
  () => props.tiers,
  (next) => {
    const serialized = JSON.stringify(next)
    if (dirty) {
      // A different settings control can return the old profile while this editor's debounce is
      // still waiting. Ignore that stale echo; the matching reply from this profile's own save is
      // what makes the prop authoritative again.
      if (serialized === adopted) dirty = false
      return
    }
    if (serialized === adopted) return
    adopted = serialized
    tiers.value = clone(next)
  },
)

function clone(list: ReleaseTier[]): ReleaseTier[] {
  return list.map((tier) => ({ ...tier, conditions: { ...tier.conditions } }))
}

/** Offered from the same lists the matcher accepts, so a form can never state an impossible tier. */
const FORMATS: Record<BookRequestMediaKind, readonly string[]> = {
  ebook: EBOOK_FORMAT_LIST,
  audiobook: AUDIO_FORMAT_LIST,
  comic: [...COMIC_FORMAT_LIST, 'pdf'],
}

/** Bitrate and channels describe an encode, which an ebook or a comic does not have. */
const isAudio = computed(() => props.mediaKind === 'audiobook')
const formats = computed(() => FORMATS[props.mediaKind])
const languageOptions = computed(() =>
  REQUEST_LANGUAGE_CODES.map((code) => ({ value: code, label: formatLanguageName(code) })).sort((left, right) =>
    left.label.localeCompare(right.label, locale.value),
  ),
)
const indexerOptions = computed(() => props.indexers.map((indexer) => ({ value: String(indexer.id), label: indexer.name })))

/** One hint for both pickers, so each field points at the same sentence rather than repeating it. */
const multiSelectHintId = `release-profile-multi-select-hint-${props.mediaKind}`
const canAdd = computed(() => tiers.value.length < MAX_RELEASE_TIERS)
/**
 * Shown only once a tier actually sets a floor. MyAnonaMouse publishes MediaInfo for some torrents
 * and not others, so a floor silently matches nothing on a book nobody measured, and the fix - a
 * tier below it without one - is not something an operator would guess from an empty result.
 */
const warnsAboutBitrate = computed(() => tiers.value.some((tier) => tier.conditions.minBitrateKbps !== undefined))
const LAYOUTS: ReleaseFileLayout[] = ['single', 'multi']

function commit(next: ReleaseTier[]) {
  tiers.value = next
  adopted = JSON.stringify(next)
  dirty = true
  emit('update', props.mediaKind, next)
}

function patch(index: number, conditions: Partial<ReleaseTierConditions>) {
  commit(tiers.value.map((tier, i) => (i === index ? { ...tier, conditions: prune({ ...tier.conditions, ...conditions }) } : tier)))
}

/**
 * An absent key and an empty one mean different things to the matcher: `formats: []` would be
 * stored as a condition that constrains nothing, and a cleared number must stop being a floor
 * rather than become a floor of zero.
 */
function prune(conditions: ReleaseTierConditions): ReleaseTierConditions {
  const next: ReleaseTierConditions = { ...conditions }
  if (next.formats && next.formats.length === 0) delete next.formats
  if (next.languages && next.languages.length === 0) delete next.languages
  if (next.indexerIds && next.indexerIds.length === 0) delete next.indexerIds
  if (next.minBitrateKbps === undefined || Number.isNaN(next.minBitrateKbps)) delete next.minBitrateKbps
  if (next.minSeeders === undefined || Number.isNaN(next.minSeeders)) delete next.minSeeders
  if (next.channels === undefined || Number.isNaN(next.channels)) delete next.channels
  if (next.maxSizeBytes === undefined || Number.isNaN(next.maxSizeBytes)) delete next.maxSizeBytes
  if (next.freeleechOnly === false) delete next.freeleechOnly
  if (next.excludeVipOnly === false) delete next.excludeVipOnly
  return next
}

function addTier() {
  if (!canAdd.value) return
  const tier: ReleaseTier = {
    id: crypto.randomUUID(),
    name: t('settings.system.requests.profiles.newTier', { position: tiers.value.length + 1 }),
    conditions: {},
  }
  commit([...tiers.value, tier])
}

function removeTier(index: number) {
  commit(tiers.value.filter((_, i) => i !== index))
}

/** Buttons rather than drag: the list is short, and this stays usable from a keyboard. */
function move(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= tiers.value.length) return
  const next = [...tiers.value]
  const [moved] = next.splice(index, 1)
  if (!moved) return
  next.splice(target, 0, moved)
  commit(next)
}

function handleName(index: number, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim()
  commit(tiers.value.map((tier, i) => (i === index ? { ...tier, name } : tier)))
}

function toggleFormat(index: number, format: string) {
  const current = tiers.value[index]?.conditions.formats ?? []
  const next = current.includes(format) ? current.filter((value) => value !== format) : [...current, format]
  patch(index, { formats: next })
}

function handleLayout(index: number, event: Event) {
  const value = (event.target as HTMLSelectElement).value
  patch(index, { fileLayout: value === '' ? undefined : (value as ReleaseFileLayout) })
}

function handleNumber(index: number, key: 'minBitrateKbps' | 'minSeeders', event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim()
  patch(index, { [key]: raw === '' ? undefined : Number(raw) })
}

/** The two the matcher understands: 1 is mono, 2 is stereo. Anything else it treats as unstated. */
const MONO = 1
const STEREO = 2

function handleChannels(index: number, event: Event) {
  const value = Number((event.target as HTMLSelectElement).value)
  patch(index, { channels: value === MONO || value === STEREO ? value : undefined })
}

/** Stored in bytes and entered in megabytes, because nobody types a ceiling in bytes. */
const BYTES_PER_MEGABYTE = 1024 * 1024

function sizeInMegabytes(bytes: number | undefined): number | '' {
  return bytes === undefined ? '' : Math.round(bytes / BYTES_PER_MEGABYTE)
}

function handleMaxSize(index: number, event: Event) {
  const raw = (event.target as HTMLInputElement).value.trim()
  const megabytes = Number(raw)
  patch(index, { maxSizeBytes: raw === '' || !Number.isFinite(megabytes) || megabytes <= 0 ? undefined : megabytes * BYTES_PER_MEGABYTE })
}

function handleLanguages(index: number, languages: string[]) {
  patch(index, { languages })
}

function handleIndexers(index: number, indexerIds: string[]) {
  patch(index, { indexerIds: indexerIds.map(Number).filter(Number.isInteger) })
}

function handleFreeleech(index: number, event: Event) {
  patch(index, { freeleechOnly: (event.target as HTMLInputElement).checked })
}

function handleExcludeVip(index: number, event: Event) {
  patch(index, { excludeVipOnly: (event.target as HTMLInputElement).checked })
}

function hasFormat(index: number, format: string): boolean {
  return (tiers.value[index]?.conditions.formats ?? []).includes(format)
}
</script>

<template>
  <div>
    <p v-if="tiers.length === 0" class="settings-hint settings-prose">
      {{ t('settings.system.requests.profiles.empty') }}
    </p>

    <ol v-else class="grid gap-2">
      <li v-for="(tier, index) in tiers" :key="tier.id" class="rounded-lg border border-border bg-card p-3">
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground"
            aria-hidden="true"
          >
            {{ index + 1 }}
          </span>

          <input
            :value="tier.name"
            type="text"
            class="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            :aria-label="t('settings.system.requests.profiles.tierName')"
            :maxlength="MAX_RELEASE_TIER_NAME_LENGTH"
            @change="handleName(index, $event)"
          />

          <div class="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              :disabled="index === 0"
              :aria-label="t('settings.system.requests.profiles.moveUp')"
              @click="move(index, -1)"
            >
              <ArrowUp :size="14" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              :disabled="index === tiers.length - 1"
              :aria-label="t('settings.system.requests.profiles.moveDown')"
              @click="move(index, 1)"
            >
              <ArrowDown :size="14" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon" :aria-label="t('settings.system.requests.profiles.removeTier')" @click="removeTier(index)">
              <X :size="14" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div class="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
              {{ t('settings.system.requests.profiles.formats') }}
            </span>
            <button
              v-for="format in formats"
              :key="format"
              type="button"
              class="rounded-full border px-2 py-0.5 text-xs uppercase transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              :class="
                hasFormat(index, format)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:border-ring hover:text-foreground'
              "
              :aria-pressed="hasFormat(index, format)"
              @click="toggleFormat(index, format)"
            >
              {{ format }}
            </button>
          </div>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            {{ t('settings.system.requests.profiles.files') }}
            <select
              :value="tier.conditions.fileLayout ?? ''"
              class="rounded-md border border-input bg-background px-1.5 py-1 text-xs text-foreground"
              @change="handleLayout(index, $event)"
            >
              <option value="">{{ t('settings.system.requests.profiles.anyLayout') }}</option>
              <option v-for="layout in LAYOUTS" :key="layout" :value="layout">
                {{ t(`bookRequests.releases.fileLayout.${layout}`) }}
              </option>
            </select>
          </label>

          <label v-if="isAudio" class="flex items-center gap-1.5 text-xs text-muted-foreground">
            {{ t('settings.system.requests.profiles.minBitrate') }}
            <input
              :value="tier.conditions.minBitrateKbps ?? ''"
              type="number"
              min="0"
              step="16"
              class="w-16 rounded-md border border-input bg-background px-1.5 py-1 text-xs tabular-nums text-foreground"
              @change="handleNumber(index, 'minBitrateKbps', $event)"
            />
          </label>

          <label v-if="isAudio" class="flex items-center gap-1.5 text-xs text-muted-foreground">
            {{ t('settings.system.requests.profiles.channels') }}
            <select
              :value="tier.conditions.channels ?? ''"
              class="rounded-md border border-input bg-background px-1.5 py-1 text-xs text-foreground"
              @change="handleChannels(index, $event)"
            >
              <option value="">{{ t('settings.system.requests.profiles.anyChannels') }}</option>
              <option :value="MONO">{{ t('settings.system.requests.profiles.mono') }}</option>
              <option :value="STEREO">{{ t('settings.system.requests.profiles.stereo') }}</option>
            </select>
          </label>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            {{ t('settings.system.requests.profiles.minSeeders') }}
            <input
              :value="tier.conditions.minSeeders ?? ''"
              type="number"
              min="0"
              class="w-16 rounded-md border border-input bg-background px-1.5 py-1 text-xs tabular-nums text-foreground"
              @change="handleNumber(index, 'minSeeders', $event)"
            />
          </label>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            {{ t('settings.system.requests.profiles.maxSize') }}
            <input
              :value="sizeInMegabytes(tier.conditions.maxSizeBytes)"
              type="number"
              min="0"
              class="w-20 rounded-md border border-input bg-background px-1.5 py-1 text-xs tabular-nums text-foreground"
              @change="handleMaxSize(index, $event)"
            />
          </label>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              class="accent-primary"
              :checked="tier.conditions.freeleechOnly === true"
              @change="handleFreeleech(index, $event)"
            />
            {{ t('bookRequests.releases.freeleech') }}
          </label>

          <label class="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              class="accent-primary"
              :checked="tier.conditions.excludeVipOnly === true"
              @change="handleExcludeVip(index, $event)"
            />
            {{ t('bookRequests.releases.hideVipOnly') }}
          </label>

          <div class="flex min-w-48 flex-1 basis-56 flex-col items-stretch gap-1">
            <label :for="`${tier.id}-languages`" class="text-xs text-muted-foreground">
              {{ t('settings.system.requests.profiles.languages') }}
            </label>
            <TokenSelect
              :input-id="`${tier.id}-languages`"
              :options="languageOptions"
              :model-value="tier.conditions.languages ?? []"
              :placeholder="t('settings.system.requests.profiles.multiSelectAny')"
              :described-by="multiSelectHintId"
              @update:model-value="handleLanguages(index, $event)"
            />
          </div>

          <div class="flex min-w-48 flex-1 basis-56 flex-col items-stretch gap-1">
            <label :for="`${tier.id}-indexers`" class="text-xs text-muted-foreground">
              {{ t('settings.system.requests.profiles.indexers') }}
            </label>
            <TokenSelect
              :input-id="`${tier.id}-indexers`"
              :options="indexerOptions"
              :model-value="tier.conditions.indexerIds?.map(String) ?? []"
              :placeholder="t('settings.system.requests.profiles.multiSelectAny')"
              :described-by="multiSelectHintId"
              :disabled="indexers.length === 0"
              @update:model-value="handleIndexers(index, $event)"
            />
          </div>
        </div>
      </li>
    </ol>

    <p :id="multiSelectHintId" class="sr-only">{{ t('settings.system.requests.profiles.multiSelectHint') }}</p>

    <p v-if="warnsAboutBitrate" class="settings-hint settings-prose mt-2">
      {{ t('settings.system.requests.profiles.bitrateNote') }}
    </p>

    <Button variant="outline" size="sm" class="mt-2.5" :disabled="!canAdd" @click="addTier">
      <Plus :size="14" aria-hidden="true" />
      {{ t('settings.system.requests.profiles.addTier') }}
    </Button>
  </div>
</template>
