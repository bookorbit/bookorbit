<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Group, SlidersHorizontal, X } from '@lucide/vue'
import type { GroupRule, Rule, RuleField } from '@bookorbit/types'
import BookFilterBuilder from '@/features/book/components/BookFilterBuilder.vue'
import { useFilterFields } from '@/features/book/composables/useFilterFields'
import type { FilterPanelView } from '@/features/book/composables/useFilterPanel'
import { groupLabel, ruleSentence } from '@/features/book/lib/filter-labels'
import { LIST_OPERATORS, isRuleComplete } from '@/features/book/lib/filter-fields'
import FieldListbox from './FieldListbox.vue'
import FilterRuleEditor from './FilterRuleEditor.vue'
import { choiceRow, ghostButton, iconButton, sectionLabel } from './filter-styles'

/**
 * The bar's filter: a searchable list of fields with the active filters above it. A field opens
 * only its own control and changes apply as they are made; a rule joins the filter once it has a
 * value. The Advanced builder holds groups and any-of matching.
 */
const props = withDefaults(
  defineProps<{
    modelValue: GroupRule | undefined
    view?: FilterPanelView
    /** Books the current filter matches, for the live count; null when the host cannot count. */
    matchCount?: number | null
    maxDepth?: number
    /** Book counts per value of checklist fields, keyed by field, where the host knows them. */
    counts?: Partial<Record<RuleField, Record<string, number>>>
  }>(),
  { view: () => ({ kind: 'fields' }), matchCount: null, maxDepth: undefined, counts: undefined },
)

const emit = defineEmits<{
  'update:modelValue': [value: GroupRule | undefined]
  close: []
}>()

defineSlots<{
  /** The host's own actions under the builder, such as saving the filter. */
  'builder-footer'?: () => unknown
}>()

interface Editing {
  draft: Rule
  /** Where the rule sits in the root group, or null while it has no value and so is not in the filter. */
  index: number | null
  /** Where it goes back in once it has a value again. */
  slot: number
  fromFields: boolean
  /** Changes on each new rule opened, so the editor starts fresh for it. */
  session: number
}

const { t } = useI18n()
const { groups, kindOf, iconOf, newRule } = useFilterFields()

const screen = ref<FilterPanelView['kind']>('fields')
const editing = shallowRef<Editing | null>(null)
let sessions = 0
const rules = computed(() => props.modelValue?.rules ?? [])

const activeItems = computed(() =>
  rules.value.map((node, index) =>
    node.type === 'group' ? { index, icon: Group, sentence: groupLabel(node) } : { index, icon: iconOf(node.field), sentence: ruleSentence(node) },
  ),
)

function editAt(index: number, fromFields: boolean) {
  const node = rules.value[index]
  if (!node) {
    screen.value = 'fields'
    return
  }
  if (node.type === 'group') {
    screen.value = 'builder'
    return
  }
  editing.value = { draft: { ...node }, index, slot: index, fromFields, session: ++sessions }
  screen.value = 'rule'
}

watch(
  () => props.view,
  (view) => {
    if (view.kind === 'rule') editAt(view.index, false)
    else screen.value = view.kind
  },
  { immediate: true },
)

function write(next: (Rule | GroupRule)[]) {
  emit('update:modelValue', next.length > 0 ? { type: 'group', join: props.modelValue?.join ?? 'AND', rules: next } : undefined)
}

function applyDraft(draft: Rule) {
  const current = editing.value
  if (!current) return
  const next = [...rules.value]
  let { index, slot } = current
  if (isRuleComplete(draft)) {
    if (index !== null && index < next.length) next[index] = draft
    else {
      index = Math.min(slot, next.length)
      next.splice(index, 0, draft)
    }
    write(next)
  } else if (index !== null) {
    next.splice(index, 1)
    slot = index
    index = null
    write(next)
  }
  editing.value = { ...current, draft, index, slot }
}

function handlePickField(field: RuleField) {
  // A checklist field already filtered on opens that filter rather than starting a second one.
  const existing = rules.value.findIndex(
    (node) => node.type === 'rule' && node.field === field && kindOf(field) === 'list' && LIST_OPERATORS.includes(node.operator),
  )
  if (existing >= 0) {
    editAt(existing, true)
    return
  }
  editing.value = { draft: newRule(field), index: null, slot: rules.value.length, fromFields: true, session: ++sessions }
  screen.value = 'rule'
  applyDraft(editing.value.draft)
}

