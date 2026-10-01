<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, ChevronUp, Layers, Lock } from '@lucide/vue'
import type { MetadataCandidate, MetadataProviderInfo } from '@bookorbit/types'
import type { DiffField, FieldDecision, OtherValue } from '../../composables/useMetadataDiff'
import { isActionable, type DiffFieldKey } from '../../lib/metadata-diff-fields'
import { getProviderLabel, providerBadgeStyle } from '../../lib/metadata-fetch'
import MetadataMatchValue from './MetadataMatchValue.vue'

const props = defineProps<{
  field: DiffField
  candidate: MetadataCandidate
  providers: MetadataProviderInfo[]
  decision: FieldDecision
  index: number
}>()

const emit = defineEmits<{
  decide: [key: DiffFieldKey, decision: FieldDecision, from?: MetadataCandidate]
}>()

const { t } = useI18n()
const othersOpen = ref(false)
const expandedEntries = ref(new Set<string>())
/** Only a description is long enough to need folding. */
const LONG_ENTRY_CHARACTERS = 240
watch(
  () => props.field.key,
  () => {
    othersOpen.value = false
    expandedEntries.value = new Set()
  },
)

const label = computed(() => t(props.field.labelKey, props.field.labelParams ?? {}))
const actionable = computed(() => isActionable(props.field.kind))
const otherCandidate = computed(() => (props.field.isPicked && !props.field.pickedFromActive ? props.field.pickedCandidate : null))
const showControl = computed(() => actionable.value || otherCandidate.value !== null)
const kindLabel = computed(() => {
  if (props.field.kind === 'minor' && props.field.minorReason) return t(`book.detail.editMetadata.match.minor.${props.field.minorReason}`)
  return t(`book.detail.editMetadata.match.kind.${props.field.kind === 'minor' ? 'change' : props.field.kind}`)
})
const kindClass = computed(() => {
  if (props.field.kind === 'fill') return 'bg-success/15 text-success'
  if (props.field.kind === 'change') return 'bg-warning/15 text-warning'
  return 'bg-muted text-muted-foreground'
})
const options = computed<{ value: FieldDecision; label: string }[]>(() => {
  const keep = { value: 'keep' as const, label: t('book.detail.editMetadata.match.decision.keep') }
  if (props.field.mergeable) {
    return [
      keep,
      { value: 'merge', label: t('book.detail.editMetadata.match.decision.merge') },
      { value: 'replace', label: t('book.detail.editMetadata.match.decision.replace') },
    ]
  }
  return [keep, { value: 'use', label: t('book.detail.editMetadata.match.decision.use') }]
})
/** The option shown as chosen: a value staged from another result still reads as not kept. */
const shown = computed<FieldDecision>(() => {
  if (props.decision !== 'keep' || !otherCandidate.value) return props.decision
  return props.field.mergeable ? 'merge' : 'use'
})
const using = computed(() => shown.value !== 'keep' && props.field.pickedFromActive)
const currentReplaced = computed(() => using.value && (shown.value === 'use' || shown.value === 'replace') && props.field.kind !== 'fill')
const activeLabel = computed(() => getProviderLabel(props.candidate.provider, props.providers))

function providerLabel(candidate: MetadataCandidate): string {
  return getProviderLabel(candidate.provider, props.providers)
}

function uniqueProviders(entry: OtherValue): MetadataCandidate[] {
  const seen = new Set<string>()
  return entry.candidates.filter((candidate) => (seen.has(candidate.provider) ? false : (seen.add(candidate.provider), true)))
}

function choose(value: FieldDecision) {
  if (props.field.isLocked) return
  emit('decide', props.field.key, value)
}

function handleOptionKeydown(event: KeyboardEvent) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  if (!step) return
  event.preventDefault()
  event.stopPropagation()
  const enabled = options.value.filter((option) => option.value === 'keep' || actionable.value)
  const index = enabled.findIndex((option) => option.value === shown.value)
  const next = enabled[(index + step + enabled.length) % enabled.length]
  if (!next) return
  choose(next.value)
  const group = (event.currentTarget as HTMLElement).closest('[role="radiogroup"]')
  requestAnimationFrame(() => group?.querySelector<HTMLElement>(`[data-option="${next.value}"]`)?.focus())
}

function useOther(entry: OtherValue) {
  const from = entry.candidates[0]
  if (!from || props.field.isLocked) return
  emit('decide', props.field.key, props.field.mergeable ? (props.decision === 'replace' ? 'replace' : 'merge') : 'use', from)
}

