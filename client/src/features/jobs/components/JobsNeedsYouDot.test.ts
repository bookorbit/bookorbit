import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import type { JobsSummary } from '@bookorbit/types'

const summary = ref<JobsSummary | null>(null)

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: { count?: number }) => `${key}:${params?.count}` }) }))
vi.mock('../composables/useJobsSummary', () => ({ useJobsSummary: () => ({ summary }) }))

const { default: JobsNeedsYouDot } = await import('./JobsNeedsYouDot.vue')

function mountDot() {
  return mount({ components: { JobsNeedsYouDot }, template: '<button><JobsNeedsYouDot description-id="desc" /></button>' })
}

describe('JobsNeedsYouDot', () => {
  it('shows nothing while no job waits on the viewer, failures included', () => {
    summary.value = { running: 2, waiting: 1, needsYou: 0, failed: 3, background: [] }
    expect(mountDot().find('span').exists()).toBe(false)
    summary.value = null
    expect(mountDot().find('span').exists()).toBe(false)
  })

  it('puts a dot on the button and a description for assistive tech while jobs wait on the viewer', () => {
    summary.value = { running: 0, waiting: 0, needsYou: 2, failed: 0, background: [] }
    const wrapper = mountDot()

    expect(wrapper.find('.bg-primary').attributes('aria-hidden')).toBe('true')
    const description = wrapper.find('#desc')
    expect(description.attributes('hidden')).toBeDefined()
    expect(description.text()).toBe('components.sidebar.jobs.needsYou:2')
  })
})