function handleEditActive(index: number) {
  editAt(index, true)
}

function handleRemoveActive(index: number) {
  write(rules.value.filter((_, i) => i !== index))
}

function handleClearAll() {
  emit('update:modelValue', undefined)
}

function handleBack() {
  editing.value = null
  screen.value = 'fields'
}

function handleRemoveRule() {
  const current = editing.value
  if (current?.index != null) write(rules.value.filter((_, i) => i !== current.index))
  if (current?.fromFields) handleBack()
  else emit('close')
}

function handleDone() {
  emit('close')
}

const builderRef = ref<HTMLElement | null>(null)

// The Advanced builder button leaves with the field list, so the builder takes focus in its place.
function handleAdvanced() {
  screen.value = 'builder'
  void nextTick(() => {
    if (!builderRef.value?.contains(document.activeElement)) builderRef.value?.querySelector<HTMLElement>('button')?.focus()
  })
}

function handleBuilderUpdate(value: GroupRule | undefined) {
  emit('update:modelValue', value)
}
</script>

<template>
  <div v-if="screen === 'fields'" class="flex min-h-0 w-[312px] max-w-full flex-col max-sm:w-full" data-testid="filter-panel-fields">
    <FieldListbox
      :groups="groups"
      searchable
      :placeholder="t('book.filter.filterBy')"
      :search-label="t('book.filter.findFieldAria')"
      :list-label="t('book.filter.fieldList')"
      list-class="max-h-[430px] max-sm:max-h-none"
      @pick="handlePickField"
    >
      <template #before>
        <div v-if="activeItems.length > 0" role="group" :aria-label="t('book.filter.active')">
          <div class="flex items-center justify-between pe-1">
            <span :class="sectionLabel">{{ t('book.filter.active') }}</span>
            <button
              type="button"
              :class="ghostButton"
              class="h-[22px] text-[11.5px] text-muted-foreground hover:text-foreground"
              @click="handleClearAll"
            >
              {{ t('book.filter.clearAll') }}
            </button>
          </div>
          <div v-for="item in activeItems" :key="item.index" class="flex items-center">
            <button
              type="button"
              :class="choiceRow"
              class="min-w-0 flex-1"
              :aria-label="t('book.filter.editNamed', { label: item.sentence })"
              @click="handleEditActive(item.index)"
            >
              <component :is="item.icon" :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate">{{ item.sentence }}</span>
              <ChevronRight :size="14" class="ms-auto shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
            <button
              type="button"
              :class="iconButton"
              :aria-label="t('book.filter.removeNamed', { label: item.sentence })"
              @click="handleRemoveActive(item.index)"
            >
              <X :size="14" aria-hidden="true" />
            </button>
          </div>
          <div class="-mx-1 my-1 h-px bg-border" />
          <div :class="sectionLabel">{{ t('book.filter.addAFilter') }}</div>
        </div>
      </template>
    </FieldListbox>
    <div class="grid shrink-0 border-t border-border p-1.5">
      <button type="button" :class="choiceRow" @click="handleAdvanced">
        <SlidersHorizontal :size="15" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate">{{ t('book.filter.advancedBuilder') }}</span>
        <span class="ms-auto shrink-0 text-xs text-muted-foreground">{{ t('book.filter.advancedBuilderHint') }}</span>
      </button>
    </div>
  </div>

  <FilterRuleEditor
    v-else-if="screen === 'rule' && editing"
    :key="editing.session"
    :rule="editing.draft"
    :can-go-back="editing.fromFields"
    :removable="editing.index !== null || !editing.fromFields"
    :match-count="matchCount"
    :counts="counts?.[editing.draft.field]"
    @update:rule="applyDraft"
    @back="handleBack"
    @remove="handleRemoveRule"
    @done="handleDone"
  />

  <div
    v-else
    ref="builderRef"
    class="flex max-h-[600px] min-h-0 w-[660px] max-w-full flex-col max-sm:max-h-none max-sm:w-full"
    data-testid="filter-panel-builder"
  >
    <BookFilterBuilder
      :model-value="modelValue"
      :max-depth="maxDepth"
      :match-count="matchCount"
      :counts="counts"
      class="min-h-0 flex-1"
      @update:model-value="handleBuilderUpdate"
    />
    <div v-if="$slots['builder-footer']" class="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-3 py-2">
      <slot name="builder-footer" />
    </div>
  </div>
</template>
