import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Funnel } from '@lucide/vue'
import type { CustomMetadataFieldType, Rule, RuleField, RuleOperator, StaticRuleField } from '@bookorbit/types'
import { customRuleField, parseCustomRuleFieldId } from '@bookorbit/types'
import { useActiveCustomFields } from '@/features/book/composables/useActiveCustomFields'
import { fieldLabel } from '@/features/book/lib/filter-labels'
import { CUSTOM_FIELD_ICONS } from '@/features/book/lib/sort-fields'
import {
  FILTER_FIELD_GROUPS,
  FILTER_FIELD_ICONS,
  defaultRule,
  filterKindOf,
  operatorsFor,
  withOperator,
  type FilterKind,
} from '@/features/book/lib/filter-fields'
import type { FieldOptionGroup } from '@/features/book/components/sort-filter/field-listbox'

/**
 * The filter catalog a picker shows, grouped Book, Reading, Library and files, Metadata and the
 * user's custom fields, plus what each field needs: its kind, icon, label and operators.
 */
export function useFilterFields() {
  const { t } = useI18n()
  const { fields: customFields } = useActiveCustomFields()

  const activeCustomFields = computed(() =>
    customFields.value.filter((field) => !field.archivedAt).sort((a, b) => a.displayOrder - b.displayOrder || a.label.localeCompare(b.label)),
  )
  const customTypes = computed(() => new Map(customFields.value.map((field) => [field.id, field.type])))

  function customTypeOf(field: RuleField): CustomMetadataFieldType | null {
    const id = parseCustomRuleFieldId(field)
    return id === null ? null : (customTypes.value.get(id) ?? null)
  }

  function kindOf(field: RuleField): FilterKind {
    return filterKindOf(field, customTypeOf(field))
  }

  function iconOf(field: RuleField): Component {
    const id = parseCustomRuleFieldId(field)
    if (id === null) return FILTER_FIELD_ICONS[field as StaticRuleField] ?? Funnel
    const type = customTypes.value.get(id)
    return type ? CUSTOM_FIELD_ICONS[type] : Funnel
  }

  function operatorsOf(field: RuleField): RuleOperator[] {
    return operatorsFor(field, customTypeOf(field))
  }

  function newRule(field: RuleField): Rule {
    return defaultRule(field, customTypeOf(field))
  }

  function changeOperator(rule: Rule, operator: RuleOperator): Rule {
    return withOperator(rule, operator, kindOf(rule.field))
  }

  const groups = computed<FieldOptionGroup<RuleField>[]>(() => {
    const builtIn = FILTER_FIELD_GROUPS.map((group) => ({
      key: group.key,
      label: t(`book.filter.groups.${group.key}`),
      options: group.fields.map((field) => ({ value: field as RuleField, label: fieldLabel(field), icon: iconOf(field) })),
    }))
    const custom = activeCustomFields.value.map((field) => {
      const value = customRuleField(field.id)
      return { value: value as RuleField, label: field.label, icon: iconOf(value) }
    })
    return custom.length > 0 ? [...builtIn, { key: 'custom', label: t('book.filter.groups.custom'), options: custom }] : builtIn
  })

  return { groups, kindOf, iconOf, labelOf: fieldLabel, operatorsOf, customTypeOf, newRule, changeOperator }
}
