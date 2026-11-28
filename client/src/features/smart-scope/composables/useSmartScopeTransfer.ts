import { type CustomMetadataFieldSummary, type SmartScope } from '@bookorbit/types'
import { useCollections } from '@/features/collection/composables/useCollections'
import { useLibraries } from '@/features/library/composables/useLibraries'
import { apiJson, apiSend, jsonBody } from '@/lib/api-json'
import {
  buildImportedScope,
  exportScopeTemplate,
  referenceOptions,
  scopeReferences,
  scopeUsesCustomFields,
  serializeScopeTemplate,
  suggestedMapping,
  type ScopeTemplate,
} from '../lib/smart-scope-transfer'
import { useSmartScopes } from './useSmartScopes'

function fetchCustomFields() {
  return apiJson<CustomMetadataFieldSummary[]>('/api/v1/custom-metadata/fields/active', undefined, 'smartScope.transfer.catalogFailed')
}

export async function createShareText(scope: SmartScope): Promise<string> {
  const fields = scopeUsesCustomFields(scope) ? await fetchCustomFields() : []
  return serializeScopeTemplate(exportScopeTemplate(scope, fields))
}

export function useSmartScopeImport() {
  const { libraries, refreshLibraries, error: libraryError } = useLibraries()
  const { collections, refreshCollections, error: collectionError } = useCollections()
  const { createSmartScope } = useSmartScopes()

  async function loadMappings(template: ScopeTemplate) {
    const references = scopeReferences(template)
    const needsLibraries = references.some(({ kind }) => kind === 'library')
    const needsCollections = references.some(({ kind }) => kind === 'collection')
    const needsCustomFields = references.some(({ kind }) => kind === 'customField')
    const [fields] = await Promise.all([
      needsCustomFields ? fetchCustomFields() : [],
      needsLibraries && refreshLibraries(),
      needsCollections && refreshCollections(),
    ])
    if ((needsLibraries && libraryError.value) || (needsCollections && collectionError.value)) throw new Error('Could not load reference catalogs')

    const optionsFor = referenceOptions({
      libraries: needsLibraries ? libraries.value : [],
      collections: needsCollections ? collections.value : [],
      customFields: fields,
    })
    return references.map((reference) => {
      const options = optionsFor(reference)
      return { reference, options, suggestion: suggestedMapping(reference, options) }
    })
  }

  async function importScope(template: ScopeTemplate, name: string, mappings: Record<string, string>) {
    const payload = buildImportedScope(template, name, mappings)
    if (payload.filter) {
      // Let the book query validate and execute the mapped rules before a scope can be saved.
      await apiSend(
        '/api/v1/books/query',
        jsonBody('POST', { filter: payload.filter, sort: payload.defaultSort, pagination: { page: 0, size: 1 } }),
        'smartScope.transfer.validationFailed',
      )
    }
    return createSmartScope(payload)
  }

  return { loadMappings, importScope }
}
