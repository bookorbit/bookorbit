import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { GroupRule, Rule, RuleField } from '@bookorbit/types'
import type { useFilterFields } from '@/features/book/composables/useFilterFields'
import { pruneIncomplete } from '@/features/book/lib/filter-fields'

/** A rule in the builder's working copy; it may still lack a value. */
export interface DraftRule {
  id: number
  kind: 'rule'
  rule: Rule
}

export interface DraftGroup {
  id: number
  kind: 'group'
  join: GroupRule['join']
  children: DraftNode[]
}

export type DraftNode = DraftRule | DraftGroup

/**
 * What every row and group of one builder shares. The builder owns the working copy, so rows ask
 * it to change the tree rather than editing what they were handed.
 */
export interface FilterBuilderContext {
  fields: ReturnType<typeof useFilterFields>
  maxDepth: ComputedRef<number>
  matchCount: ComputedRef<number | null>
  counts: ComputedRef<Partial<Record<RuleField, Record<string, number>>> | undefined>
  /** The row whose value panel is open. */
  openValueFor: Ref<number | null>
  /** The field picker that is open: `add:<groupId>` for a group's Add filter, `field:<ruleId>` for a row's field. */
  openFieldFor: Ref<string | null>
  addRule: (group: DraftGroup, field: RuleField) => void
  addGroup: (parent: DraftGroup) => void
  replaceRule: (node: DraftRule, rule: Rule) => void
  duplicate: (parent: DraftGroup, index: number) => void
  wrapInGroup: (parent: DraftGroup, index: number) => void
  ungroup: (parent: DraftGroup, index: number) => void
  remove: (parent: DraftGroup, index: number) => void
  setJoin: (group: DraftGroup, join: GroupRule['join']) => void
}

export const FILTER_BUILDER_KEY: InjectionKey<FilterBuilderContext> = Symbol('filter-builder')

let draftId = 0

export function nextDraftId(): number {
  return ++draftId
}

export function toDraft(group: GroupRule | undefined): DraftGroup {
  return {
    id: nextDraftId(),
    kind: 'group',
    join: group?.join ?? 'AND',
    children: (group?.rules ?? []).map((node) =>
      node.type === 'group' ? toDraft(node) : { id: nextDraftId(), kind: 'rule' as const, rule: { ...node } },
    ),
  }
}

/** The working copy as a filter: rules without a value and groups left empty are dropped. */
export function fromDraft(group: DraftGroup): GroupRule {
  return pruneIncomplete({
    type: 'group',
    join: group.join,
    rules: group.children.map((node) => (node.kind === 'group' ? fromDraft(node) : node.rule)),
  })
}

/** A copy of a node with fresh ids, for Duplicate. */
export function cloneDraft(node: DraftNode): DraftNode {
  if (node.kind === 'rule') return { id: nextDraftId(), kind: 'rule', rule: JSON.parse(JSON.stringify(node.rule)) as Rule }
  return { id: nextDraftId(), kind: 'group', join: node.join, children: node.children.map(cloneDraft) }
}
