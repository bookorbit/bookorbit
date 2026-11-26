import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, KeepAlive, nextTick, type Ref, type VNode } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import { parseLibraryIdQuery, useLibraryQueryParam } from '../useLibraryQueryParam'

let libraryId!: Ref<number | null>

const GenrePage = defineComponent({
  name: 'GenrePage',
  setup() {
    libraryId = useLibraryQueryParam()
    return () => h('div')
  },
})

async function mountPage(start: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/genres/:id', name: 'genre', component: GenrePage },
      { path: '/elsewhere', name: 'elsewhere', component: { render: () => h('div') } },
    ],
  })
  await router.push(start)
  await router.isReady()
  const Shell = defineComponent({
    setup: () => () => h(RouterView, null, { default: ({ Component }: { Component: VNode }) => h(KeepAlive, null, { default: () => Component }) }),
  })
  mount(Shell, { global: { plugins: [router] } })
  await flushPromises()
  return router
}

describe('parseLibraryIdQuery', () => {
  it('accepts positive integer ids only', () => {
    expect(parseLibraryIdQuery('7')).toBe(7)
    expect(parseLibraryIdQuery('0')).toBeNull()
    expect(parseLibraryIdQuery('2.5')).toBeNull()
    expect(parseLibraryIdQuery('abc')).toBeNull()
    expect(parseLibraryIdQuery(['7'])).toBeNull()
    expect(parseLibraryIdQuery(undefined)).toBeNull()
  })
})

describe('useLibraryQueryParam', () => {
  it('starts on the library the link carried', async () => {
    await mountPage('/genres/1?libraryId=3')

    expect(libraryId.value).toBe(3)
  })

  it('writes a new choice to the query and clears it for every library', async () => {
    const router = await mountPage('/genres/1')

    libraryId.value = 5
    await flushPromises()
    expect(router.currentRoute.value.query.libraryId).toBe('5')

    libraryId.value = null
    await flushPromises()
    expect(router.currentRoute.value.query.libraryId).toBeUndefined()
  })

  it('follows the query of a later visit to a page kept alive', async () => {
    const router = await mountPage('/genres/1?libraryId=3')

    await router.push('/elsewhere')
    await router.push('/genres/1?libraryId=8')
    await flushPromises()
    await nextTick()
    expect(libraryId.value).toBe(8)

    await router.push('/elsewhere')
    await router.push('/genres/1')
    await flushPromises()
    await nextTick()
    expect(libraryId.value).toBeNull()
  })
})
