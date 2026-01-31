<script setup lang="ts">
import { ref, watch } from 'vue'
import { Plus, Trash2 } from 'lucide-vue-next'
import { FIELD_OPERATORS, RULE_FIELDS, type GroupRule, type Rule, type RuleField, type RuleOperator } from '@projectx/types'
import { FIELD_LABELS, OPERATOR_LABELS } from '@/features/book/lib/filter-labels'

const props = defineProps<{
  modelValue: GroupRule | undefined
  depth?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: GroupRule | undefined]
}>()

const MAX_DEPTH = 2
const NUMERIC_FIELDS: RuleField[] = ['seriesIndex', 'publishedYear', 'pageCount']
const DATE_FIELDS: RuleField[] = ['addedAt']
const NO_VALUE_OPERATORS: RuleOperator[] = ['isEmpty', 'isNotEmpty']
const BETWEEN_OPERATORS: RuleOperator[] = ['between']
const COLLECTION_OPERATORS: RuleOperator[] = ['includesAny', 'includesAll', 'excludesAll']

interface EditableRule {
  field: RuleField
  operator: RuleOperator
  value: string
  valueTo: string
}

type LocalNode = { kind: 'rule'; rule: EditableRule } | { kind: 'group'; group: GroupRule }

function makeEmptyRule(): EditableRule {
  return { field: 'title', operator: 'contains', value: '', valueTo: '' }
}

function toEditableRule(r: Rule): EditableRule {
  return {
    field: r.field,
    operator: r.operator,
    value: Array.isArray(r.value) ? (r.value as string[]).join(', ') : String(r.value ?? ''),
    valueTo: String(r.valueTo ?? ''),
  }
}

function toLocalNodes(group: GroupRule | undefined): LocalNode[] {
  if (!group) return []
  return group.rules.map((r) =>
    r.type === 'rule' ? { kind: 'rule' as const, rule: toEditableRule(r) } : { kind: 'group' as const, group: r as GroupRule },
  )
}

function parseValue(field: RuleField, operator: RuleOperator, raw: string): Rule['value'] {
  if (NO_VALUE_OPERATORS.includes(operator)) return undefined
  if (COLLECTION_OPERATORS.includes(operator)) {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  if (NUMERIC_FIELDS.includes(field)) return raw === '' ? undefined : Number(raw)
  if (DATE_FIELDS.includes(field) && operator === 'withinLast') return raw === '' ? undefined : Number(raw)
  return raw || undefined
}

const nodes = ref<LocalNode[]>(toLocalNodes(props.modelValue))
const join = ref<'AND' | 'OR'>(props.modelValue?.join ?? 'AND')

watch(
  () => props.modelValue,
  (val) => {
    nodes.value = toLocalNodes(val)
    join.value = val?.join ?? 'AND'
  },
)

function isRuleComplete(r: EditableRule): boolean {
  if (NO_VALUE_OPERATORS.includes(r.operator)) return true
  if (COLLECTION_OPERATORS.includes(r.operator)) return r.value.split(',').some((s) => s.trim() !== '')
  return r.value.trim() !== ''
}

function emitUpdate() {
  if (nodes.value.length === 0) {
    emit('update:modelValue', undefined)
    return
  }
  const rules: (Rule | GroupRule)[] = nodes.value
    .filter((n) => n.kind === 'group' || isRuleComplete(n.rule))
    .map((n) => {
      if (n.kind === 'group') return n.group
      return {
        type: 'rule' as const,
        field: n.rule.field,
        operator: n.rule.operator,
        value: parseValue(n.rule.field, n.rule.operator, n.rule.value),
        valueTo:
          BETWEEN_OPERATORS.includes(n.rule.operator) && n.rule.valueTo !== ''
            ? NUMERIC_FIELDS.includes(n.rule.field)
              ? Number(n.rule.valueTo)
              : n.rule.valueTo
            : undefined,
      }
    })
  emit('update:modelValue', rules.length > 0 ? { type: 'group', join: join.value, rules } : undefined)
}

function setJoin(value: 'AND' | 'OR') {
  join.value = value
  emitUpdate()
}

function addRule() {
  nodes.value.push({ kind: 'rule', rule: makeEmptyRule() })
  emitUpdate()
}

function addGroup() {
  nodes.value.push({
    kind: 'group',
    group: { type: 'group', join: 'AND', rules: [{ type: 'rule', field: 'title', operator: 'contains' }] },
  })
  emitUpdate()
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
  node.rule.valueTo = ''
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

function valueInputType(field: RuleField, operator: RuleOperator): string {
  if (NO_VALUE_OPERATORS.includes(operator)) return 'none'
  if (DATE_FIELDS.includes(field)) return operator === 'withinLast' ? 'number' : 'date'
  if (NUMERIC_FIELDS.includes(field)) return 'number'
  return 'text'
}

function showValueInput(operator: RuleOperator): boolean {
  return !NO_VALUE_OPERATORS.includes(operator)
}

function showValueToInput(operator: RuleOperator): boolean {
  return BETWEEN_OPERATORS.includes(operator)
}
</script>

<template>
  <div class="flex flex-col gap-2.5">
    <!-- AND / OR join toggle -->
    <div v-if="nodes.length > 1" class="flex items-center gap-2 mb-0.5">
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

    <template v-for="(node, index) in nodes" :key="index">
      <!-- Rule row -->
      <div v-if="node.kind === 'rule'" class="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
        <select
          v-model="node.rule.field"
          @change="onFieldChange(index)"
          class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option v-for="field in RULE_FIELDS" :key="field" :value="field">{{ FIELD_LABELS[field] }}</option>
        </select>

        <select
          v-model="node.rule.operator"
          @change="emitUpdate"
          class="h-9 rounded-md border border-input bg-background text-foreground text-sm px-2 focus:outline-none focus:ring-2 focus:ring-primary"
        >
          <option v-for="op in FIELD_OPERATORS[node.rule.field]" :key="op" :value="op">{{ OPERATOR_LABELS[op] }}</option>
        </select>

        <template v-if="showValueInput(node.rule.operator)">
          <input
            v-model="node.rule.value"
            @input="emitUpdate"
            :type="valueInputType(node.rule.field, node.rule.operator)"
            :placeholder="COLLECTION_OPERATORS.includes(node.rule.operator) ? 'comma-separated' : 'value'"
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
        <div class="flex-1 rounded-xl border border-primary/20 bg-primary/[0.03] p-3">
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
