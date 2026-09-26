import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue'
import { makeListItem, makeShow } from '../test/fixtures'
import { createShowManagementStub, sheetStubs, type PodcastShowManagementStub } from '../test/stubs'
import type { PodcastShowManagement } from '../composables/usePodcastShowManagement'
import PodcastShowManageSheet from './PodcastShowManageSheet.vue'

const ARCHIVED_AT = '2026-08-01T00:00:00.000Z'

function mountSheet(options: { management?: PodcastShowManagementStub; show?: ReturnType<typeof makeShow>; canPurge?: boolean } = {}) {
  const management = options.management ?? createShowManagementStub()
  const wrapper = mount(PodcastShowManageSheet, {
    props: {
      management: management as unknown as PodcastShowManagement,
      show: options.show ?? makeShow(),
      canPurge: options.canPurge ?? true,
    },
    global: { stubs: sheetStubs() },
  })
  return { wrapper, management }
}

describe('PodcastShowManageSheet', () => {
  it('enforces purge permission in the rendered controls', () => {
    const { wrapper } = mountSheet({ canPurge: false })

    expect(wrapper.find('[data-testid="podcast-delete"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Only a library owner with permission to delete podcasts')
  })

  it('archives or restores through the management instance according to current state', async () => {
    const active = mountSheet()
    await active.wrapper.get('[data-testid="podcast-archive"]').trigger('click')
    expect(active.management.archive).toHaveBeenCalledOnce()

    const archived = mountSheet({ show: makeShow({ archivedAt: ARCHIVED_AT }) })
    await archived.wrapper.get('[data-testid="podcast-restore"]').trigger('click')
    expect(archived.management.restore).toHaveBeenCalledOnce()
  })

  it('keeps merge search and selection semantic', async () => {
    const management = createShowManagementStub({ mergeCandidates: ref([makeListItem({ id: 14, title: 'Orbit Archive' })]) })
    const { wrapper } = mountSheet({ management, show: makeShow({ archivedAt: ARCHIVED_AT }) })

    await wrapper.get('input[type="search"]').setValue('orbit')
    await wrapper.get('form').trigger('submit')
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('Orbit Archive'))!
      .trigger('click')

    expect(management.searchMergeCandidates).toHaveBeenCalledWith('orbit')
    expect(management.selectMergeCandidate).toHaveBeenCalledWith(expect.objectContaining({ id: 14 }))
  })

  it('owns typed delete and merge confirmation presentation', () => {
    const management = createShowManagementStub({
      selectedMergeSource: ref(makeListItem({ id: 14, title: 'Orbit Archive' })),
      deletePreview: ref({ files: 2, bytes: 1024 }),
      deleteDescription: ref('Delete four episodes?'),
      deleteNeedsTypedConfirmation: ref(true),
    })
    const { wrapper } = mountSheet({ management, show: makeShow({ archivedAt: ARCHIVED_AT }) })
    const dialogs = wrapper.findAllComponents(ConfirmDialog)

    expect(dialogs[0]?.props()).toMatchObject({ open: true, description: 'Delete four episodes?', confirmationPhrase: 'Orbit Radio' })
    expect(dialogs[1]?.props()).toMatchObject({ open: true, confirmationPhrase: 'Orbit Archive' })
  })
})
