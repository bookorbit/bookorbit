<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { EyeOff, RotateCcw } from '@lucide/vue'
import type { MetadataScoreField, MetadataScoreWeights } from '@bookorbit/types'
import { formatPercent } from '@/i18n/formatters'
import ScoreWeightStepper from './ScoreWeightStepper.vue'
import { fieldShare, scoreFieldLabelKey, scoreFieldRuleKey } from '../lib/score-weights'

const { t } = useI18n()

const props = defineProps<{
  field: MetadataScoreField
  weights: MetadataScoreWeights
  savedWeight: number
  /** Largest share on the page, so every bar is drawn against the same scale. */
  maxShare: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  adjust: [field: MetadataScoreField, delta: number]
  set: [field: MetadataScoreField, value: number]
  reset: [field: MetadataScoreField]
}>()

const weight = computed(() => props.weights[props.field])
const scoring = computed(() => weight.value > 0)
const share = computed(() => fieldShare(props.weights, props.field))
const changed = computed(() => weight.value !== props.savedWeight)
const delta = computed(() => weight.value - props.savedWeight)
const label = computed(() => t(scoreFieldLabelKey(props.field)))
const rule = computed(() => t(scoreFieldRuleKey(props.field)))
const labelId = computed(() => `score-field-${props.field}`)
const barWidth = computed(() => (props.maxShare <= 0 ? 0 : Math.max(2, (share.value / props.maxShare) * 100)))
// Always one decimal: rounding 12.8% to 13% collapses the gap between Title and Description,
// which is the comparison this column exists to make.
const sharePercent = computed(() => formatPercent(share.value / 100, 1))

function onAdjust(value: number) {
  emit('adjust', props.field, value)
}

function onSet(value: number) {
  emit('set', props.field, value)
}

function onReset() {
  emit('reset', props.field)
}
</script>

<template>
  <div
    class="grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-2 border-t border-border/60 px-4 py-2.5 first:border-t-0 md:grid-cols-[minmax(0,1fr)_92px_minmax(110px,150px)_44px] md:items-center md:gap-x-4 md:py-1.5"
    :class="scoring ? '' : 'bg-muted/20'"
  >
    <div class="min-w-0">
      <p :id="labelId" class="truncate text-[13px] font-semibold" :class="scoring ? 'text-foreground' : 'text-muted-foreground'">
        {{ label }}
      </p>
      <p class="mt-0.5 truncate text-xs text-muted-foreground">{{ rule }}</p>
    </div>

    <div class="flex items-center justify-end">
      <ScoreWeightStepper
        :weight="weight"
        :label="label"
        :labelled-by="labelId"
        :changed="changed"
        :disabled="disabled"
        @adjust="onAdjust"
        @change="onSet"
      />
    </div>

    <!-- Share is the number that means something; the raw weight above only has meaning against the total.
         On mobile it takes a full row of its own, since the stepper already fills the line above. -->
    <div class="col-span-2 flex items-center gap-2.5 md:col-span-1 md:col-start-3">
      <template v-if="scoring">
        <div class="h-1.5 min-w-10 flex-1 overflow-hidden rounded-full bg-foreground/10">
          <div class="h-full rounded-full bg-primary/70" :style="{ width: `${barWidth}%` }" />
        </div>
        <span class="w-11 shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">{{ sharePercent }}</span>
      </template>
      <span
        v-else
        class="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
      >
        <EyeOff :size="10" aria-hidden="true" />
        {{ t('settings.admin.scoreWeights.notScored') }}
      </span>
      <button
        v-if="changed"
        type="button"
        class="inline-flex shrink-0 items-center gap-1 rounded px-1 text-xs font-semibold tabular-nums text-primary transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary md:hidden"
        :aria-label="t('settings.admin.scoreWeights.revertField', { field: label })"
        @click="onReset"
      >
        <RotateCcw :size="11" aria-hidden="true" />
        {{ delta > 0 ? `+${delta}` : delta }}
      </button>
    </div>

    <div class="hidden items-center justify-end md:flex">
      <button
        v-if="changed"
        type="button"
        class="inline-flex items-center gap-1 rounded px-1 text-xs font-semibold tabular-nums text-primary transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
        :aria-label="t('settings.admin.scoreWeights.revertField', { field: label })"
        @click="onReset"
      >
        <RotateCcw :size="11" aria-hidden="true" />
        {{ delta > 0 ? `+${delta}` : delta }}
      </button>
      <span v-else class="text-xs text-muted-foreground" aria-hidden="true">-</span>
    </div>
  </div>
</template>
