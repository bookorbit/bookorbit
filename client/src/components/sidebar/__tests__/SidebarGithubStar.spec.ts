import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { h } from 'vue'
import { TooltipProvider } from '@/components/ui/tooltip'
import SidebarGithubStar from '../SidebarGithubStar.vue'

let wrapper: VueWrapper | null = null

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mountStar() {
  return mount(TooltipProvider, {
    props: { delayDuration: 0 },
    slots: { default: () => h(SidebarGithubStar, { isRail: false }) },
    attachTo: document.body,
  })
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  vi.unstubAllGlobals()
})

describe('SidebarGithubStar', () => {
  it('opens the GitHub star popover when clicked', async () => {
    wrapper = mountStar()

    await wrapper.get('button[aria-label="Star on GitHub"]').trigger('click')

    expect(document.body.textContent).toContain('Enjoying BookOrbit?')
    expect(document.body.textContent).toContain('Star BookOrbit on GitHub')
  })

  it('shows the GitHub star tooltip on focus', async () => {
    wrapper = mountStar()

    await wrapper.get('button[aria-label="Star on GitHub"]').trigger('focus')

    expect(document.body.querySelector('[role="tooltip"]')?.textContent).toBe('Star on GitHub')
  })
})
