import { defineComponent, h, KeepAlive, nextTick, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePageTitle } from '@/composables/usePageTitle'

const mocks = vi.hoisted(() => ({ route: { matched: [] } as Record<string, unknown> }))

vi.mock('vue-router', () => ({
  useRoute: () => mocks.route,
}))

describe('usePageTitle', () => {
  afterEach(() => {
    document.title = ''
    mocks.route = { matched: [] }
  })

  it('puts its own title back after the page rewrites its query', async () => {
    const route = reactive({ matched: [], path: '/genres/31', fullPath: '/genres/31' })
    mocks.route = route
    const wrapper = mount(
      defineComponent({
        setup() {
          usePageTitle(ref('Fantasy'))
          return () => h('div')
        },
      }),
    )

    route.fullPath = '/genres/31?libraryId=14'
    document.title = 'Genre #31 · BookOrbit'
    await nextTick()

    expect(document.title).toBe('Fantasy · BookOrbit')
    wrapper.unmount()
  })

  it('leaves the title to the next page once the path changes', async () => {
    const route = reactive({ matched: [], path: '/genres/31', fullPath: '/genres/31' })
    mocks.route = route
    const wrapper = mount(
      defineComponent({
        setup() {
          usePageTitle(ref('Fantasy'))
          return () => h('div')
        },
      }),
    )

    route.path = '/authors'
    route.fullPath = '/authors'
    document.title = 'Authors · BookOrbit'
    await nextTick()

    expect(document.title).toBe('Authors · BookOrbit')
    wrapper.unmount()
  })

  it('restores the resolved title when a kept-alive view is reactivated', async () => {
    const active = ref(true)
    const title = ref('Fiction')
    const TitledView = defineComponent({
      name: 'TitledView',
      setup() {
        usePageTitle(title)
        return () => h('div')
      },
    })
    const OtherView = defineComponent({
      name: 'OtherView',
      setup: () => () => h('div'),
    })
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(KeepAlive, null, [h(active.value ? TitledView : OtherView)]),
      }),
    )

    expect(document.title).toBe('Fiction · BookOrbit')

    active.value = false
    await nextTick()
    document.title = 'Library #4 · BookOrbit'

    active.value = true
    await nextTick()

    expect(document.title).toBe('Fiction · BookOrbit')
    wrapper.unmount()
  })

  it('does not let a deactivated view overwrite the active page title', async () => {
    const active = ref(true)
    const title = ref('Fiction')
    const TitledView = defineComponent({
      name: 'TitledView',
      setup() {
        usePageTitle(title)
        return () => h('div')
      },
    })
    const OtherView = defineComponent({
      name: 'OtherView',
      setup: () => () => h('div'),
    })
    const wrapper = mount(
      defineComponent({
        setup: () => () => h(KeepAlive, null, [h(active.value ? TitledView : OtherView)]),
      }),
    )

    active.value = false
    await nextTick()
    document.title = 'Authors · BookOrbit'
    title.value = 'Renamed Fiction'
    await nextTick()

    expect(document.title).toBe('Authors · BookOrbit')
    wrapper.unmount()
  })
})
