import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { BookRequestDownloadItem, BookRequestItem, BookRequestProgressEvent } from '@bookorbit/types'
import RequestPipeline from '../components/RequestPipeline.vue'

type PipelineRequest = Pick<BookRequestItem, 'status' | 'download'>

const DOWNLOAD = { id: 3 } as BookRequestDownloadItem

function render(request: PipelineRequest, compact = false, live: BookRequestProgressEvent | null = null) {
  return mount(RequestPipeline, { props: { request, compact, live } })
}

describe('RequestPipeline', () => {
  it('marks the stage the request is sitting on as the current step', () => {
    const wrapper = render({ status: 'downloading', download: DOWNLOAD })
    const current = wrapper.findAll('li[aria-current="step"]')

    expect(current).toHaveLength(1)
    expect(wrapper.findAll('ol').at(1)?.findAll('li').at(3)?.text()).toBe('Downloading')
  })

  it('states the stage in text so colour is never the only carrier', () => {
    expect(render({ status: 'pending', download: null }).text()).toContain('Waiting at: Approved')
    expect(render({ status: 'available', download: null }).text()).toContain('Filed in your library')
  })

  it('names the stage a failure died on rather than only saying it failed', () => {
    expect(render({ status: 'failed', download: null }).text()).toContain('Release found')
    expect(render({ status: 'failed', download: DOWNLOAD }).text()).toContain('Downloading')
  })

  it('renders five segments and no labels in compact mode', () => {
    const wrapper = render({ status: 'downloading', download: DOWNLOAD }, true)

    expect(wrapper.findAll('li')).toHaveLength(5)
    expect(wrapper.text()).toBe('')
    expect(wrapper.find('ol').attributes('aria-label')).toContain('Downloading')
  })

  it('keeps the accessible summary on the compact bar, which has no visible text at all', () => {
    const wrapper = render({ status: 'pending', download: null }, true)
    expect(wrapper.find('ol').attributes('aria-label')).toBe('Waiting at: Approved')
  })

  it('moves to filing as soon as the matching transfer finishes', () => {
    const live: BookRequestProgressEvent = {
      requestId: 1,
      downloadId: 3,
      status: 'completed',
      progressPercent: 100,
      downloadedBytes: 10,
      totalBytes: 10,
    }
    const wrapper = render({ status: 'downloading', download: { ...DOWNLOAD, status: 'downloading' } }, false, live)
    const current = wrapper.findAll('li[aria-current="step"]')

    expect(current).toHaveLength(1)
    expect(current[0]?.attributes('class')).toContain('shrink-0')
    expect(wrapper.text()).toContain('In progress at: Filed')
  })
})
