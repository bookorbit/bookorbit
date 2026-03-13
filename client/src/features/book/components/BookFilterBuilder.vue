<script setup lang="ts">
import { ref, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { FIELD_OPERATORS, RULE_FIELDS, type GroupRule, type Rule, type RuleField, type RuleOperator } from '@projectx/types'
import { FIELD_LABELS, OPERATOR_LABELS } from '@/features/book/lib/filter-labels'
import FilterChipTypeahead from './FilterChipTypeahead.vue'
import FilterFormatPicker from './FilterFormatPicker.vue'
import FilterTextTypeahead from './FilterTextTypeahead.vue'

const props = defineProps<{
  modelValue: GroupRule | undefined
  depth?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: GroupRule | undefined]
}>()

const MAX_DEPTH = 5
const NUMERIC_FIELDS: RuleField[] = ['seriesIndex', 'publishedYear', 'pageCount', 'rating', 'metadataScore']
const DATE_FIELDS: RuleField[] = ['addedAt']
const NO_VALUE_OPERATORS: RuleOperator[] = ['isEmpty', 'isNotEmpty', 'isMissing', 'isPresent', 'isUnread', 'isInProgress', 'isFinished']
const BETWEEN_OPERATORS: RuleOperator[] = ['between']
const COLLECTION_OPERATORS: RuleOperator[] = ['includesAny', 'includesAll', 'excludesAll']

const SCORE_PRESETS = [
  { label: 'Outstanding', gte: 90 },
  { label: 'Good', gte: 70 },
  { label: 'Fair', gte: 50 },
  { label: 'Poor', lt: 50 },
] as const

const CHIP_TYPEAHEAD_FIELDS: RuleField[] = ['author', 'genre', 'tag', 'collection']
const TEXT_TYPEAHEAD_FIELDS: RuleField[] = ['publisher', 'series', 'language']

const ENDPOINT_BY_FIELD: Partial<Record<RuleField, string>> = {
  author: '/api/v1/metadata/authors',
  genre: '/api/v1/metadata/genres',
  tag: '/api/v1/metadata/tags',
  collection: '/api/v1/metadata/collections',
  publisher: '/api/v1/metadata/publishers',
  series: '/api/v1/metadata/series',
  language: '/api/v1/metadata/languages',
}

type WithinLastUnit = 'days' | 'weeks' | 'months'

interface EditableRule {
  field: RuleField
  operator: RuleOperator
  value: string
  valueChips: string[]
  valueTo: string
  valueUnit: WithinLastUnit
}

type LocalNode = { id: number; kind: 'rule'; rule: EditableRule } | { id: number; kind: 'group'; group: GroupRule }

let nodeIdCounter = 0
function nextId() {
  return ++nodeIdCounter
}

function makeEmptyRule(): LocalNode {
  return { id: nextId(), kind: 'rule', rule: { field: 'title', operator: 'contains', value: '', valueChips: [], valueTo: '', valueUnit: 'days' } }
}

function toEditableRule(r: Rule): EditableRule {
  const usesChips = Array.isArray(r.value)
  return {
    field: r.field,
    operator: r.operator,
    value: usesChips ? '' : String(r.value ?? ''),
    valueChips: usesChips ? (r.value as string[]) : [],
    valueTo: String(r.valueTo ?? ''),
    valueUnit: 'days',
  }
}

function toLocalNodes(group: GroupRule | undefined): LocalNode[] {
  if (!group) return []
  return group.rules.map((r) =>
    r.type === 'rule'
      ? { id: nextId(), kind: 'rule' as const, rule: toEditableRule(r) }
      : { id: nextId(), kind: 'group' as const, group: r as GroupRule },
  )
}

