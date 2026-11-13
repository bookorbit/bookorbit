import { computed, toValue, type Component, type MaybeRefOrGetter } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SortField, SortSpec } from '@bookorbit/types'
import { customSortField, isCollectionScopedSortField, parseCustomSortFieldId } from '@bookorbit/types'
import { useActiveCustomFields } from '@/features/book/composables/useActiveCustomFields'
import { sortFieldLabel } from '@/features/book/lib/filter-labels'
import {
  CUSTOM_FIELD_ICONS,
  SORT_FIELD_GROUPS,
  SORT_FIELD_ICONS,
  SORT_FIELD_KINDS,
  customFieldSortKind,
  directionKey,
  naturalDirection,
  type BrowseSortField,
  type SortKind,
} from '@/features/book/lib/sort-fields'
import type { FieldOptionGroup } from '@/features/book/components/sort-filter/field-listbox'
import { ArrowUpDown } from '@lucide/vue'

export interface SortFieldsOptions {
  /** Offers the sorts that only resolve inside a collection, such as its manual order. */
  collectionScoped?: MaybeRefOrGetter<boolean>
  /** Limits the list to these fields, in this order, under one unnamed section. */
  only?: MaybeRefOrGetter<SortField[] | undefined>
  /** Page-specific names for fields, such as "Recently Added" for Date Added on an author page. */
  labels?: MaybeRefOrGetter<Partial<Record<SortField, string>> | undefined>
}

/**
 * The sort catalog a picker shows: grouped, labelled fields with their icons, plus the kind of
 * each field, which decides its direction words and the order it starts in.
 */
export function useSortFields(options: SortFieldsOptions = {}) {
  const { t } = useI18n()
  const { fields: customFields } = useActiveCustomFields()

  const activeCustomFields = computed(() =>
    customFields.value.filter((field) => !field.archivedAt).sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label)),
  )
  const customTypes = computed(() => new Map(customFields.value.map((field) => [field.id, field.type])))

  function kindOf(field: SortField): SortKind {
    const customId = parseCustomSortFieldId(field)
    if (customId !== null) return customFieldSortKind(customTypes.value.get(customId))
    return SORT_FIELD_KINDS[field as BrowseSortField] ?? 'text'
  }

  function iconOf(field: SortField): Component {
    const customId = parseCustomSortFieldId(field)
    if (customId !== null) {
      const type = customTypes.value.get(customId)
      return type ? CUSTOM_FIELD_ICONS[type] : ArrowUpDown
    }
    return SORT_FIELD_ICONS[field as BrowseSortField] ?? ArrowUpDown
  }

  function labelOf(field: SortField): string {
    return toValue(options.labels)?.[field] ?? sortFieldLabel(field)
  }

  function directionLabel(field: SortField, dir: SortSpec['dir']): string {
    const key = directionKey(kindOf(field), dir)
    return key ? t(key) : ''
  }

  function naturalDirectionOf(field: SortField): SortSpec['dir'] {
    return naturalDirection(kindOf(field))
  }

  function option(field: SortField) {
    return { value: field, label: labelOf(field), icon: iconOf(field) }
  }

  const groups = computed<FieldOptionGroup<SortField>[]>(() => {
    const only = toValue(options.only)
    if (only) return [{ key: 'only', label: '', options: only.map(option) }]
    const scoped = toValue(options.collectionScoped) ?? false
    const builtIn = SORT_FIELD_GROUPS.map((group) => ({
      key: group.key,
      label: t(`book.sort.groups.${group.key}`),
      options: group.fields.filter((field) => scoped || !isCollectionScopedSortField(field)).map(option),
    }))
    const custom = activeCustomFields.value.map((field) => option(customSortField(field.id)))
    return [...builtIn, ...(custom.length > 0 ? [{ key: 'custom', label: t('book.sort.groups.custom'), options: custom }] : [])].filter(
      (group) => group.options.length > 0,
    )
  })

  const fieldCount = computed(() => groups.value.reduce((sum, group) => sum + group.options.length, 0))

  return { groups, fieldCount, kindOf, iconOf, labelOf, directionLabel, naturalDirectionOf }
}

/** What the bar's sort button shows for a sort: extra tiers as "+1", and the lead's order in its own words. */
export function useSortBarLabels(sort: MaybeRefOrGetter<SortSpec[]>) {
  const { directionLabel, kindOf } = useSortFields()
  const lead = computed(() => toValue(sort)[0] ?? null)
  const extraLevels = computed(() => Math.max(0, toValue(sort).length - 1))
  const currentDirection = computed(() => (lead.value ? directionLabel(lead.value.field, lead.value.dir) : ''))
  const nextDirection = computed(() => (lead.value ? directionLabel(lead.value.field, lead.value.dir === 'asc' ? 'desc' : 'asc') : ''))
  const isRandom = computed(() => (lead.value ? kindOf(lead.value.field) === 'random' : false))
  return { extraLevels, currentDirection, nextDirection, isRandom }
}
