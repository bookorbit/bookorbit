import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'

import type { ChartDrillDownHit, ChartDrillDownTarget } from '../../lib/chart-drill-down'

const chartApi = vi.hoisted(() => ({
  containPixel: vi.fn<(finder: string, value: number[]) => boolean>(() => true),
  convertFromPixel: vi.fn<(finder: { gridIndex: number }, value: number[]) => unknown>(() => [0, 1]),
  dispatchAction: vi.fn<(payload: Record<string, unknown>) => void>(),
  getOption: vi.fn<() => Record<string, unknown>>(() => ({})),
  setCursorStyle: vi.fn<(cursor: string) => void>(),
}))

vi.mock('vue-echarts', async () => {
  const { defineComponent, h } = await import('vue')
  return {
    default: defineComponent({
      name: 'VChart',
      props: ['option'],
      emits: ['click', 'zr:click', 'zr:mousemove'],
      setup(_, { expose }) {
        expose({
          containPixel: chartApi.containPixel,
          convertFromPixel: chartApi.convertFromPixel,
          dispatchAction: chartApi.dispatchAction,
          getOption: chartApi.getOption,
          getZr: () => ({ setCursorStyle: chartApi.setCursorStyle }),
        })
        return () => h('div', { class: 'vchart' })
      },
    }),
  }
})

import ChartDrillDown from '../ChartDrillDown.vue'

const TARGETS: ChartDrillDownTarget[] = [
  { dataIndex: 1, text: 'Fantasy, 2,171 books', to: { name: 'genre-detail', params: { id: 11 } } },
  { dataIndex: 2, text: 'Horror, 40 books', to: { name: 'genre-detail', params: { id: 12 }, query: { libraryId: '3' } } },
  { dataIndex: 3, text: 'Poetry, 9 books', to: { name: 'genre-detail', params: { id: 13 } } },
]

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/statistics', name: 'statistics', component: { template: '<div />' } },
      { path: '/genres/:id', name: 'genre-detail', component: { template: '<div />' } },
    ],
  })
}

async function mountDrillDown(hit: ChartDrillDownHit, option: Record<string, unknown> = {}) {
  const router = makeRouter()
  await router.push('/statistics')
  await router.isReady()
  const push = vi.spyOn(router, 'push')
  const wrapper = mount(ChartDrillDown, {
    props: { option, targets: TARGETS, label: 'Genre Distribution', hit },
    global: { plugins: [router, createPinia()] },
    attachTo: document.body,
  })
  await flushPromises()
  return { wrapper, push, chart: wrapper.findComponent({ name: 'VChart' }) }
}

function pointerDown(element: Element, pointerType: string) {
  const event = new Event('pointerdown', { bubbles: true })
  Object.defineProperty(event, 'pointerType', { value: pointerType })
  element.dispatchEvent(event)
}

function seriesClick(dataIndex: number, event: Event = new MouseEvent('click', { button: 0 })) {
  return { componentType: 'series', seriesIndex: 0, dataIndex, event: { event } }
}

