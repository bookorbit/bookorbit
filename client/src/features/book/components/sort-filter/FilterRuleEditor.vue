<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronLeft, Star, Trash2 } from '@lucide/vue'
import type { AcceptableValue } from 'reka-ui'
import type { Rule, RuleOperator } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useFilterFields } from '@/features/book/composables/useFilterFields'
import { operatorLabel } from '@/features/book/lib/filter-labels'
import { LIST_OPERATORS, isRuleComplete } from '@/features/book/lib/filter-fields'
import { handleRadioGroupKeydown } from '@/lib/roving-index'
import FilterDateValue from './FilterDateValue.vue'
import FilterListValues from './FilterListValues.vue'
import FilterNumberValue from './FilterNumberValue.vue'
import { choiceRow, fieldInput, ghostButton, iconButton, primaryButton, radioMark, unitText } from './filter-styles'

/**
 * One filter's value panel: the field and a quiet operator menu on top, the field's own control in
 * the middle, and a live count with Done at the foot. Every change is handed up as it happens.
 */
const props = withDefaults(
  defineProps<{
    rule: Rule
    canGoBack?: boolean
    removable?: boolean
    /** Books the filter matches with this rule in it; null when the host cannot count. */
    matchCount?: number | null
    /** Book counts per value for a checklist field, where the host knows them. */
    counts?: Record<string, number>
  }>(),
  { canGoBack: false, removable: false, matchCount: null, counts: undefined },
)

const emit = defineEmits<{
  'update:rule': [rule: Rule]
  back: []
  remove: []
  done: []
}>()

const { t } = useI18n()
const { kindOf, iconOf, labelOf, operatorsOf, changeOperator } = useFilterFields()

const kind = computed(() => kindOf(props.rule.field))
const label = computed(() => labelOf(props.rule.field))
const operators = computed(() => operatorsOf(props.rule.field))
const showOperatorMenu = computed(() => kind.value !== 'choice' && operators.value.length > 1)
const presence = computed(() => props.rule.operator === 'isEmpty' || props.rule.operator === 'isNotEmpty')
const listOperator = computed(() => LIST_OPERATORS.includes(props.rule.operator))
const complete = computed(() => isRuleComplete(props.rule))
const ratingValue = computed(() => (typeof props.rule.value === 'number' ? props.rule.value : Number(props.rule.value) || 0))
const listValue = computed(() => (Array.isArray(props.rule.value) ? props.rule.value.map(String) : []))

const liveText = computed(() => {
  if (!complete.value) return t('book.filter.notAppliedYet')
  if (props.matchCount === null) return ''
  return t('book.filter.matchCount', { count: props.matchCount })
})

const ratingText = computed(() => {
  const count = ratingValue.value
  if (!count || presence.value) return ''
  switch (props.rule.operator) {
    case 'gte':
      return t('book.filter.ratingGte', { count })
    case 'lte':
      return t('book.filter.ratingLte', { count })
    case 'gt':
      return t('book.filter.ratingGt', { count })
    case 'lt':
      return t('book.filter.ratingLt', { count })
    default:
      return t('book.filter.ratingEq', { count })
  }
})

const valueArea = ref<HTMLElement | null>(null)

/** Most wanted first: a box to type into, the checklist, the checked choice, then any control. */
const FOCUS_ORDER = ['input:not([type="date"]):not([type="checkbox"])', '[role="listbox"]', '[role="radio"][aria-checked="true"]', 'button, input']

// The editor replaces whatever had focus (the field list's option, or nothing when a token opened
// it), so it hands focus to its value control; the popover then leaves focus where it is.
onMounted(() => {
  void nextTick(() => {
    const area = valueArea.value
    if (!area || area.contains(document.activeElement)) return
    for (const selector of FOCUS_ORDER) {
      const target = area.querySelector<HTMLElement>(selector)
      if (target) {
        target.focus({ preventScroll: true })
        return
      }
    }
  })
})

function update(rule: Rule) {
  emit('update:rule', rule)
}

function handleOperator(value: AcceptableValue) {
  if (typeof value !== 'string') return
  update(changeOperator(props.rule, value as RuleOperator))
}

function pickOperator(operator: RuleOperator) {
  update(changeOperator(props.rule, operator))
}

function handleList(values: string[]) {
  update({ ...props.rule, value: values } as Rule)
}

function handleText(event: Event) {
  const raw = (event.target as HTMLInputElement).value
  update({ ...props.rule, value: raw === '' ? undefined : raw } as Rule)
}

