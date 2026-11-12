import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as aiApi from '../api/ai.api'
import AiStoryGuidesData from './AiStoryGuidesData.vue'

function clickButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((element) => element.textContent?.trim() === text)
  if (!button) throw new Error(`No button "${text}"`)
  button.click()
}

async function typeCount(value: string) {
  const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input')
  if (!input) throw new Error('No confirmation input')
  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

describe('AiStoryGuidesData', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('shows how many guides are stored and their size', async () => {
    vi.spyOn(aiApi, 'getStoryGuidesSummary').mockResolvedValue({ count: 12, bytes: 420_000 })
    const wrapper = mount(AiStoryGuidesData, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-story-guides-count"]').text()).toMatch(/^12 story guides built, 410(\.2)? kB\.$/)
  })

  it('offers no delete when nothing is stored', async () => {
    vi.spyOn(aiApi, 'getStoryGuidesSummary').mockResolvedValue({ count: 0, bytes: 0 })
    const wrapper = mount(AiStoryGuidesData, { attachTo: document.body })
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-story-guides-count"]').text()).toBe('No story guides built yet.')
    expect(wrapper.find('[data-testid="ai-story-guides-delete"]').exists()).toBe(false)
  })

  it('deletes only after the count is typed, sending the count it showed', async () => {
    const summary = vi
      .spyOn(aiApi, 'getStoryGuidesSummary')
      .mockResolvedValueOnce({ count: 3, bytes: 30_000 })
      .mockResolvedValueOnce({ count: 0, bytes: 0 })
    const remove = vi.spyOn(aiApi, 'deleteAllStoryGuides').mockResolvedValue({ kind: 'deleted', deleted: 3, cancelled: 1 })
    const wrapper = mount(AiStoryGuidesData, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('[data-testid="ai-story-guides-delete"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('3 story guides are deleted for everyone')
    clickButton('Continue')
    await flushPromises()

    clickButton('Delete all')
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()

    await typeCount('3')
    clickButton('Delete all')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith({ fixes: 'keep', count: 3 })
    expect(summary).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('deleted')).toHaveLength(1)
    expect(wrapper.find('[data-testid="ai-story-guides-count"]').text()).toBe('No story guides built yet.')
  })

  it('asks about fixes made for everyone only when there are some, keeping them by default', async () => {
    vi.spyOn(aiApi, 'getStoryGuidesSummary').mockResolvedValue({ count: 3, bytes: 30_000, fixes: 0 })
    const remove = vi.spyOn(aiApi, 'deleteAllStoryGuides').mockResolvedValue({ kind: 'deleted', deleted: 3, cancelled: 0 })
    const wrapper = mount(AiStoryGuidesData, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-testid="ai-story-guides-delete"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[data-testid="ai-story-guides-fixes"]')).toBeNull()
    clickButton('Continue')
    await flushPromises()
    await typeCount('3')
    clickButton('Delete all')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith({ fixes: 'keep', count: 3 })
  })

  it('deletes fixes made for everyone too when that is chosen, and starts each delete from keeping them', async () => {
    vi.spyOn(aiApi, 'getStoryGuidesSummary').mockResolvedValue({ count: 3, bytes: 30_000, fixes: 5 })
    const remove = vi.spyOn(aiApi, 'deleteAllStoryGuides').mockResolvedValue({ kind: 'deleted', deleted: 3, cancelled: 0 })
    const wrapper = mount(AiStoryGuidesData, { attachTo: document.body })
    await flushPromises()

    await wrapper.find('[data-testid="ai-story-guides-delete"]').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('5 fixes have been made for everyone.')
    const choice = (value: string) => document.body.querySelector<HTMLInputElement>(`input[name="story-guide-fixes"][value="${value}"]`)!
    expect(choice('keep').checked).toBe(true)
    choice('delete').click()
    await flushPromises()
    clickButton('Cancel')
    await flushPromises()

    await wrapper.find('[data-testid="ai-story-guides-delete"]').trigger('click')
    await flushPromises()
    expect(choice('keep').checked).toBe(true)
    choice('delete').click()
    await flushPromises()
    clickButton('Continue')
    await flushPromises()
    await typeCount('3')
    clickButton('Delete all')
    await flushPromises()
    expect(remove).toHaveBeenCalledWith({ fixes: 'delete', count: 3 })
  })

  it('reloads the count when it changed and deleted nothing', async () => {
    vi.spyOn(aiApi, 'getStoryGuidesSummary').mockResolvedValueOnce({ count: 3, bytes: 30_000 }).mockResolvedValueOnce({ count: 4, bytes: 40_000 })
    vi.spyOn(aiApi, 'deleteAllStoryGuides').mockResolvedValue({ kind: 'count-changed', count: 4 })
    const wrapper = mount(AiStoryGuidesData, { attachTo: document.body })
    await flushPromises()
    await wrapper.find('[data-testid="ai-story-guides-delete"]').trigger('click')
    await flushPromises()
    clickButton('Continue')
    await flushPromises()
    await typeCount('3')
    clickButton('Delete all')
    await flushPromises()
    expect(wrapper.find('[data-testid="ai-story-guides-count"]').text()).toMatch(/^4 story guides built/)
  })
})