function switchToActive() {
  emit('decide', props.field.key, props.field.mergeable ? 'merge' : 'use', props.candidate)
}

function isLongEntry(entry: OtherValue): boolean {
  return !entry.list && entry.display.length > LONG_ENTRY_CHARACTERS
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

function toggleEntry(entry: OtherValue) {
  const next = new Set(expandedEntries.value)
  if (next.has(entry.display)) next.delete(entry.display)
  else next.add(entry.display)
  expandedEntries.value = next
}

function toggleOthers() {
  othersOpen.value = !othersOpen.value
}
</script>

<template>
  <div
    class="relative grid grid-cols-1 gap-x-3 gap-y-2 border-b border-border/60 py-3 outline-none @2xl/compare:grid-cols-2 focus-visible:before:pointer-events-none focus-visible:before:absolute focus-visible:before:-inset-x-2.5 focus-visible:before:inset-y-0.5 focus-visible:before:rounded-[10px] focus-visible:before:ring-[1.5px] focus-visible:before:ring-primary/60"
    tabindex="-1"
    :data-field-row="index"
    :data-field-key="field.key"
  >
    <div class="flex flex-wrap items-start gap-x-3 gap-y-1.5 @2xl/compare:col-span-2">
      <div class="flex min-h-[30px] flex-wrap items-center gap-x-2 gap-y-1">
        <span class="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{ label }}</span>
        <span
          v-if="field.isLocked"
          class="inline-flex h-[18px] items-center gap-1 rounded-md bg-primary/15 px-1.5 text-[10.5px] font-semibold text-primary"
        >
          <Lock class="size-2.5" aria-hidden="true" />{{ t('book.detail.editMetadata.diff.locked') }}
        </span>
        <span v-else class="inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-semibold" :class="kindClass">{{ kindLabel }}</span>
      </div>
      <div class="ms-auto grid justify-items-end gap-1.5">
        <template v-if="showControl">
          <div
            class="flex min-w-[8.5rem] flex-wrap justify-end gap-0.5 rounded-lg border border-border/60 bg-muted p-0.5"
            role="radiogroup"
            :aria-label="label"
            :aria-disabled="field.isLocked || undefined"
          >
            <button
              v-for="option in options"
              :key="option.value"
              type="button"
              role="radio"
              :data-option="option.value"
              :aria-checked="shown === option.value"
              :tabindex="shown === option.value ? 0 : -1"
              :disabled="field.isLocked || (option.value !== 'keep' && !actionable && !otherCandidate)"
              class="inline-flex min-h-[26px] flex-auto items-center justify-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap text-foreground transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary disabled:cursor-not-allowed disabled:text-muted-foreground"
              :class="
                shown === option.value
                  ? option.value === 'keep'
                    ? 'bg-background shadow-xs ring-1 ring-border'
                    : 'bg-primary text-primary-foreground'
                  : 'hover:enabled:bg-background/60'
              "
              @click="choose(option.value)"
              @keydown="handleOptionKeydown"
            >
              <Lock v-if="field.isLocked && option.value === 'keep'" class="size-3" aria-hidden="true" />
              <span>{{ option.label }}</span>
            </button>
          </div>
          <p v-if="otherCandidate" class="grid justify-items-end gap-1 text-end text-[11px] leading-snug text-muted-foreground">
            <span class="flex flex-wrap items-center justify-end gap-1">
              {{ t('book.detail.editMetadata.match.decision.usingFrom') }}
              <span
                class="inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold"
                :style="providerBadgeStyle(otherCandidate.provider)"
                >{{ providerLabel(otherCandidate) }}</span
              >
            </span>
            <button
              v-if="actionable && !field.isLocked"
              type="button"
              class="-mx-1 rounded-md px-1 py-0.5 text-[11.5px] font-medium text-foreground hover:bg-muted"
              @click="switchToActive"
            >
              {{ t('book.detail.editMetadata.match.decision.switchTo', { provider: activeLabel }) }}
            </button>
          </p>
          <p v-else-if="field.isLocked" class="max-w-[16rem] text-end text-[11px] leading-snug text-muted-foreground">
            {{ t('book.detail.editMetadata.match.decision.lockedHint') }}
          </p>
        </template>
        <p v-else class="py-1.5 text-end text-[11.5px] text-muted-foreground">
          {{
            field.kind === 'same'
              ? t('book.detail.editMetadata.match.decision.alreadyMatches')
              : t('book.detail.editMetadata.match.decision.nothingToApply')
          }}
        </p>
      </div>
    </div>

    <div
      class="min-w-0 rounded-lg border px-2.5 py-[7px] text-[13px] leading-normal"
      :class="currentReplaced ? 'border-border text-muted-foreground' : 'border-border'"
    >
      <span class="mb-0.5 block text-[9.5px] font-bold tracking-[0.1em] text-muted-foreground uppercase @2xl/compare:hidden">{{
        t('book.detail.editMetadata.diffPanel.current')
      }}</span>
      <MetadataMatchValue :field="field" side="current" :decision="shown" />
    </div>

    <div
      class="min-w-0 rounded-lg border px-2.5 py-[7px] text-[13px] leading-normal"
      :class="using ? 'border-primary/50 bg-primary/10' : 'border-transparent bg-muted/55'"
    >
      <span class="mb-0.5 block text-[9.5px] font-bold tracking-[0.1em] text-muted-foreground uppercase @2xl/compare:hidden">{{ activeLabel }}</span>
      <MetadataMatchValue :field="field" side="incoming" :decision="shown" />
      <div v-if="field.otherValues.length" class="mt-1.5">
        <button
          type="button"
          class="-mx-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] font-medium text-foreground hover:bg-muted"
          :aria-expanded="othersOpen"
          @click="toggleOthers"
        >
          <Layers class="size-3" aria-hidden="true" />
          {{ t('book.detail.editMetadata.match.value.otherValues', { count: field.otherValues.length }) }}
          <ChevronUp v-if="othersOpen" class="size-3" aria-hidden="true" />
          <ChevronDown v-else class="size-3" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div v-if="othersOpen && field.otherValues.length" class="overflow-hidden rounded-[10px] border border-border bg-card @2xl/compare:col-span-2">
      <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 px-2.5 py-[7px]">
        <span class="text-[10.5px] font-bold tracking-[0.12em] text-muted-foreground uppercase">{{
          t('book.detail.editMetadata.match.value.otherValuesHeading', { field: label })
        }}</span>
        <span class="text-[11px] text-muted-foreground">{{ t('book.detail.editMetadata.match.value.otherValuesHint') }}</span>
      </div>
      <div
        v-for="entry in field.otherValues"
        :key="entry.display"
        class="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 border-b border-border/60 px-2.5 py-[7px] text-[12.5px] last:border-b-0 @2xl/compare:grid-cols-[9.5rem_minmax(0,1fr)_auto]"
      >
        <span class="col-span-2 flex flex-wrap gap-1 @2xl/compare:col-span-1">
          <span
            v-for="source in uniqueProviders(entry)"
            :key="source.provider"
            class="inline-flex h-[18px] items-center rounded-md px-1.5 text-[10.5px] font-bold"
            :style="providerBadgeStyle(source.provider)"
            >{{ providerLabel(source) }}</span
          >
          <span
            v-if="entry.matchesCurrent"
            class="inline-flex h-[18px] items-center rounded-md bg-muted px-1.5 text-[10.5px] font-semibold text-muted-foreground"
            >{{ t('book.detail.editMetadata.match.value.sameAsCurrent') }}</span
          >
        </span>
        <span class="min-w-0">
          <span
            class="block [overflow-wrap:anywhere]"
            :class="isLongEntry(entry) && !expandedEntries.has(entry.display) ? 'line-clamp-4' : 'whitespace-pre-line'"
            >{{ entry.list ? entry.list.join(', ') : entry.display }}</span
          >
          <button
            v-if="isLongEntry(entry)"
            type="button"
            class="-mx-1 mt-0.5 inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-[11.5px] font-medium text-foreground hover:bg-muted"
            :aria-expanded="expandedEntries.has(entry.display)"
            @click="toggleEntry(entry)"
          >
            {{
              expandedEntries.has(entry.display)
                ? t('book.detail.editMetadata.diff.showLess')
                : t('book.detail.editMetadata.match.value.showAll', { count: wordCount(entry.display) })
            }}
          </button>
        </span>
        <button
          type="button"
          class="inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11.5px] font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:text-muted-foreground"
          :class="entry.isPicked ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-background hover:enabled:bg-muted'"
          :disabled="field.isLocked || entry.matchesCurrent"
          @click="useOther(entry)"
        >
          <Check v-if="entry.isPicked" class="size-3" aria-hidden="true" />
          {{ entry.isPicked ? t('book.detail.editMetadata.match.value.using') : t('book.detail.editMetadata.match.value.useThis') }}
        </button>
      </div>
    </div>
  </div>
</template>