function parseValue(field: RuleField, operator: RuleOperator, raw: string, chips: string[], unit: WithinLastUnit): Rule['value'] {
  if (NO_VALUE_OPERATORS.includes(operator)) return undefined
  if (COLLECTION_OPERATORS.includes(operator)) return chips
  if (NUMERIC_FIELDS.includes(field)) return raw === '' ? undefined : Number(raw)
  if (DATE_FIELDS.includes(field) && operator === 'withinLast') {
    if (raw === '') return undefined
    const n = Number(raw)
    const multiplier = unit === 'weeks' ? 7 : unit === 'months' ? 30 : 1
    return n * multiplier
  }
  return raw || undefined
}

const nodes = ref<LocalNode[]>(toLocalNodes(props.modelValue))
const join = ref<'AND' | 'OR'>(props.modelValue?.join ?? 'AND')
let selfEmitting = false

watch(
  () => props.modelValue,
  (val) => {
    if (selfEmitting) return
    nodes.value = toLocalNodes(val)
    join.value = val?.join ?? 'AND'
  },
)

function isRuleComplete(r: EditableRule): boolean {
  if (NO_VALUE_OPERATORS.includes(r.operator)) return true
  if (COLLECTION_OPERATORS.includes(r.operator)) return r.valueChips.length > 0
  if (BETWEEN_OPERATORS.includes(r.operator)) return String(r.value).trim() !== '' && String(r.valueTo).trim() !== ''
  return String(r.value).trim() !== ''
}

function emitUpdate() {
  selfEmitting = true
  setTimeout(() => {
    selfEmitting = false
  }, 0)
  if (nodes.value.length === 0) {
    emit('update:modelValue', undefined)
    return
  }
  const rules: (Rule | GroupRule)[] = nodes.value
    .filter((n) => (n.kind === 'group' && n.group.rules.length > 0) || (n.kind === 'rule' && isRuleComplete(n.rule)))
    .map((n) => {
      if (n.kind === 'group') return n.group
      return {
        type: 'rule' as const,
        field: n.rule.field,
        operator: n.rule.operator,
        value: parseValue(n.rule.field, n.rule.operator, n.rule.value, n.rule.valueChips, n.rule.valueUnit),
        valueTo:
          BETWEEN_OPERATORS.includes(n.rule.operator) && n.rule.valueTo !== ''
            ? NUMERIC_FIELDS.includes(n.rule.field)
              ? Number(n.rule.valueTo)
              : n.rule.valueTo
            : undefined,
      }
    })
  const isSubGroup = (props.depth ?? 0) > 0
  if (!isSubGroup && rules.length === 0) {
    // Top-level: no complete rules means no active filter — don't send an empty group to the API.
    emit('update:modelValue', undefined)
    return
  }
  // Sub-group: always emit a group when nodes exist so the parent keeps this node alive.
  // undefined is reserved for "zero nodes" and signals the parent to remove the group.
  emit('update:modelValue', { type: 'group', join: join.value, rules })
}

function setJoin(value: 'AND' | 'OR') {
  join.value = value
  emitUpdate()
}

function addRule() {
  nodes.value.push(makeEmptyRule())
}

function addGroup() {
  nodes.value.push({
    id: nextId(),
    kind: 'group',
    group: { type: 'group', join: 'AND', rules: [] },
  })
}

function removeNode(index: number) {
  nodes.value.splice(index, 1)
  emitUpdate()
}

function onFieldChange(index: number) {
  const node = nodes.value[index]
  if (node?.kind !== 'rule') return
  const validOps = FIELD_OPERATORS[node.rule.field]
  if (!validOps.includes(node.rule.operator)) {
    node.rule.operator = validOps[0]!
  }
  node.rule.value = ''
  node.rule.valueChips = []
  node.rule.valueTo = ''
  node.rule.valueUnit = 'days'
  emitUpdate()
}

function onOperatorChange(index: number) {
  const node = nodes.value[index]
  if (node?.kind !== 'rule') return
  if (COLLECTION_OPERATORS.includes(node.rule.operator)) {
    node.rule.value = ''
    node.rule.valueTo = ''
  } else {
    node.rule.valueChips = []
  }
  emitUpdate()
}

