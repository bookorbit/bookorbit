import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { Permission } from '@bookorbit/types'
import { i18n } from '@/i18n'
import ToolsHeader from '../ToolsHeader.vue'

const granted = vi.hoisted(() => new Set<string>())

vi.mock('@/features/auth/composables/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: (name: string) => granted.has(name) }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ name: 'tools-duplicate-books' }),
  useRouter: () => ({ push: vi.fn<(location: unknown) => void>() }),
}))

function sectionLabels(): string[] {
  return mount(ToolsHeader)
    .findAll('button')
    .map((button) => button.text())
}

describe('ToolsHeader', () => {
  beforeEach(() => {
    granted.clear()
  })

  it('offers Duplicate Books to a user who may only merge books, without Missing Resources', () => {
    granted.add(Permission.LibraryMergeBooks)
    const t = i18n.global.t

    expect(sectionLabels()).toEqual([t('tools.header.duplicateBooks')])
  })

  it('offers Duplicate Books and Missing Resources to a user who may delete books', () => {
    granted.add(Permission.LibraryDeleteBooks)
    const t = i18n.global.t

    expect(sectionLabels()).toEqual([t('tools.header.duplicateBooks'), t('tools.header.missingResources')])
  })
})
