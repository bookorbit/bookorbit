import { defineComponent, h, KeepAlive, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePageTitle } from '@/composables/usePageTitle'

vi.mock('vue-router', () => ({
  useRoute: () => ({ matched: [] }),
}))

describe('usePageTitle', () => {
  afterEach(() => {
    document.title = ''
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