function onSubGroupUpdate(index: number, val: GroupRule | undefined) {
  if (val === undefined) {
    nodes.value.splice(index, 1)
  } else {
    const node = nodes.value[index]
    if (node?.kind === 'group') node.group = val
  }
  emitUpdate()
}

function applyScorePreset(index: number, preset: (typeof SCORE_PRESETS)[number]) {
  const node = nodes.value[index]
  if (node?.kind !== 'rule') return
  if ('lt' in preset) {
    node.rule.operator = 'lt'
    node.rule.value = String(preset.lt)
  } else {
    node.rule.operator = 'gte'
    node.rule.value = String(preset.gte)
  }
  node.rule.valueTo = ''
  emitUpdate()
}

function valueInputType(field: RuleField, operator: RuleOperator): string {
  if (NO_VALUE_OPERATORS.includes(operator)) return 'none'
  if (DATE_FIELDS.includes(field)) return operator === 'withinLast' ? 'number' : 'date'
  if (NUMERIC_FIELDS.includes(field)) return 'number'
  return 'text'
}

function showValueToInput(operator: RuleOperator): boolean {
  return BETWEEN_OPERATORS.includes(operator)
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <!-- AND / OR join toggle — always visible in sub-groups, shown at root only when 2+ nodes -->
    <div v-if="nodes.length > 1 || (depth ?? 0) > 0" class="flex items-center gap-2 mb-0.5">
      <span class="text-xs text-muted-foreground">Match</span>
      <div class="flex rounded-md border border-input overflow-hidden">
        <button
          @click="setJoin('AND')"
          class="px-3 py-1 text-xs font-semibold transition-colors"
          :class="join === 'AND' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/80'"
        >
          ALL
        </button>
        <button
          @click="setJoin('OR')"
          class="px-3 py-1 text-xs font-semibold border-l border-input transition-colors"
          :class="join === 'OR' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-muted/80'"
        >
          ANY
        </button>
      </div>
      <span class="text-xs text-muted-foreground">of the following rules</span>
    </div>

    <template v-for="(node, index) in nodes" :key="node.id">
      <!-- Rule row -->
      <div v-if="node.kind === 'rule'" class="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
        <select
          v-model="node.rule.field"
          @change="onFieldChange(index)"
          class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary shrink-0"
        >
          <option v-for="field in RULE_FIELDS" :key="field" :value="field">{{ FIELD_LABELS[field] }}</option>
        </select>

        <select
          v-model="node.rule.operator"
          @change="onOperatorChange(index)"
          class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary shrink-0"
        >
          <option v-for="op in FIELD_OPERATORS[node.rule.field]" :key="op" :value="op">{{ OPERATOR_LABELS[op] }}</option>
        </select>

        <!-- Chip typeahead: author/genre/tag/collection always; publisher/series/language when using multi-value operators -->
        <FilterChipTypeahead
          v-if="
            (CHIP_TYPEAHEAD_FIELDS.includes(node.rule.field) || TEXT_TYPEAHEAD_FIELDS.includes(node.rule.field)) &&
            COLLECTION_OPERATORS.includes(node.rule.operator)
          "
          v-model="node.rule.valueChips"
          :endpoint="ENDPOINT_BY_FIELD[node.rule.field]!"
          @update:model-value="emitUpdate"
        />
        <!-- Format inline toggle picker -->
        <FilterFormatPicker v-else-if="node.rule.field === 'format'" v-model="node.rule.valueChips" @update:model-value="emitUpdate" />
        <!-- withinLast: number + unit selector -->
        <template v-else-if="node.rule.operator === 'withinLast'">
          <input
            v-model="node.rule.value"
            type="number"
            min="1"
            placeholder="e.g. 7"
            class="h-9 w-20 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary"
            @input="emitUpdate"
          />
          <select
            v-model="node.rule.valueUnit"
            class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary"
            @change="emitUpdate"
          >
            <option value="days">days</option>
            <option value="weeks">weeks</option>
            <option value="months">months</option>
          </select>
        </template>
        <!-- Text typeahead: publisher, series, language -->
        <FilterTextTypeahead
          v-else-if="TEXT_TYPEAHEAD_FIELDS.includes(node.rule.field) && !NO_VALUE_OPERATORS.includes(node.rule.operator)"
          v-model="node.rule.value"
          :endpoint="ENDPOINT_BY_FIELD[node.rule.field]!"
          @update:model-value="emitUpdate"
        />
        <!-- Metadata score: preset range chips + numeric input -->
        <template v-else-if="node.rule.field === 'metadataScore' && !NO_VALUE_OPERATORS.includes(node.rule.operator)">
          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="preset in SCORE_PRESETS"
              :key="preset.label"
              type="button"
              class="h-7 px-2.5 rounded-md text-xs border transition-colors"
              :class="
                ('gte' in preset && node.rule.operator === 'gte' && node.rule.value === String(preset.gte)) ||
                ('lt' in preset && node.rule.operator === 'lt' && node.rule.value === String(preset.lt))
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-foreground border-input hover:bg-muted'
              "
              @click="applyScorePreset(index, preset)"
            >
              {{ preset.label }}
            </button>
          </div>
          <input
            v-model="node.rule.value"
            @input="emitUpdate"
            type="number"
            min="0"
            max="100"
            placeholder="0-100"
            class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary w-24"
          />
          <template v-if="showValueToInput(node.rule.operator)">
            <span class="text-xs text-muted-foreground">to</span>
            <input
              v-model="node.rule.valueTo"
              @input="emitUpdate"
              type="number"
              min="0"
              max="100"
              placeholder="100"
              class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary w-24"
            />
          </template>
        </template>
        <!-- Standard input: text, number, date -->
        <template v-else-if="!NO_VALUE_OPERATORS.includes(node.rule.operator)">
          <input
            v-model="node.rule.value"
            @input="emitUpdate"
            :type="valueInputType(node.rule.field, node.rule.operator)"
            placeholder="value"
            class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary min-w-32 flex-1"
          />
          <template v-if="showValueToInput(node.rule.operator)">
            <span class="text-xs text-muted-foreground">to</span>
            <input
              v-model="node.rule.valueTo"
              @input="emitUpdate"
              :type="valueInputType(node.rule.field, node.rule.operator)"
              placeholder="max"
              class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary w-24"
            />
          </template>
        </template>

        <button
          @click="removeNode(index)"
          class="ml-auto h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
        >
          <Trash2 :size="13" />
        </button>
      </div>

      <!-- Nested group -->
      <div v-else-if="node.kind === 'group'" class="flex items-start gap-2">
        <div class="flex-1 rounded-xl border border-primary/20 bg-primary/3 p-3">
          <div class="flex items-center justify-between mb-3">
            <span class="text-[10px] font-semibold uppercase tracking-widest text-primary/50">Group</span>
          </div>
          <BookFilterBuilder :model-value="node.group" :depth="(depth ?? 0) + 1" @update:model-value="onSubGroupUpdate(index, $event)" />
        </div>
        <button
          @click="removeNode(index)"
          class="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0 mt-1"
        >
          <Trash2 :size="13" />
        </button>
      </div>
    </template>

    <!-- Add buttons -->
    <div class="flex items-center gap-2 pt-0.5">
      <button
        @click="addRule"
        class="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-dashed border-input text-sm text-muted-foreground hover:text-foreground hover:border-foreground hover:bg-muted/30 transition-colors"
      >
        <Plus :size="13" />
        Add rule
      </button>
      <button
        v-if="(depth ?? 0) < MAX_DEPTH"
        @click="addGroup"
        class="flex items-center gap-1.5 h-9 px-4 rounded-lg border border-dashed border-primary/30 text-sm text-primary/50 hover:text-primary hover:border-primary hover:bg-primary/5 transition-colors"
      >
        <Plus :size="13" />
        Add group
      </button>
    </div>
  </div>
</template>