function pickStars(count: number) {
  const operator = presence.value ? 'gte' : props.rule.operator
  update({ ...props.rule, operator, value: count } as Rule)
}

function handleBack() {
  emit('back')
}

function handleRemove() {
  emit('remove')
}

function handleDone() {
  emit('done')
}
</script>

<template>
  <div class="flex min-h-0 w-[330px] max-w-full flex-col max-sm:w-full" data-testid="filter-rule-editor">
    <div class="flex shrink-0 items-center gap-1 border-b border-border px-2 pt-2 pb-1.5">
      <button v-if="canGoBack" type="button" :class="iconButton" :aria-label="t('book.filter.backToFields')" @click="handleBack">
        <ChevronLeft :size="16" aria-hidden="true" />
      </button>
      <span class="inline-flex min-w-0 items-center gap-[7px] ps-0.5 text-[13px] font-semibold whitespace-nowrap text-foreground">
        <component :is="iconOf(rule.field)" :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="truncate">{{ label }}</span>
      </span>
      <DropdownMenu v-if="showOperatorMenu">
        <DropdownMenuTrigger as-child>
          <button type="button" :class="ghostButton" :aria-label="`${t('book.filter.builder.changeOperator')}: ${operatorLabel(rule.operator)}`">
            {{ operatorLabel(rule.operator) }}
            <ChevronDown :size="13" class="text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-52">
          <DropdownMenuRadioGroup :model-value="rule.operator" @update:model-value="handleOperator">
            <DropdownMenuRadioItem v-for="operator in operators" :key="operator" :value="operator">
              {{ operatorLabel(operator) }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span class="flex-1" />
      <button
        v-if="removable"
        type="button"
        :class="iconButton"
        :aria-label="t('book.filter.removeThisFilter')"
        :title="t('book.filter.removeThisFilter')"
        @click="handleRemove"
      >
        <Trash2 :size="14" aria-hidden="true" />
      </button>
    </div>

    <div ref="valueArea" class="grid min-h-0 gap-2 overflow-y-auto overscroll-contain p-2">
      <div v-if="kind === 'choice'" role="radiogroup" :aria-label="label" @keydown="handleRadioGroupKeydown">
        <button
          v-for="operator in operators"
          :key="operator"
          type="button"
          role="radio"
          :aria-checked="rule.operator === operator"
          :class="choiceRow"
          @click="pickOperator(operator)"
        >
          <span :class="radioMark" aria-hidden="true" />
          <span class="inline-block min-w-0 flex-1 truncate first-letter:uppercase">{{ operatorLabel(operator) }}</span>
        </button>
      </div>
      <p v-else-if="presence" class="px-0.5 pt-0.5 text-xs text-muted-foreground">
        {{ t(`book.filter.emptyNote.${rule.operator}`, { field: label }) }}
      </p>
      <FilterListValues
        v-else-if="kind === 'list' && listOperator"
        :field="rule.field"
        :model-value="listValue"
        :counts="counts"
        @update:model-value="handleList"
      />
      <div v-else-if="kind === 'rating'" class="flex items-center gap-2.5">
        <div class="inline-flex gap-0.5" role="radiogroup" :aria-label="label" @keydown="handleRadioGroupKeydown">
          <button
            v-for="count in 5"
            :key="count"
            type="button"
            role="radio"
            :aria-checked="count === ratingValue"
            :aria-label="t('book.filter.stars', { count })"
            class="grid size-[30px] place-items-center rounded-md transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
            :class="count <= ratingValue ? 'text-primary' : 'text-muted-foreground'"
            @click="pickStars(count)"
          >
            <Star :size="19" :class="count <= ratingValue ? 'fill-current' : ''" aria-hidden="true" />
          </button>
        </div>
        <span :class="unitText">{{ ratingText }}</span>
      </div>
      <FilterDateValue v-else-if="kind === 'date'" :rule="rule" @update:rule="update" />
      <FilterNumberValue v-else-if="kind === 'number'" :rule="rule" @update:rule="update" />
      <input
        v-else
        :value="typeof rule.value === 'string' || typeof rule.value === 'number' ? rule.value : ''"
        type="text"
        :placeholder="t('book.filter.typeValue')"
        :aria-label="t('book.filter.valueLabel', { field: label })"
        :class="fieldInput"
        class="w-full"
        @input="handleText"
      />
    </div>

    <div class="flex shrink-0 items-center gap-2 border-t border-border p-2">
      <span class="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">{{ liveText }}</span>
      <span class="flex-1" />
      <button type="button" :class="primaryButton" @click="handleDone">{{ t('book.filter.done') }}</button>
    </div>
  </div>
</template>
