<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, Funnel, Group, Plus } from '@lucide/vue'
import type { AcceptableValue } from 'reka-ui'
import type { GroupRule, Rule, RuleField } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useFilterFields } from '@/features/book/composables/useFilterFields'
import { isRuleComplete } from '@/features/book/lib/filter-fields'
import FieldPickerPopover from './sort-filter/FieldPickerPopover.vue'
import FilterBuilderGroup from './sort-filter/FilterBuilderGroup.vue'
import FilterBuilderRow from './sort-filter/FilterBuilderRow.vue'
import {
  FILTER_BUILDER_KEY,
  cloneDraft,
  fromDraft,
  nextDraftId,
  toDraft,
  type DraftGroup,
  type DraftRule,
  type FilterBuilderContext,
} from './sort-filter/filter-builder'
import { ghostButton, primaryButton } from './sort-filter/filter-styles'

/**
 * The full filter builder: "Match all of these filters", one line per rule and indented groups for
 * any-of matching. Rows keep a rule while it has no value yet, but only rules with a value reach
 * the filter, so a half-made row is dropped once the builder closes.
 */
const props = withDefaults(
  defineProps<{
    modelValue: GroupRule | undefined
    /** Deepest nesting allowed. A smart scope's page wraps this filter in the scope's own rules, so it allows one level less. */
    maxDepth?: number
    /** Keep an empty root group rather than clearing the filter, for editors that tell "no filter" apart from "no rules yet". */
    preserveIncompleteRoot?: boolean
    /** Books the filter matches, for the live count; null when the host cannot count. */
    matchCount?: number | null
    /** Book counts per value of checklist fields, keyed by field, where the host knows them. */
    counts?: Partial<Record<RuleField, Record<string, number>>>
  }>(),
  { maxDepth: 5, preserveIncompleteRoot: false, matchCount: null, counts: undefined },
)

const emit = defineEmits<{
  'update:modelValue': [value: GroupRule | undefined]
}>()

const { t } = useI18n()
const fields = useFilterFields()

const root = ref<DraftGroup>(toDraft(props.modelValue))
const openValueFor = ref<number | null>(null)
const openFieldFor = ref<string | null>(null)

function serialize(value: GroupRule | undefined): string {
  return JSON.stringify(value ?? null)
}

// The filter as last sent or received. An echo of what the builder just sent must not rebuild the
// rows, or a rule still waiting for its value would vanish mid-edit.
let lastSeen = serialize(props.modelValue)

watch(
  () => props.modelValue,
  (value) => {
    const serialized = serialize(value)
    if (serialized === lastSeen) return
    lastSeen = serialized
    root.value = toDraft(value)
    openValueFor.value = null
    openFieldFor.value = null
  },
)

function commit() {
  const pruned = fromDraft(root.value)
  const value = pruned.rules.length > 0 || props.preserveIncompleteRoot ? pruned : undefined
  const serialized = serialize(value)
  if (serialized === lastSeen) return
  lastSeen = serialized
  emit('update:modelValue', value)
}

function openLater(apply: () => void) {
  // A picker or menu is still closing; opening the next panel in the same tick would count as an outside click on it.
  setTimeout(apply, 0)
}

function addRule(group: DraftGroup, field: RuleField) {
  const node: DraftRule = { id: nextDraftId(), kind: 'rule', rule: fields.newRule(field) }
  group.children.push(node)
  commit()
  if (!isRuleComplete(node.rule)) openLater(() => (openValueFor.value = node.id))
}

function addGroup(parent: DraftGroup) {
  const group: DraftGroup = { id: nextDraftId(), kind: 'group', join: 'OR', children: [] }
  parent.children.push(group)
  openLater(() => (openFieldFor.value = `add:${group.id}`))
}

function replaceRule(node: DraftRule, rule: Rule) {
  node.rule = rule
  commit()
}

function duplicate(parent: DraftGroup, index: number) {
  const node = parent.children[index]
  if (!node) return
  parent.children.splice(index + 1, 0, cloneDraft(node))
  commit()
}

function wrapInGroup(parent: DraftGroup, index: number) {
  const node = parent.children[index]
  if (!node) return
  parent.children.splice(index, 1, { id: nextDraftId(), kind: 'group', join: 'OR', children: [node] })
  commit()
}

function ungroup(parent: DraftGroup, index: number) {
  const node = parent.children[index]
  if (node?.kind !== 'group') return
  parent.children.splice(index, 1, ...node.children)
  commit()
}

function remove(parent: DraftGroup, index: number) {
  parent.children.splice(index, 1)
  commit()
}

function setJoin(group: DraftGroup, join: GroupRule['join']) {
  group.join = join
  commit()
}

const context: FilterBuilderContext = {
  fields,
  maxDepth: computed(() => props.maxDepth),
  matchCount: computed(() => props.matchCount),
  counts: computed(() => props.counts),
  openValueFor,
  openFieldFor,
  addRule,
  addGroup,
  replaceRule,
  duplicate,
  wrapInGroup,
  ungroup,
  remove,
  setJoin,
}
provide(FILTER_BUILDER_KEY, context)

