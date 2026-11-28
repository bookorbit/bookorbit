import {
  COVER_ASPECT_RATIOS,
  CUSTOM_FIELD_TYPE_OPERATORS,
  CUSTOM_METADATA_FIELD_TYPES,
  FIELD_OPERATORS,
  ICON_VALUE_MAX_LENGTH,
  customRuleField,
  customSortField,
  isCollectionScopedSortField,
  isCustomRuleField,
  isMetadataProviderKeySyntax,
  isRuleField,
  isSortField,
  normalizeCoverAspectRatio,
  parseCustomRuleFieldId,
  parseCustomSortFieldId,
  type CoverAspectRatio,
  type CreateSmartScopePayload,
  type CustomMetadataFieldSummary,
  type CustomMetadataFieldType,
  type GroupRule,
  type Rule,
  type RuleOperator,
  type RuleValue,
  type SmartScope,
  type SortSpec,
} from '@bookorbit/types'
import { isRuleComplete, NO_VALUE_OPERATORS } from '@/features/book/lib/filter-fields'
import { resolveLucideIconFile } from '@/lib/lucide-icons'

export const MAX_TEMPLATE_BYTES = 128 * 1024
const MAX_RULES = 500
const MAX_DEPTH = 5
const MAX_SORT_LEVELS = 5
const FORMAT = 'bookorbit.smart-scope'

type CustomFieldReference = { label: string; type: CustomMetadataFieldType }
export type ScopeTemplate = {
  format: typeof FORMAT
  version: 1
  name: string
  icon: string
  coverAspectRatio: CoverAspectRatio
  filter: GroupRule | null
  defaultSort: SortSpec[]
  // A custom field's numeric reference in this file is its one-based position here.
  customFields: CustomFieldReference[]
}

export type ScopeReference =
  { key: string; kind: 'library' | 'collection'; label: string } | ({ key: string; kind: 'customField' } & CustomFieldReference)
export type ReferenceOption = { value: string; label: string; count: number }
type ReferenceCatalog = {
  libraries: readonly { name: string }[]
  collections: readonly { name: string }[]
  customFields: readonly CustomMetadataFieldSummary[]
}
type Mappings = Readonly<Record<string, string>>
type TransferErrorCode = 'invalid' | 'unsupportedVersion' | 'tooLarge' | 'missingCustomField'

export class ScopeTransferError extends Error {
  constructor(readonly code: TransferErrorCode) {
    super(code)
  }
}