describe('ChartDrillDown', () => {
  let wrapper: Awaited<ReturnType<typeof mountDrillDown>>['wrapper'] | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    chartApi.containPixel.mockReturnValue(true)
    chartApi.convertFromPixel.mockReturnValue([0, 1])
    chartApi.getOption.mockReturnValue({})
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('lists every entry as a link, with one Tab stop for the whole chart', async () => {
    const mounted = await mountDrillDown('item')
    wrapper = mounted.wrapper

    const list = wrapper.find('ul')
    expect(list.attributes('aria-label')).toBe('Genre Distribution')
    const links = wrapper.findAll('a')
    expect(links.map((link) => link.text())).toEqual(['Fantasy, 2,171 books', 'Horror, 40 books', 'Poetry, 9 books'])
    expect(links.map((link) => link.attributes('href'))).toEqual(['/genres/11', '/genres/12?libraryId=3', '/genres/13'])
    expect(links.map((link) => link.attributes('tabindex'))).toEqual(['0', '-1', '-1'])
  })

  it('opens the clicked tile', async () => {
    const mounted = await mountDrillDown('item')
    wrapper = mounted.wrapper

    mounted.chart.vm.$emit('click', seriesClick(2))
    expect(mounted.push).toHaveBeenCalledWith(TARGETS[1]!.to)
  })

  it('ignores clicks off the entries', async () => {
    const mounted = await mountDrillDown('item')
    wrapper = mounted.wrapper

    mounted.chart.vm.$emit('click', { ...seriesClick(2), seriesIndex: 1 })
    mounted.chart.vm.$emit('click', seriesClick(9))
    expect(mounted.push).not.toHaveBeenCalled()
  })

  it('opens a new tab on Ctrl or Cmd click', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const mounted = await mountDrillDown('item')
    wrapper = mounted.wrapper

    mounted.chart.vm.$emit('click', seriesClick(1, new MouseEvent('click', { button: 0, metaKey: true, cancelable: true })))
    expect(open).toHaveBeenCalledWith('/genres/11', '_blank', 'noopener,noreferrer')
    expect(mounted.push).not.toHaveBeenCalled()
    open.mockRestore()
  })

  it('shows the entry on the first tap and opens it on a second tap of the same entry', async () => {
    const mounted = await mountDrillDown('item')
    wrapper = mounted.wrapper
    const root = wrapper.element

    pointerDown(root, 'touch')
    mounted.chart.vm.$emit('click', seriesClick(1))
    expect(mounted.push).not.toHaveBeenCalled()
    expect(chartApi.dispatchAction).toHaveBeenCalledWith({ type: 'showTip', seriesIndex: 0, dataIndex: 1 })

    pointerDown(root, 'touch')
    mounted.chart.vm.$emit('click', seriesClick(2))
    expect(mounted.push).not.toHaveBeenCalled()

    pointerDown(root, 'touch')
    mounted.chart.vm.$emit('click', seriesClick(2))
    expect(mounted.push).toHaveBeenCalledWith(TARGETS[1]!.to)
  })

  it('adds a tap hint to the tooltip only after a touch', async () => {
    const formatter = vi.fn<() => string>(() => '<strong>Fantasy</strong>')
    const mounted = await mountDrillDown('item', { tooltip: { trigger: 'item', formatter } })
    wrapper = mounted.wrapper
    const shown = () => (mounted.chart.props('option') as { tooltip: { formatter: () => string } }).tooltip.formatter()

    expect(shown()).toBe('<strong>Fantasy</strong>')
    pointerDown(wrapper.element, 'touch')
    expect(shown()).toBe('<strong>Fantasy</strong><br/><span style="font-size: 11px">Tap again to open</span>')
  })

  it('opens the row under the pointer on a bar chart, bar or not', async () => {
    const mounted = await mountDrillDown('category')
    wrapper = mounted.wrapper

    chartApi.convertFromPixel.mockReturnValue([1, 2])
    mounted.chart.vm.$emit('zr:click', { offsetX: 300, offsetY: 60, event: new MouseEvent('click', { button: 0 }) })
    expect(mounted.push).toHaveBeenCalledWith(TARGETS[1]!.to)

    mounted.push.mockClear()
    chartApi.containPixel.mockReturnValue(false)
    mounted.chart.vm.$emit('zr:click', { offsetX: 2, offsetY: 2, event: new MouseEvent('click', { button: 0 }) })
    expect(mounted.push).not.toHaveBeenCalled()
  })

  it('opens the row of a clicked axis label and leaves bar clicks to the row handler', async () => {
    const mounted = await mountDrillDown('category')
    wrapper = mounted.wrapper

    mounted.chart.vm.$emit('click', seriesClick(1))
    expect(mounted.push).not.toHaveBeenCalled()

    mounted.chart.vm.$emit('click', { componentType: 'yAxis', targetType: 'axisLabel', dataIndex: 3, event: { event: new MouseEvent('click') } })
    expect(mounted.push).toHaveBeenCalledWith(TARGETS[2]!.to)
  })

  it('shows a pointer over a bar chart row', async () => {
    const mounted = await mountDrillDown('category')
    wrapper = mounted.wrapper

    mounted.chart.vm.$emit('zr:mousemove', { offsetX: 300, offsetY: 60 })
    expect(chartApi.setCursorStyle).toHaveBeenCalledWith('pointer')
  })

  it('moves between entries with the arrow keys, the tooltip following focus', async () => {
    const mounted = await mountDrillDown('item')
    wrapper = mounted.wrapper
    const links = () => wrapper!.findAll('a')

    await links()[0]!.trigger('focus')
    expect(chartApi.dispatchAction).toHaveBeenCalledWith({ type: 'highlight', seriesIndex: 0, dataIndex: 1 })
    expect(chartApi.dispatchAction).toHaveBeenCalledWith({ type: 'showTip', seriesIndex: 0, dataIndex: 1 })

    ;(links()[0]!.element as HTMLElement).focus()
    await links()[0]!.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(links()[1]!.element)
    expect(links().map((link) => link.attributes('tabindex'))).toEqual(['-1', '0', '-1'])
    expect(chartApi.dispatchAction).toHaveBeenCalledWith({ type: 'showTip', seriesIndex: 0, dataIndex: 2 })

    await links()[1]!.trigger('keydown', { key: 'End' })
    expect(document.activeElement).toBe(links()[2]!.element)

    await links()[2]!.trigger('blur')
    expect(chartApi.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' })
  })

  it('scrolls a zoomed chart to bring the focused entry into view', async () => {
    chartApi.getOption.mockReturnValue({ dataZoom: [{ start: 0, end: 50 }] })
    const mounted = await mountDrillDown('category')
    wrapper = mounted.wrapper

    await wrapper.findAll('a')[2]!.trigger('focus')
    expect(chartApi.dispatchAction).toHaveBeenCalledWith({ type: 'dataZoom', dataZoomIndex: 0, startValue: 2, endValue: 3 })
  })
})
