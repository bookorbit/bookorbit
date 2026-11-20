<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Copy, Ellipsis, Group, Trash2 } from '@lucide/vue'
import type { AcceptableValue } from 'reka-ui'
import type { Rule, RuleField, RuleOperator } from '@bookorbit/types'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { filterValueLabel, operatorLabel, ruleToTokenParts } from '@/features/book/lib/filter-labels'
import { isRuleComplete } from '@/features/book/lib/filter-fields'
import { providerShortLabel } from '@/lib/provider-colors'
import FieldPickerPopover from './FieldPickerPopover.vue'
import FilterRuleEditor from './FilterRuleEditor.vue'
import { FILTER_BUILDER_KEY, type DraftGroup, type DraftRule } from './filter-builder'
import { ghostButton, iconButton } from './filter-styles'

/** One rule of the builder as a line: field, operator and its values as chips that open the value panel. */
const props = defineProps<{
  node: DraftRule
  parent: DraftGroup
  index: number
  /** How deep the group holding this rule sits; the root is 0. */
  depth: number
}>()

const VISIBLE_CHIPS = 4

const { t } = useI18n()
const context = inject(FILTER_BUILDER_KEY)!
const { fields } = context

const rule = computed(() => props.node.rule)
const kind = computed(() => fields.kindOf(rule.value.field))
const label = computed(() => fields.labelOf(rule.value.field))
const operators = computed(() => fields.operatorsOf(rule.value.field))
const presence = computed(() => rule.value.operator === 'isEmpty' || rule.value.operator === 'isNotEmpty')
const hasValue = computed(() => kind.value !== 'choice' && !presence.value)
const complete = computed(() => isRuleComplete(rule.value))
const canWrap = computed(() => props.depth < context.maxDepth.value)

const listChips = computed(() =>
  Array.isArray(rule.value.value) ? rule.value.value.map((value) => filterValueLabel(rule.value.field, String(value))) : null,
)
const hiddenChips = computed(() => Math.max(0, (listChips.value?.length ?? 0) - VISIBLE_CHIPS))
const scalarChip = computed(() => {
  if (kind.value === 'rating' && typeof rule.value.value === 'number') return t('book.filter.stars', { count: rule.value.value })
  return ruleToTokenParts(rule.value).value
})
const providerChip = computed(() => {
  const current = rule.value
  if (current.field !== 'communityRating' && current.field !== 'communityRatingCount') return null
  if (!current.provider || current.provider === 'any') return null
  return providerShortLabel(current.provider)
})
const emptyText = computed(() => (kind.value === 'list' ? t('book.filter.builder.chooseValues') : t('book.filter.builder.setValue')))

const fieldOpen = computed(() => context.openFieldFor.value === `field:${props.node.id}`)
const valueOpen = computed(() => context.openValueFor.value === props.node.id)

function handleFieldOpen(open: boolean) {
  context.openFieldFor.value = open ? `field:${props.node.id}` : null
}

function handleField(field: RuleField) {
  if (field === rule.value.field) return
  const next = fields.newRule(field)
  context.replaceRule(props.node, next)
  if (fields.kindOf(field) !== 'choice') openValueSoon()
}

function openValueSoon() {
  // The field picker is still closing; opening in the same tick would count as an outside click on it.
  setTimeout(() => {
    context.openValueFor.value = props.node.id
  }, 0)
}

function handleOperator(value: AcceptableValue) {
  if (typeof value !== 'string') return
  const next = fields.changeOperator(rule.value, value as RuleOperator)
  context.replaceRule(props.node, next)
  if (!isRuleComplete(next) && fields.kindOf(next.field) !== 'choice' && next.operator !== 'isEmpty' && next.operator !== 'isNotEmpty')
    openValueSoon()
}

function handleValueOpen(open: boolean) {
  context.openValueFor.value = open ? props.node.id : null
}

function handleRule(next: Rule) {
  context.replaceRule(props.node, next)
}

function handleDone() {
  context.openValueFor.value = null
}

function handleDuplicate() {
  context.duplicate(props.parent, props.index)
}

function handleWrap() {
  context.wrapInGroup(props.parent, props.index)
}

function handleRemove() {
  context.openValueFor.value = null
  context.remove(props.parent, props.index)
}
</script>

