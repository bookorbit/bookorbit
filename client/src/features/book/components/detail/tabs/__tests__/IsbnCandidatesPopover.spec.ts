import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BookIsbnCandidates } from '@bookorbit/types'
import IsbnCandidatesPopover from '../IsbnCandidatesPopover.vue'

vi.mock('@/lib/api', () => ({ api: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>() }))

import { api } from '@/lib/api'

const PopoverStub = defineComponent({
  name: 'PopoverStub',
  props: { open: Boolean },
  emits: ['update:open'],
  template: '<div :data-open="open"><slot /></div>',
})

const candidates: BookIsbnCandidates = {
  readable: true,
  candidates: [
    { isbn13: '9780306406157', isbn10: '0306406152', edition: 'hardcover', context: 'Hardcover ISBN 978-0-306-40615-7' },
    { isbn13: '9791032305690', isbn10: null, edition: 'ebook', context: 'eISBN 979-10-323-0569-0' },
  ],
}

function respond(body: unknown, ok = true) {
  vi.mocked(api).mockResolvedValue({ ok, status: ok ? 200 : 500, json: async () => body } as Response)
}

function mountPopover(props: { isbn13?: string | null; isbn10?: string | null; disabled?: boolean } = {}) {
  return mount(IsbnCandidatesPopover, {
    props: { bookId: 42, isbn13: null, isbn10: null, ...props },
    global: {
      stubs: {
        Popover: PopoverStub,
        PopoverTrigger: { template: '<div><slot /></div>' },
        PopoverContent: { template: '<div><slot /></div>' },
      },
    },
  })
}

async function openPopover(wrapper: ReturnType<typeof mountPopover>) {
  wrapper.findComponent(PopoverStub).vm.$emit('update:open', true)
  await flushPromises()
}

function candidateButtons(wrapper: ReturnType<typeof mountPopover>) {
  return wrapper.findAll('li button')
}

describe('IsbnCandidatesPopover', () => {
  beforeEach(() => {
    vi.mocked(api).mockReset()
  })

  it('reads the book only when opened and lists each printed ISBN', async () => {
    respond(candidates)
    const wrapper = mountPopover()
    expect(api).not.toHaveBeenCalled()

    await openPopover(wrapper)

    expect(api).toHaveBeenCalledWith('/api/v1/books/42/isbn-candidates')
    const buttons = candidateButtons(wrapper)
    expect(buttons).toHaveLength(2)
    expect(buttons[0].text()).toContain('9780306406157')
    expect(buttons[0].text()).toContain('Hardcover')
    expect(buttons[0].text()).toContain('ISBN-10 0306406152')
    expect(buttons[0].text()).toContain('Hardcover ISBN 978-0-306-40615-7')
    expect(buttons[1].text()).toContain('eBook')
    expect(buttons[1].text()).not.toContain('ISBN-10')
  })

  it('confirms when the current ISBN is printed in the book and marks it', async () => {
    respond(candidates)
    const wrapper = mountPopover({ isbn13: '978-0-306-40615-7' })
    await openPopover(wrapper)

    expect(wrapper.get('[role="status"]').text()).toBe('The current ISBN is printed in this book.')
    expect(candidateButtons(wrapper)[0].text()).toContain('Current')
    expect(candidateButtons(wrapper)[1].text()).not.toContain('Current')
  })

  it('matches the current ISBN-10 too', async () => {
    respond(candidates)
    const wrapper = mountPopover({ isbn10: '0306406152' })
    await openPopover(wrapper)
    expect(wrapper.get('[role="status"]').text()).toBe('The current ISBN is printed in this book.')
  })

  it('says when the current ISBN is not printed in the book', async () => {
    respond(candidates)
    const wrapper = mountPopover({ isbn13: '9781635766264' })
    await openPopover(wrapper)
    expect(wrapper.get('[role="status"]').text()).toBe('The current ISBN is not printed in this book.')
  })

  it('emits the chosen ISBN and closes', async () => {
    respond(candidates)
    const wrapper = mountPopover()
    await openPopover(wrapper)

    await candidateButtons(wrapper)[1].trigger('click')

    expect(wrapper.emitted('select')).toEqual([[candidates.candidates[1]]])
    expect(wrapper.findComponent(PopoverStub).props('open')).toBe(false)
  })

  it.each([
    [{ readable: false, candidates: [] }, true, "This file's text cannot be searched for ISBNs."],
    [{ readable: true, candidates: [] }, true, 'No ISBN is printed in this book.'],
    [null, false, 'The book could not be read. Try again.'],
  ])('reports %j without a list', async (body, ok, message) => {
    respond(body, ok)
    const wrapper = mountPopover({ isbn13: '9780306406157' })
    await openPopover(wrapper)

    expect(wrapper.get('[role="status"]').text()).toBe(message)
    expect(candidateButtons(wrapper)).toHaveLength(0)
  })

  it('disables the trigger when the picker cannot be used', () => {
    const wrapper = mountPopover({ disabled: true })
    const trigger = wrapper.get('button[aria-label="Find the ISBNs printed in this book"]')
    expect(trigger.attributes('disabled')).toBeDefined()
  })
})
