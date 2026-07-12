import { flushPromises, shallowMount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import LibraryCreatorDetails from '../LibraryCreatorDetails.vue'
import LibraryCreatorModal from '../LibraryCreatorModal.vue'

const apiMock = vi.hoisted(() => vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>())

vi.mock('@/lib/api', () => ({ api: apiMock }))

describe('LibraryCreatorModal', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    apiMock.mockReset()
    vi.restoreAllMocks()
  })

  it('renders an accessible responsive dialog with required setup identified', async () => {
    const wrapper = shallowMount(LibraryCreatorModal, {
      attachTo: document.body,
      global: { stubs: { teleport: true } },
    })
    await flushPromises()

    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('library-creator-title')
    expect(wrapper.get('#library-creator-title').text()).toBe('Create a library')
    expect(wrapper.text()).toContain('Required')
    expect(wrapper.get('button[aria-label="Close library creator"]')).toBeTruthy()

    wrapper.unmount()
  })

  it('unlocks the folder step after valid details are entered', async () => {
    const wrapper = shallowMount(LibraryCreatorModal, {
      attachTo: document.body,
      global: { stubs: { teleport: true } },
    })
    await flushPromises()

    const details = wrapper.getComponent(LibraryCreatorDetails)
    details.vm.$emit('update:name', 'Main Library')
    details.vm.$emit('update:icon', 'BookOpen')
    await wrapper.vm.$nextTick()

    const continueButton = wrapper.findAll('button').find((button) => button.text().includes('Continue'))
    expect(continueButton?.attributes('disabled')).toBeUndefined()
    await continueButton?.trigger('click')
    expect(wrapper.text()).toContain('Choose the server folders that contain your books.')

    wrapper.unmount()
  })

  it('shows required-field validation only after continuing', async () => {
    const wrapper = shallowMount(LibraryCreatorModal, {
      attachTo: document.body,
      global: { stubs: { teleport: true } },
    })
    await flushPromises()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    const continueButton = wrapper.findAll('button').find((button) => button.text().includes('Continue'))
    await continueButton?.trigger('click')

    expect(wrapper.get('[role="alert"]').text()).toContain('Enter a library name.')
    wrapper.unmount()
  })
})