<template>
  <div
    class="group/rule flex min-h-[42px] items-center gap-0.5 border-b border-border/70 py-1 ps-1 pe-0.5 last:border-b-0 max-sm:flex-wrap max-sm:py-2"
    data-testid="filter-builder-rule"
  >
    <FieldPickerPopover
      :open="fieldOpen"
      :groups="fields.groups.value"
      :selected="rule.field"
      :title="t('book.filter.builder.changeField')"
      :placeholder="t('book.filter.filterBy')"
      :search-label="t('book.filter.findFieldAria')"
      :list-label="t('book.filter.fieldList')"
      @update:open="handleFieldOpen"
      @pick="handleField"
    >
      <template #trigger>
        <button
          type="button"
          :class="ghostButton"
          class="min-w-[136px] justify-start font-semibold max-sm:min-w-0"
          aria-haspopup="dialog"
          :aria-label="`${t('book.filter.builder.changeField')}: ${label}`"
        >
          <component :is="fields.iconOf(rule.field)" :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
          <span class="truncate">{{ label }}</span>
          <ChevronDown :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </template>
    </FieldPickerPopover>

    <DropdownMenu v-if="operators.length > 1">
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          :class="ghostButton"
          class="min-w-0 text-muted-foreground hover:text-foreground"
          :aria-label="`${t('book.filter.builder.changeOperator')}: ${operatorLabel(rule.operator)}`"
        >
          {{ operatorLabel(rule.operator) }}
          <ChevronDown :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-52">
        <DropdownMenuRadioGroup :model-value="rule.operator" @update:model-value="handleOperator">
          <DropdownMenuRadioItem v-for="operator in operators" :key="operator" :value="operator">
            <span class="inline-block first-letter:uppercase">{{ operatorLabel(operator) }}</span>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    <span v-else :class="ghostButton" class="cursor-default text-muted-foreground hover:bg-transparent">{{ operatorLabel(rule.operator) }}</span>

    <Popover v-if="hasValue" :open="valueOpen" @update:open="handleValueOpen">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="flex min-h-[30px] min-w-0 flex-1 flex-wrap items-center gap-1 rounded-[calc(var(--radius)-4px)] border border-transparent px-1 py-[3px] text-start transition-colors hover:border-border hover:bg-background focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none max-sm:order-3 max-sm:basis-full"
          :aria-label="complete ? `${t('book.filter.builder.editValue')}: ${label}` : `${emptyText}: ${label}`"
          data-testid="filter-builder-value"
        >
          <span v-if="!complete" class="px-1 text-[12.5px] text-muted-foreground">{{ emptyText }}</span>
          <template v-else-if="listChips">
            <span
              v-for="chip in listChips.slice(0, VISIBLE_CHIPS)"
              :key="chip"
              class="inline-flex h-[22px] max-w-[18ch] items-center truncate rounded-[5px] bg-primary/13 px-[7px] text-xs font-semibold whitespace-nowrap text-primary"
            >
              {{ chip }}
            </span>
            <span
              v-if="hiddenChips > 0"
              class="inline-flex h-[22px] items-center rounded-[5px] bg-surface-3 px-[7px] text-xs font-semibold text-foreground"
            >
              +{{ hiddenChips }}
            </span>
          </template>
          <template v-else>
            <span
              v-if="providerChip"
              class="inline-flex h-[22px] items-center rounded-[5px] bg-surface-3 px-[7px] text-xs font-semibold text-foreground"
            >
              {{ providerChip }}
            </span>
            <span class="inline-flex h-[22px] items-center rounded-[5px] bg-primary/13 px-[7px] text-xs font-semibold whitespace-nowrap text-primary">
              {{ scalarChip }}
            </span>
          </template>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        :side-offset="4"
        :collision-padding="8"
        :aria-label="label"
        class="flex max-h-(--reka-popover-content-available-height) w-auto max-w-[calc(100vw-16px)] flex-col overflow-hidden p-0"
      >
        <FilterRuleEditor
          :rule="rule"
          removable
          :match-count="context.matchCount.value"
          :counts="context.counts.value?.[rule.field]"
          @update:rule="handleRule"
          @remove="handleRemove"
          @done="handleDone"
        />
      </PopoverContent>
    </Popover>
    <span v-else class="flex-1" />

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <button
          type="button"
          :class="iconButton"
          class="opacity-0 transition-opacity group-hover/rule:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 max-sm:opacity-100"
          :aria-label="t('book.filter.builder.moreForFilter')"
        >
          <Ellipsis :size="14" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" class="w-48">
        <DropdownMenuItem @select="handleDuplicate">
          <Copy :size="14" aria-hidden="true" />
          {{ t('book.filter.builder.duplicate') }}
        </DropdownMenuItem>
        <DropdownMenuItem v-if="canWrap" @select="handleWrap">
          <Group :size="14" aria-hidden="true" />
          {{ t('book.filter.builder.wrapInGroup') }}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" @select="handleRemove">
          <Trash2 :size="14" aria-hidden="true" />
          {{ t('book.filter.builder.remove') }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