function invalid(): never {
  throw new ScopeTransferError('invalid')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isScalar(value: unknown): value is string | number {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNameList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every(isName)
}

function isRuleValue(value: unknown): value is RuleValue {
  return (
    isScalar(value) ||
    isNameList(value) ||
    (Array.isArray(value) && value.length > 0 && value.length <= 20 && value.every((n) => typeof n === 'number' && Number.isFinite(n)))
  )
}

function portableIcon(icon: string | null) {
  return icon && resolveLucideIconFile(icon) ? icon : 'Aperture'
}

function parseRule(node: Record<string, unknown>, customFields: readonly CustomFieldReference[]): Rule {
  const { field, operator, value, valueTo, provider } = node
  if (typeof field !== 'string' || !isRuleField(field) || typeof operator !== 'string') return invalid()
  const customId = parseCustomRuleFieldId(field)
  const reference = customId === null ? undefined : customFields[customId - 1]
  const operators = isCustomRuleField(field) ? reference && CUSTOM_FIELD_TYPE_OPERATORS[reference.type] : FIELD_OPERATORS[field]
  if (!operators?.includes(operator as RuleOperator)) return invalid()
  if (value !== undefined && !isRuleValue(value)) return invalid()
  if (valueTo !== undefined && !isScalar(valueTo)) return invalid()
  if (provider !== undefined) {
    if (field !== 'communityRating' && field !== 'communityRatingCount') return invalid()
    if (typeof provider !== 'string' || (provider !== 'any' && !isMetadataProviderKeySyntax(provider))) return invalid()
  }

  const rule = { type: 'rule', field, operator, ...(provider !== undefined && { provider }) } as Rule
  if (NO_VALUE_OPERATORS.includes(rule.operator)) return rule
  if (value !== undefined) rule.value = value
  if (valueTo !== undefined) rule.valueTo = valueTo

  if ((field === 'library' || field === 'collection') && !isNameList(rule.value)) return invalid()
  if (reference && Array.isArray(rule.value)) return invalid()
  if (!isRuleComplete(rule)) return invalid()
  return rule
}

function parseFilter(filter: unknown, customFields: readonly CustomFieldReference[]): GroupRule | null {
  if (filter === null) return null
  let nodes = 0
  function parseGroup(group: unknown, depth: number): GroupRule {
    if (depth > MAX_DEPTH || !isRecord(group) || group.type !== 'group' || (group.join !== 'AND' && group.join !== 'OR')) return invalid()
    if (!Array.isArray(group.rules) || group.rules.length === 0) return invalid()
    nodes += group.rules.length
    if (nodes > MAX_RULES) return invalid()
    return {
      type: 'group',
      join: group.join,
      rules: group.rules.map((node: unknown) => {
        if (!isRecord(node)) return invalid()
        if (node.type === 'group') return parseGroup(node, depth + 1)
        if (node.type === 'rule') return parseRule(node, customFields)
        return invalid()
      }),
    }
  }
  return parseGroup(filter, 1)
}

function parseSort(sort: unknown, customFields: readonly CustomFieldReference[]): SortSpec[] {
  if (!Array.isArray(sort) || sort.length > MAX_SORT_LEVELS) return invalid()
  return sort.map((spec: unknown) => {
    if (!isRecord(spec)) return invalid()
    const { field, dir } = spec
    if (typeof field !== 'string' || !isSortField(field) || isCollectionScopedSortField(field) || (dir !== 'asc' && dir !== 'desc')) return invalid()
    const customId = parseCustomSortFieldId(field)
    if (customId !== null && !customFields[customId - 1]) return invalid()
    return { field, dir }
  })
}

export function parseScopeTemplate(text: string): ScopeTemplate {
  if (text.length > MAX_TEMPLATE_BYTES || new TextEncoder().encode(text).byteLength > MAX_TEMPLATE_BYTES) {
    throw new ScopeTransferError('tooLarge')
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return invalid()
  }
  if (!isRecord(value) || value.format !== FORMAT) return invalid()
  if (value.version !== 1) throw new ScopeTransferError('unsupportedVersion')
  const { name, icon, coverAspectRatio } = value
  if (!isName(name) || name.length > 255 || typeof icon !== 'string' || icon.length > ICON_VALUE_MAX_LENGTH) return invalid()
  if (!COVER_ASPECT_RATIOS.some((ratio) => ratio === coverAspectRatio)) return invalid()
  if (!Array.isArray(value.customFields) || value.customFields.length > MAX_RULES) return invalid()
  const customFields = value.customFields.map((ref: unknown): CustomFieldReference => {
    if (!isRecord(ref) || !isName(ref.label) || !CUSTOM_METADATA_FIELD_TYPES.some((type) => type === ref.type)) return invalid()
    return { label: ref.label, type: ref.type as CustomMetadataFieldType }
  })
  return {
    format: FORMAT,
    version: 1,
    name: name.trim(),
    icon: portableIcon(icon),
    coverAspectRatio: normalizeCoverAspectRatio(coverAspectRatio as CoverAspectRatio),
    filter: parseFilter(value.filter, customFields),
    defaultSort: parseSort(value.defaultSort, customFields),
    customFields,
  }
}

function mapRules(group: GroupRule | null, transform: (rule: Rule) => Rule): GroupRule | null {
  if (!group) return null
  return { type: 'group', join: group.join, rules: group.rules.map((rule) => (rule.type === 'group' ? mapRules(rule, transform)! : transform(rule))) }
}

export function scopeUsesCustomFields(scope: Pick<SmartScope, 'filter' | 'defaultSort'>): boolean {
  function hasCustomRule(group: GroupRule): boolean {
    return group.rules.some((rule) => (rule.type === 'group' ? hasCustomRule(rule) : isCustomRuleField(rule.field)))
  }
  return (scope.filter !== null && hasCustomRule(scope.filter)) || scope.defaultSort.some((spec) => parseCustomSortFieldId(spec.field) !== null)
}

export function exportScopeTemplate(scope: SmartScope, fields: readonly CustomMetadataFieldSummary[]): ScopeTemplate {
  const refs = new Map<number, number>()
  const customFields: CustomFieldReference[] = []
  const activeFields = new Map(fields.filter((field) => field.archivedAt === null).map((field) => [field.id, field]))
  function portableField(id: number): number {
    const existing = refs.get(id)
    if (existing !== undefined) return existing
    const field = activeFields.get(id)
    if (!field) throw new ScopeTransferError('missingCustomField')
    const position = customFields.push({ label: field.label, type: field.type })
    refs.set(id, position)
    return position
  }

  const filter = mapRules(scope.filter, (rule) => {
    const id = parseCustomRuleFieldId(rule.field)
    return id === null ? rule : { ...rule, field: customRuleField(portableField(id)) }
  })
  const defaultSort = scope.defaultSort.map((spec) => {
    const id = parseCustomSortFieldId(spec.field)
    return { field: id === null ? spec.field : customSortField(portableField(id)), dir: spec.dir }
  })
  const template: ScopeTemplate = {
    format: FORMAT,
    version: 1,
    name: scope.name,
    icon: portableIcon(scope.icon),
    coverAspectRatio: normalizeCoverAspectRatio(scope.coverAspectRatio),
    filter,
    defaultSort,
    customFields,
  }
  return parseScopeTemplate(serializeScopeTemplate(template))
}

export function serializeScopeTemplate(template: ScopeTemplate): string {
  return JSON.stringify(template, null, 2)
}

export function scopeReferences(template: ScopeTemplate): ScopeReference[] {
  const references = new Map<string, ScopeReference>()
  function addCustomField(id: number) {
    const ref = template.customFields[id - 1]
    if (!ref) return invalid()
    const key = customRuleField(id)
    references.set(key, { key, kind: 'customField', label: ref.label, type: ref.type })
  }
  function collect(group: GroupRule) {
    for (const rule of group.rules) {
      if (rule.type === 'group') {
        collect(rule)
      } else if ((rule.field === 'library' || rule.field === 'collection') && isNameList(rule.value)) {
        for (const label of rule.value) {
          const key = `${rule.field}:${label}`
          references.set(key, { key, kind: rule.field, label })
        }
      } else {
        const id = parseCustomRuleFieldId(rule.field)
        if (id !== null) addCustomField(id)
      }
    }
  }
  if (template.filter) collect(template.filter)
  for (const spec of template.defaultSort) {
    const id = parseCustomSortFieldId(spec.field)
    if (id !== null) addCustomField(id)
  }
  return [...references.values()]
}

function nameOptions(items: ReferenceCatalog['collections']): ReferenceOption[] {
  const counts = new Map<string, number>()
  for (const { name } of items) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts].map(([name, count]) => ({ value: name, label: name, count })).sort((a, b) => a.label.localeCompare(b.label))
}

