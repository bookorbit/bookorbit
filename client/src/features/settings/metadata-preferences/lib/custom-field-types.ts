import type { Component } from 'vue'
import { Calendar, Hash, Link, SquareCheck, Type } from '@lucide/vue'
import type { CustomMetadataFieldType, RuleOperator } from '@bookorbit/types'
import { CUSTOM_FIELD_TYPE_OPERATORS, CUSTOM_METADATA_FIELD_TYPES } from '@bookorbit/types'

type CustomFieldTypeMeta = {
  icon: Component
  /** A tuned pill token, so the tint holds contrast in both themes. */
  color: string
}

/** Yes / No draws a checkbox on Edit Metadata, so its icon is one too. */
export const CUSTOM_FIELD_TYPE_META: Record<CustomMetadataFieldType, CustomFieldTypeMeta> = {
  text: { icon: Type, color: 'var(--pill-source-blue)' },
  url: { icon: Link, color: 'var(--pill-source-indigo)' },
  number: { icon: Hash, color: 'var(--pill-source-orange)' },
  date: { icon: Calendar, color: 'var(--pill-source-teal)' },
  boolean: { icon: SquareCheck, color: 'var(--pill-source-pink)' },
}

export const CUSTOM_FIELD_TYPE_ORDER: readonly CustomMetadataFieldType[] = CUSTOM_METADATA_FIELD_TYPES

const PRESENCE_OPERATORS: RuleOperator[] = ['isEmpty', 'isNotEmpty']

/** The filter operators a field of this type offers, with the presence pair last as the filter builder shows them. */
export function filterOperatorsFor(type: CustomMetadataFieldType): RuleOperator[] {
  const operators = CUSTOM_FIELD_TYPE_OPERATORS[type]
  return [...operators.filter((operator) => !PRESENCE_OPERATORS.includes(operator)), ...PRESENCE_OPERATORS]
}

export function typeLabelKey(type: CustomMetadataFieldType): string {
  return `settings.metadata.customFields.types.${type}.label`
}

export function typeHintKey(type: CustomMetadataFieldType): string {
  return `settings.metadata.customFields.types.${type}.hint`
}

export function typeExampleKey(type: CustomMetadataFieldType): string {
  return `settings.metadata.customFields.types.${type}.example`
}

/** Tint for a type chip or tile, on the DuplicateConfidenceChip recipe. */
export function typeTintStyle(type: CustomMetadataFieldType, fill = 13, ring = 32): Record<string, string> {
  const color = CUSTOM_FIELD_TYPE_META[type].color
  return {
    color,
    backgroundColor: `color-mix(in oklch, ${color} ${fill}%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklch, ${color} ${ring}%, transparent)`,
  }
}
