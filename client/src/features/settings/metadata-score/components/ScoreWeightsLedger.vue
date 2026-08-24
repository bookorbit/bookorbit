<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { EyeOff, SearchX } from '@lucide/vue'
import { isMetadataScoreFieldScoring, type MetadataScoreField, type MetadataScoreWeights } from '@bookorbit/types'
import { Button } from '@/components/ui/button'
import ScoreWeightRow from './ScoreWeightRow.vue'
import { fieldShare, rankedScoreFields, scoreFieldLabelKey } from '../lib/score-weights'

const { t } = useI18n()

const props = defineProps<{
  weights: MetadataScoreWeights
  saved: MetadataScoreWeights
  query: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  adjust: [field: MetadataScoreField, delta: number]
  set: [field: MetadataScoreField, value: number]
  reset: [field: MetadataScoreField]
  clearQuery: []
}>()

const matching = computed(() => {
  const needle = props.query.trim().toLowerCase()
  const ranked = rankedScoreFields(props.weights)
  if (!needle) return ranked
  return ranked.filter((field) => t(scoreFieldLabelKey(field)).toLowerCase().includes(needle))
})

const scoringFields = computed(() => matching.value.filter((field) => isMetadataScoreFieldScoring(props.weights[field])))
const offFields = computed(() => matching.value.filter((field) => !isMetadataScoreFieldScoring(props.weights[field])))

/** One scale for every bar on the page, so bar length is comparable across both columns. */
const maxShare = computed(() => scoringFields.value.reduce((max, field) => Math.max(max, fieldShare(props.weights, field)), 0))

/**
 * Column-major flow: reading down the first column and on into the second preserves the ranking.
 * Row-major would put ranks 1 and 2 side by side and destroy the order the list exists for.
 */
const columnRows = computed(() => Math.ceil(scoringFields.value.length / 2))

const isEmpty = computed(() => matching.value.length === 0)

function onAdjust(field: MetadataScoreField, delta: number) {
  emit('adjust', field, delta)
}

function onSet(field: MetadataScoreField, value: number) {
  emit('set', field, value)
}

function onReset(field: MetadataScoreField) {
  emit('reset', field)
}

function clearQuery() {
  emit('clearQuery')
}
</script>

<template>
  <div>
    <div v-if="isEmpty" class="flex flex-col items-center gap-3 px-6 py-12 text-center">
      <SearchX :size="22" class="text-muted-foreground" aria-hidden="true" />
      <p class="text-sm text-muted-foreground">{{ t('settings.admin.scoreWeights.noMatches') }}</p>
      <Button variant="outline" size="sm" type="button" @click="clearQuery">
        {{ t('settings.admin.scoreWeights.clearSearch') }}
      </Button>
    </div>

    <template v-else>
      <!-- Header repeats per column at xl, where the list splits in two. Kept in step with ScoreWeightRow's grid. -->
      <div class="hidden border-b border-border bg-muted/25 md:grid md:grid-cols-1 xl:grid-cols-2 xl:gap-x-6" aria-hidden="true">
        <div
          v-for="column in 2"
          :key="column"
          class="grid grid-cols-[minmax(0,1fr)_92px_minmax(110px,150px)_44px] items-center gap-x-4 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:px-6"
          :class="column === 2 ? 'hidden xl:grid' : ''"
        >
          <span>{{ t('settings.admin.scoreWeights.table.field') }}</span>
          <span class="text-center">{{ t('settings.admin.scoreWeights.table.weight') }}</span>
          <span>{{ t('settings.admin.scoreWeights.table.share') }}</span>
          <span class="text-right">{{ t('settings.admin.scoreWeights.table.versusDefault') }}</span>
        </div>
      </div>

      <div
        class="grid grid-cols-1 xl:grid-flow-col xl:grid-cols-2 xl:gap-x-6 xl:[grid-template-rows:repeat(var(--ledger-rows),auto)]"
        :style="{ '--ledger-rows': columnRows }"
      >
        <ScoreWeightRow
          v-for="field in scoringFields"
          :key="field"
          :field="field"
          :weights="weights"
          :saved-weight="saved[field]"
          :max-share="maxShare"
          :disabled="disabled"
          class="md:px-6"
          @adjust="onAdjust"
          @set="onSet"
          @reset="onReset"
        />
      </div>

      <template v-if="offFields.length > 0">
        <h3
          class="flex items-center gap-2 border-y border-border bg-muted/25 px-4 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground md:px-6"
        >
          <EyeOff :size="11" aria-hidden="true" />
          {{ t('settings.admin.scoreWeights.notScoredHeading', { count: offFields.length }) }}
          <span class="ml-auto text-[10px] font-medium normal-case tracking-normal">
            {{ t('settings.admin.scoreWeights.notScoredHint') }}
          </span>
        </h3>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 xl:gap-x-6">
          <ScoreWeightRow
            v-for="field in offFields"
            :key="field"
            :field="field"
            :weights="weights"
            :saved-weight="saved[field]"
            :max-share="maxShare"
            :disabled="disabled"
            class="md:px-6"
            @adjust="onAdjust"
            @set="onSet"
            @reset="onReset"
          />
        </div>
      </template>
    </template>
  </div>
</template>
