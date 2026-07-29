import { flushPromises, shallowMount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuditAction, AuditResource } from '@bookorbit/types'
import AuditLogPage from '../AuditLogPage.vue'

type ApiResponse = {
  ok: boolean
  status: number
  json: () => Promise<unknown>
}

const apiMock = vi.fn<(input: RequestInfo | URL) => Promise<ApiResponse>>()

vi.mock('@/lib/api', () => ({
  api: (input: RequestInfo | URL) => apiMock(input),
}))

function mountPage() {
  return shallowMount(AuditLogPage, {
    props: { embedded: true },
    global: {
      stubs: {
        AuditActionPicker: {
          props: ['id', 'modelValue'],
          template: '<input :id="id" :value="modelValue" />',
        },
        AuditActorPicker: {
          props: ['actors', 'id', 'modelValue'],
          template: '<input :id="id" :value="modelValue" />',
        },
        AuditCategoryBadge: {
          template: '<span>Books</span>',
        },
        AuditResourcePicker: {
          name: 'AuditResourcePicker',
          props: ['id', 'modelValue'],
          template: '<input :id="id" :value="modelValue" />',
        },
      },
    },
  })
}

describe('AuditLogPage', () => {
  beforeEach(() => {
    apiMock.mockReset()
    apiMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.startsWith('/api/v1/audit-log/actors')) {
        return { ok: true, status: 200, json: async () => [] }
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: 1,
              userId: 7,
              actorUsername: 'reader',
              action: AuditAction.BookBulkDelete,
              resource: 'book',
              resourceId: null,
              description: 'Deleted 3 books',
              ip: null,
              meta: {
                total: 3,
                books: [
                  { id: 1, title: 'Dune' },
                  { id: 2, title: 'Hyperion' },
                  { id: 3, title: 'Kindred' },
                ],
                omitted: 0,
              },
              createdAt: '2026-07-26T00:00:00.000Z',
            },
          ],
          total: 1,
        }),
      }
    })
  })

  it('keeps filters balanced and event rows focused on human-readable summaries', async () => {
    const wrapper = mountPage()
    await flushPromises()

    const filterGrid = wrapper.get('#audit-filters > div')
    expect(filterGrid.classes()).toContain('xl:grid-cols-4')
    expect(wrapper.find('select#audit-action').exists()).toBe(false)
    expect(wrapper.find('select#audit-resource').exists()).toBe(false)
    expect(wrapper.text()).toContain('Event type (what happened)')
    expect(wrapper.text()).toContain('Target type (what was affected)')

    const categoryCell = wrapper.get('tbody tr td:nth-child(3)')
    expect(categoryCell.text()).toContain('Books')

    const eventCell = wrapper.get('tbody tr td:nth-child(4)')
    expect(eventCell.text()).toContain('Deleted 3 books')
    expect(eventCell.text()).not.toContain(AuditAction.BookBulkDelete)
    expect(eventCell.get('p').classes()).toContain('truncate')

    wrapper.findComponent({ name: 'AuditResourcePicker' }).vm.$emit('update:modelValue', AuditResource.Book)
    await flushPromises()

    const targetChip = wrapper.findAll('button').find((button) => button.text().includes('Target type: Book'))
    expect(targetChip?.attributes('class')).toContain('--pill-web')

    wrapper.unmount()
  })
})