export function referenceOptions(catalog: ReferenceCatalog) {
  const libraries = nameOptions(catalog.libraries)
  const collections = nameOptions(catalog.collections)
  const customFields = new Map<CustomMetadataFieldType, ReferenceOption[]>()
  for (const type of CUSTOM_METADATA_FIELD_TYPES) {
    const fields = catalog.customFields.filter(({ archivedAt, type: fieldType }) => archivedAt === null && type === fieldType)
    const counts = new Map(nameOptions(fields.map(({ label }) => ({ name: label }))).map(({ label, count }) => [label, count]))
    customFields.set(
      type,
      fields
        .map(({ id, label }) => ({ value: customRuleField(id), label, count: counts.get(label) ?? 1 }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    )
  }
  return (ref: ScopeReference): ReferenceOption[] => {
    if (ref.kind === 'library') return libraries
    if (ref.kind === 'collection') return collections
    return ref.kind === 'customField' ? (customFields.get(ref.type) ?? []) : []
  }
}

export function suggestedMapping(ref: ScopeReference, options: readonly ReferenceOption[]): string {
  return options.find(({ label, count }) => label === ref.label && count === 1)?.value ?? ''
}

export function buildImportedScope(template: ScopeTemplate, name: string, mappings: Mappings): CreateSmartScopePayload {
  function target(key: string): string {
    const value = mappings[key]
    if (!value) return invalid()
    return value
  }
  function localCustomId(field: string): number {
    const id = parseCustomRuleFieldId(target(field))
    return id ?? invalid()
  }
  const filter = mapRules(template.filter, (rule) => {
    if (isCustomRuleField(rule.field)) return { ...rule, field: customRuleField(localCustomId(rule.field)) }
    if ((rule.field === 'library' || rule.field === 'collection') && isNameList(rule.value)) {
      return { ...rule, value: [...new Set(rule.value.map((name) => target(`${rule.field}:${name}`)))] }
    }
    return rule
  })
  return {
    name: name.trim(),
    icon: template.icon,
    coverAspectRatio: template.coverAspectRatio,
    filter,
    defaultSort: template.defaultSort.map((spec) => ({
      field: parseCustomSortFieldId(spec.field) === null ? spec.field : customSortField(localCustomId(spec.field)),
      dir: spec.dir,
    })),
    isPublic: false,
    syncToKobo: false,
  }
}