const rootJoinLabel = computed(() => (root.value.join === 'OR' ? t('book.filter.builder.joinAny') : t('book.filter.builder.joinAll')))
const addOpen = computed(() => openFieldFor.value === `add:${root.value.id}`)
const canAddGroup = computed(() => props.maxDepth > 0)

function handleRootJoin(value: AcceptableValue) {
  if (value === 'AND' || value === 'OR') setJoin(root.value, value)
}

function handleAddOpen(open: boolean) {
  openFieldFor.value = open ? `add:${root.value.id}` : null
}

function handleAdd(field: RuleField) {
  addRule(root.value, field)
}

function handleAddGroup() {
  addGroup(root.value)
}

function handleClearAll() {
  root.value.children = []
  commit()
}
</script>

<template>
  <div class="flex min-h-0 flex-col" data-testid="filter-builder">
    <div v-if="root.children.length === 0" class="grid justify-items-center gap-1.5 px-5 pt-7 pb-6 text-center" data-testid="filter-builder-empty">
      <Funnel :size="22" class="text-muted-foreground" aria-hidden="true" />
      <p class="text-sm font-semibold text-foreground">{{ t('book.filter.builder.emptyTitle') }}</p>
      <p class="max-w-[46ch] text-[12.5px] text-muted-foreground">{{ t('book.filter.builder.emptyBody') }}</p>
      <FieldPickerPopover
        :open="addOpen"
        :groups="fields.groups.value"
        align="center"
        :title="t('book.filter.builder.addFilter')"
        :placeholder="t('book.filter.filterBy')"
        :search-label="t('book.filter.findFieldAria')"
        :list-label="t('book.filter.fieldList')"
        @update:open="handleAddOpen"
        @pick="handleAdd"
      >
        <template #trigger>
          <button type="button" :class="primaryButton" class="mt-2" aria-haspopup="dialog">
            <Plus :size="14" aria-hidden="true" />
            {{ t('book.filter.builder.addFilter') }}
          </button>
        </template>
      </FieldPickerPopover>
    </div>

    <template v-else>
      <div class="flex shrink-0 items-center gap-1.5 border-b border-border pt-2.5 pe-2.5 pb-2 ps-3 text-[13px] text-muted-foreground">
        <span>{{ t('book.filter.builder.matchPrefix') }}</span>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button type="button" :class="ghostButton" class="-mx-0.5" :aria-label="`${t('book.filter.builder.changeJoin')}: ${rootJoinLabel}`">
              <span class="font-semibold text-foreground">{{ rootJoinLabel }}</span>
              <ChevronDown :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-48">
            <DropdownMenuRadioGroup :model-value="root.join" @update:model-value="handleRootJoin">
              <DropdownMenuRadioItem value="AND">{{ t('book.filter.builder.matchAllFilters') }}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="OR">{{ t('book.filter.builder.matchAnyFilter') }}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span>{{ t('book.filter.builder.ofTheseFilters') }}</span>
        <span class="flex-1" />
        <button type="button" :class="ghostButton" class="text-muted-foreground hover:text-foreground" @click="handleClearAll">
          {{ t('book.filter.clearAll') }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div class="grid px-1.5 py-1">
          <template v-for="(child, index) in root.children" :key="child.id">
            <FilterBuilderGroup v-if="child.kind === 'group'" :group="child" :parent="root" :index="index" :depth="1" />
            <FilterBuilderRow v-else :node="child" :parent="root" :index="index" :depth="0" />
          </template>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-1.5 border-t border-border px-2.5 py-2">
        <FieldPickerPopover
          :open="addOpen"
          :groups="fields.groups.value"
          side="top"
          :title="t('book.filter.builder.addFilter')"
          :placeholder="t('book.filter.filterBy')"
          :search-label="t('book.filter.findFieldAria')"
          :list-label="t('book.filter.fieldList')"
          @update:open="handleAddOpen"
          @pick="handleAdd"
        >
          <template #trigger>
            <button type="button" :class="ghostButton" class="text-primary" aria-haspopup="dialog">
              <Plus :size="13" aria-hidden="true" />
              {{ t('book.filter.builder.addFilter') }}
            </button>
          </template>
        </FieldPickerPopover>
        <button v-if="canAddGroup" type="button" :class="ghostButton" class="text-muted-foreground hover:text-foreground" @click="handleAddGroup">
          <Group :size="13" aria-hidden="true" />
          {{ t('book.filter.builder.addGroup') }}
        </button>
        <span class="flex-1" />
        <span v-if="matchCount !== null" class="text-xs whitespace-nowrap text-muted-foreground" aria-live="polite">
          {{ t('book.filter.matchCount', { count: matchCount }) }}
        </span>
      </div>
    </template>
  </div>
</template>
