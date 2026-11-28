import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetCollections } from '@/features/collection/composables/useCollections'
import { resetLibraries } from '@/features/library/composables/useLibraries'
import { resetSmartScopes } from '../../composables/useSmartScopes'
import { api } from '@/lib/api'
import ImportSmartScopeDialog from '../ImportSmartScopeDialog.vue'

vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: vi.fn<typeof api>() }))

const template = {
  format: 'bookorbit.smart-scope',
  version: 1,
  name: 'Finished books',
  icon: 'Aperture',
  coverAspectRatio: '1/1',
  filter: {
    type: 'group',
    join: 'OR',
    rules: [
      { type: 'rule', field: 'library', operator: 'includesAny', value: ['Sender library'] },
      {
        type: 'group',
        join: 'AND',
        rules: [
          { type: 'rule', field: 'collection', operator: 'excludesAll', value: ['Shared'] },
          { type: 'rule', field: 'custom:1', operator: 'gte', value: 4 },
        ],
      },
    ],
  },
  defaultSort: [{ field: 'custom:1', dir: 'desc' }],
  customFields: [{ label: 'My score', type: 'number' }],
  isPublic: true,
  syncToKobo: true,
}

function button(label: string) {
  const result = [...document.body.querySelectorAll('button')].find((button) => button.textContent?.trim() === label)
  if (!result) throw new Error(`Button not found: ${label}`)
  return result
}

async function openReview() {
  const wrapper = mount(ImportSmartScopeDialog, { attachTo: document.body, global: { stubs: { AppIcon: true } } })
  await flushPromises()

  const input = document.body.querySelector('textarea')!
  input.value = JSON.stringify(template)
  input.dispatchEvent(new Event('input'))
  await flushPromises()
  button('Review template').click()
  await flushPromises()
  return wrapper
}

function choose(select: HTMLSelectElement, value: string) {
  select.value = value
  select.dispatchEvent(new Event('change'))
}

enableAutoUnmount(afterEach)

describe('ImportSmartScopeDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    resetLibraries()
    resetCollections()
    resetSmartScopes()
    vi.mocked(api).mockImplementation(async (url) => {
      switch (url) {
        case '/api/v1/libraries':
          return Response.json([{ name: 'Recipient library' }])
        case '/api/v1/collections':
          return Response.json([{ name: 'Shared' }, { name: 'Shared' }])
        case '/api/v1/custom-metadata/fields/active':
          return Response.json([
            { id: 1, label: 'Unrelated numeric field', type: 'number', archivedAt: null },
            { id: 10, label: 'My score', type: 'text', archivedAt: null },
            { id: 22, label: 'My score', type: 'number', archivedAt: null },
          ])
        case '/api/v1/books/query':
          return Response.json({ total: 1 })
        case '/api/v1/smart-scopes':
          return Response.json({ id: 93 })
        default:
          throw new Error(`Unexpected request: ${url}`)
      }
    })
  })

  it('requires ambiguous or missing matches and remaps nested rules and sorts before making a private copy', async () => {
    const wrapper = await openReview()

    const [library, collection, customField] = [...document.body.querySelectorAll('select')]
    expect(library?.value).toBe('')
    expect(collection?.value).toBe('')
    expect(customField?.value).toBe('custom:22')
    expect(button('Import copy').disabled).toBe(true)

    choose(library!, 'Recipient library')
    choose(collection!, 'Shared')
    await flushPromises()
    button('Import copy').click()
    await flushPromises()

    const calls = vi.mocked(api).mock.calls
    expect(calls.map(([url]) => url)).toEqual([
      '/api/v1/custom-metadata/fields/active',
      '/api/v1/libraries',
      '/api/v1/collections',
      '/api/v1/books/query',
      '/api/v1/smart-scopes',
    ])
    const payload = JSON.parse(calls.at(-1)?.[1]?.body as string)
    expect(payload).toEqual({
      name: 'Finished books',
      icon: 'Aperture',
      coverAspectRatio: '1/1',
      filter: {
        type: 'group',
        join: 'OR',
        rules: [
          { type: 'rule', field: 'library', operator: 'includesAny', value: ['Recipient library'] },
          {
            type: 'group',
            join: 'AND',
            rules: [
              { type: 'rule', field: 'collection', operator: 'excludesAll', value: ['Shared'] },
              { type: 'rule', field: 'custom:22', operator: 'gte', value: 4 },
            ],
          },
        ],
      },
      defaultSort: [{ field: 'custom:22', dir: 'desc' }],
      isPublic: false,
      syncToKobo: false,
    })
    expect(wrapper.emitted('imported')).toEqual([[93]])
  })

  it('keeps the review open when the server rejects a mapped rule', async () => {
    const wrapper = await openReview()
    const [library, collection] = [...document.body.querySelectorAll('select')]
    choose(library!, 'Recipient library')
    choose(collection!, 'Shared')
    vi.mocked(api).mockResolvedValueOnce(new Response(null, { status: 400 }))
    await flushPromises()
    button('Import copy').click()
    await flushPromises()

    expect(document.body.querySelector('[role=alert]')?.textContent).toContain('could not run the imported rules')
    expect(vi.mocked(api).mock.calls.some(([url]) => url === '/api/v1/smart-scopes')).toBe(false)
    expect(wrapper.emitted('imported')).toBeUndefined()
  })
})
