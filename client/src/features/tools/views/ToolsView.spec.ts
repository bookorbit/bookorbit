import { defineComponent, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { describe, expect, it } from 'vitest'

import ToolsView from './ToolsView.vue'

const StatefulTool = defineComponent({
  setup() {
    const value = ref('')
    return { value }
  },
  template: '<input v-model="value" aria-label="stateful tool" />',
})

const OtherTool = defineComponent({
  template: '<p>Other tool</p>',
})

describe('ToolsView', () => {
  it('preserves child tool state when switching routes', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: '/tools',
          component: ToolsView,
          children: [
            { path: 'stateful', name: 'stateful-tool', component: StatefulTool },
            { path: 'other', name: 'other-tool', component: OtherTool },
          ],
        },
      ],
    })
    await router.push('/tools/stateful')
    await router.isReady()

    const wrapper = mount(defineComponent({ template: '<RouterView />' }), {
      global: {
        plugins: [router],
        components: { RouterView },
        stubs: { ToolsHeader: true },
      },
    })
    await wrapper.get('input').setValue('preserved')

    await router.push('/tools/other')
    await flushPromises()
    await router.push('/tools/stateful')
    await flushPromises()

    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('preserved')
  })
})
