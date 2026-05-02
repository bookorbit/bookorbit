import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import BookTableTextCell from '../table/BookTableTextCell.vue'
import BookTableNumberCell from '../table/BookTableNumberCell.vue'
import BookTableRatingCell from '../table/BookTableRatingCell.vue'
import BookTableChipsCell from '../table/BookTableChipsCell.vue'
import BookTableReadStatusCell from '../table/BookTableReadStatusCell.vue'
import BookTableDateCell from '../table/BookTableDateCell.vue'
import BookTableFormatCell from '../table/BookTableFormatCell.vue'
import BookTableProgressCell from '../table/BookTableProgressCell.vue'
import type { BookFileRef, UserBookStatus } from '@bookorbit/types'

vi.mock('@/features/book/composables/useBookStatus', () => ({
  STATUS_OPTIONS: [
    { value: 'unread', label: 'Unread' },
    { value: 'reading', label: 'Reading' },
    { value: 'read', label: 'Read' },
  ],
  STATUS_ICONS: {
    unread: { template: '<span />' },
    reading: { template: '<span />' },
    read: { template: '<span />' },
  },
  STATUS_COLORS: {
    unread: 'text-muted-foreground',
    reading: 'text-blue-500',
    read: 'text-green-500',
  },
}))

const tooltipStubs = {
  Tooltip: {
    name: 'Tooltip',
    template: '<div data-testid="tooltip"><slot /></div>',
  },
  TooltipTrigger: {
    name: 'TooltipTrigger',
    props: ['asChild'],
    template: '<div data-testid="tooltip-trigger"><slot /></div>',
  },
  TooltipContent: {
    name: 'TooltipContent',
    template: '<div data-testid="tooltip-content"><slot /></div>',
  },
}

// Stubs for popover-based chips cell
const chipsStubs = {
  Popover: {
    name: 'Popover',
    props: ['open'],
    emits: ['update:open'],
    template: '<div data-testid="popover" :data-open="String(open ?? false)"><slot /></div>',
  },
  PopoverTrigger: {
    name: 'PopoverTrigger',
    props: ['asChild', 'disabled'],
    template: '<div data-testid="popover-trigger" :data-disabled="String(disabled ?? false)"><slot /></div>',
  },
  PopoverContent: {
    name: 'PopoverContent',
    template: '<div data-testid="popover-content"><slot /></div>',
  },
  ChipInput: {
    name: 'ChipInput',
    props: ['modelValue', 'searchFn', 'placeholder'],
    emits: ['update:modelValue'],
    template: '<div data-testid="chip-input" />',
  },
}

// Stubs for dropdown-based read-status cell
const statusStubs = {
  DropdownMenu: {
    name: 'DropdownMenu',
    props: ['open'],
    emits: ['update:open'],
    template: '<div data-testid="dropdown" :data-open="String(open ?? false)"><slot /></div>',
  },
  DropdownMenuTrigger: {
    name: 'DropdownMenuTrigger',
    props: ['asChild', 'disabled'],
    template: '<div data-testid="dropdown-trigger" :data-disabled="String(disabled ?? false)"><slot /></div>',
  },
  DropdownMenuContent: {
    name: 'DropdownMenuContent',
    template: '<div data-testid="dropdown-content"><slot /></div>',
  },
  DropdownMenuItem: {
    name: 'DropdownMenuItem',
    props: ['class'],
    emits: ['select'],
    template: '<button type="button" @click="$emit(\'select\')"><slot /></button>',
  },
  ChevronDown: {
    name: 'ChevronDown',
    template: '<span data-testid="chevron-down" />',
  },
}

// ─── BookTableTextCell ─────────────────────────────────────────────────────────

describe('BookTableDateCell', () => {
  it('renders dash for null value', () => {
    const wrapper = mount(BookTableDateCell, {
      props: { value: null },
    })
    expect(wrapper.text()).toBe('-')
  })

  it('renders formatted date with day', () => {
    const wrapper = mount(BookTableDateCell, {
      props: { value: '2026-05-04T12:00:00.000Z' },
    })
    expect(wrapper.text()).toContain('May')
    expect(wrapper.text()).toContain('4')
    expect(wrapper.text()).toContain('2026')
  })

  it('renders tooltip with raw date for valid ISO', () => {
    const wrapper = mount(BookTableDateCell, {
      props: { value: '2026-05-04T00:00:00.000Z' },
    })
    expect(wrapper.find('span').attributes('title')).toContain('2026-05-04T00:00:00.000Z')
  })

  it('renders dash for invalid date string', () => {
    const wrapper = mount(BookTableDateCell, {
      props: { value: 'not-a-date' },
    })
    expect(wrapper.text()).toBe('-')
  })
})

describe('BookTableFormatCell', () => {
  function mountFormat(files: BookFileRef[]) {
    return mount(BookTableFormatCell, {
      props: { files },
      global: { stubs: tooltipStubs },
    })
  }

  it('shows dash for empty files', () => {
    const wrapper = mountFormat([])
    expect(wrapper.text()).toBe('-')
  })

  it('shows primary format badge', () => {
    const wrapper = mountFormat([{ id: 1, format: 'epub', role: 'primary', sizeBytes: null }])
    expect(wrapper.text()).toContain('epub')
  })

  it('shows multiple format badges for multiple files', () => {
    const wrapper = mountFormat([
      { id: 1, format: 'epub', role: 'primary', sizeBytes: null },
      { id: 2, format: 'pdf', role: 'secondary', sizeBytes: null },
    ])
    expect(wrapper.text()).toContain('epub')
    expect(wrapper.text()).toContain('pdf')
  })

  it('shows overflow indicator for more than 2 formats', () => {
    const wrapper = mountFormat([
      { id: 1, format: 'epub', role: 'primary', sizeBytes: null },
      { id: 2, format: 'pdf', role: 'secondary', sizeBytes: null },
      { id: 3, format: 'mobi', role: 'secondary', sizeBytes: null },
    ])
    expect(wrapper.text()).toContain('+1')
  })
})

describe('BookTableProgressCell', () => {
  function mountProgress(value: number | null) {
    return mount(BookTableProgressCell, {
      props: { value },
      global: { stubs: tooltipStubs },
    })
  }

  it('clamps value above 100 to 100', () => {
    const wrapper = mountProgress(120)
    expect(wrapper.text()).toContain('100%')
  })

  it('clamps value below 0 to 0', () => {
    const wrapper = mountProgress(-12)
    expect(wrapper.text()).toContain('0%')
  })

  it('shows correct precision while stripping trailing zeros', () => {
    expect(mountProgress(45).text()).toContain('45%')
    expect(mountProgress(45.5).text()).toContain('45.5%')
    expect(mountProgress(45.123).text()).toContain('45.12%')
  })

  it('shows dash for null', () => {
    const wrapper = mountProgress(null)
    expect(wrapper.text()).toBe('-')
  })

  it('has progressbar aria attributes', () => {
    const wrapper = mountProgress(30)
    const progressbar = wrapper.find('[role="progressbar"]')
    expect(progressbar.attributes('aria-valuenow')).toBe('30')
    expect(progressbar.attributes('aria-valuemin')).toBe('0')
    expect(progressbar.attributes('aria-valuemax')).toBe('100')
  })
})

describe('BookTableTextCell', () => {
  it('renders display span with value when inactive', () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello World', isActive: false },
    })
    expect(wrapper.find('span').text()).toBe('Hello World')
    expect(wrapper.find('input').exists()).toBe(false)
  })

  it('renders input when active', () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: true },
    })
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('emits activate on click when not read-only', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: false, isReadOnly: false },
    })
    await wrapper.find('span').trigger('click')
    expect(wrapper.emitted('activate')).toBeTruthy()
  })

  it('does not emit activate on click when read-only', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: false, isReadOnly: true },
    })
    await wrapper.find('span').trigger('click')
    expect(wrapper.emitted('activate')).toBeFalsy()
  })

  it('emits save with trimmed value on Enter', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: true },
    })
    const input = wrapper.find('input')
    await input.setValue('  New Title  ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')?.[0]).toEqual(['New Title'])
  })

  it('emits save with null when cleared on Enter', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: true },
    })
    const input = wrapper.find('input')
    await input.setValue('   ')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')?.[0]).toEqual([null])
  })

  it('emits cancel on Escape', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: true },
    })
    await wrapper.find('input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits navigate next on Tab', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: true },
    })
    await wrapper.find('input').trigger('keydown', { key: 'Tab', shiftKey: false })
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['next'])
  })

  it('emits navigate prev on Shift+Tab', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: true },
    })
    await wrapper.find('input').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['prev'])
  })

  it('emits save on blur', async () => {
    vi.useFakeTimers()
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: true },
    })
    const input = wrapper.find('input')
    await input.setValue('Blurred value')
    await input.trigger('blur')
    vi.runAllTimers()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('save')?.[0]).toEqual(['Blurred value'])
    vi.useRealTimers()
  })

  it('emits cancel instead of save on blur when value is unchanged', async () => {
    vi.useFakeTimers()
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: true },
    })
    await wrapper.find('input').trigger('blur')
    vi.runAllTimers()
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('save')).toBeFalsy()
    expect(wrapper.emitted('cancel')).toBeTruthy()
    vi.useRealTimers()
  })

  it('focuses input when isActive changes to true', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Hello', isActive: false },
    })
    expect(wrapper.find('input').exists()).toBe(false)
    await wrapper.setProps({ isActive: true })
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('renders placeholder dash for null value when not read-only', () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: null, isActive: false, isReadOnly: false },
    })
    expect(wrapper.find('span').text()).toBe('-')
  })

  it('renders placeholder dash for null value when read-only', () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: null, isActive: false, isReadOnly: true },
    })
    expect(wrapper.find('span').text()).toBe('-')
  })

  it('emits row navigation on ArrowUp and ArrowDown', async () => {
    const wrapper = mount(BookTableTextCell, {
      props: { value: 'Book', isActive: true },
    })
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'ArrowUp' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['rowUp'])
    expect(wrapper.emitted('navigate')?.[1]).toEqual(['rowDown'])
  })
})

// ─── BookTableNumberCell ───────────────────────────────────────────────────────

describe('BookTableNumberCell', () => {
  it('renders display value when inactive', () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 42, isActive: false },
    })
    expect(wrapper.find('span').text()).toBe('42')
  })

  it('renders input when active', () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 42, isActive: true },
    })
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('emits save with parsed int on Enter', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 42, isActive: true },
    })
    const input = wrapper.find('input')
    await input.setValue('99')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')?.[0]).toEqual([99])
  })

  it('emits save with null when input is empty', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 42, isActive: true },
    })
    const input = wrapper.find('input')
    await input.setValue('')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')?.[0]).toEqual([null])
  })

  it('emits save with float when allowDecimal is true', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 1, isActive: true, allowDecimal: true },
    })
    const input = wrapper.find('input')
    await input.setValue('1.5')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')?.[0]).toEqual([1.5])
  })

  it('emits cancel on Escape', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 42, isActive: true },
    })
    await wrapper.find('input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits activate on click when not read-only', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 1, isActive: false, isReadOnly: false },
    })
    await wrapper.find('span').trigger('click')
    expect(wrapper.emitted('activate')).toBeTruthy()
  })

  it('does not emit activate when read-only', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 1, isActive: false, isReadOnly: true },
    })
    await wrapper.find('span').trigger('click')
    expect(wrapper.emitted('activate')).toBeFalsy()
  })

  it('renders dash placeholder for null value in editable mode', () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: null, isActive: false, isReadOnly: false },
    })
    expect(wrapper.find('span').text()).toBe('-')
  })

  it('renders dash placeholder for null value in read-only mode', () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: null, isActive: false, isReadOnly: true },
    })
    expect(wrapper.find('span').text()).toBe('-')
  })

  it('emits save on blur', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 10, isActive: true },
    })
    const input = wrapper.find('input')
    await input.setValue('55')
    await input.trigger('blur')
    expect(wrapper.emitted('save')?.[0]).toEqual([55])
  })

  it('emits cancel instead of save on blur when value is unchanged', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 10, isActive: true },
    })
    await wrapper.find('input').trigger('blur')
    expect(wrapper.emitted('save')).toBeFalsy()
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('focuses input when isActive changes to true', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 1, isActive: false },
    })
    await wrapper.setProps({ isActive: true })
    expect(wrapper.find('input').exists()).toBe(true)
  })

  it('emits save with null for non-numeric input', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 1, isActive: true, allowDecimal: true },
    })
    const input = wrapper.find('input')
    await input.setValue('abc')
    await input.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')?.[0]).toEqual([null])
  })

  it('clamps saved values to min and max', async () => {
    const minWrapper = mount(BookTableNumberCell, {
      props: { value: 5, isActive: true, min: 10, max: 20 },
    })
    await minWrapper.find('input').setValue('1')
    await minWrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(minWrapper.emitted('save')?.[0]).toEqual([10])

    const maxWrapper = mount(BookTableNumberCell, {
      props: { value: 5, isActive: true, min: 10, max: 20 },
    })
    await maxWrapper.find('input').setValue('99')
    await maxWrapper.find('input').trigger('keydown', { key: 'Enter' })
    expect(maxWrapper.emitted('save')?.[0]).toEqual([20])
  })

  it('blocks printable non-digit keys when decimals are disabled', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 5, isActive: true, allowDecimal: false },
    })
    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
    wrapper.find('input').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('emits row navigation on ArrowUp and ArrowDown', async () => {
    const wrapper = mount(BookTableNumberCell, {
      props: { value: 5, isActive: true },
    })
    const input = wrapper.find('input')
    await input.trigger('keydown', { key: 'ArrowUp' })
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['rowUp'])
    expect(wrapper.emitted('navigate')?.[1]).toEqual(['rowDown'])
  })
})

// ─── BookTableRatingCell ───────────────────────────────────────────────────────

describe('BookTableRatingCell', () => {
  it('renders 5 star buttons', () => {
    const wrapper = mount(BookTableRatingCell, {
      props: { value: 3 },
    })
    expect(wrapper.findAll('button')).toHaveLength(5)
  })

  it('emits save with clicked star value', async () => {
    const wrapper = mount(BookTableRatingCell, {
      props: { value: null },
    })
    const buttons = wrapper.findAll('button')
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('save')?.[0]).toEqual([3])
  })

  it('emits save with null when clicking the active star (toggle off)', async () => {
    const wrapper = mount(BookTableRatingCell, {
      props: { value: 3 },
    })
    const buttons = wrapper.findAll('button')
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('save')?.[0]).toEqual([null])
  })

  it('does not emit save when read-only', async () => {
    const wrapper = mount(BookTableRatingCell, {
      props: { value: 3, isReadOnly: true },
    })
    await wrapper.findAll('button')[2]!.trigger('click')
    expect(wrapper.emitted('save')).toBeFalsy()
  })

  it('renders accessible group and pressed state', () => {
    const wrapper = mount(BookTableRatingCell, {
      props: { value: 3 },
    })
    expect(wrapper.find('[role="group"]').attributes('aria-label')).toBe('Rating')
    const buttons = wrapper.findAll('button')
    expect(buttons[2]?.attributes('aria-pressed')).toBe('true')
    expect(buttons[2]?.attributes('aria-label')).toBe('Remove rating')
    expect(buttons[3]?.attributes('aria-label')).toBe('Rate 4 out of 5')
  })

  it('supports keyboard interaction', async () => {
    const wrapper = mount(BookTableRatingCell, {
      props: { value: 2 },
    })
    const buttons = wrapper.findAll('button')
    await buttons[1]!.trigger('keydown', { key: 'ArrowRight' })
    await buttons[2]!.trigger('keydown', { key: 'Enter' })
    expect(wrapper.emitted('save')?.[0]).toEqual([3])
  })
})

// ─── BookTableChipsCell ────────────────────────────────────────────────────────

describe('BookTableChipsCell', () => {
  const mountChips = (props: {
    value: string[]
    isActive: boolean
    isReadOnly?: boolean
    searchFn?: (q: string) => Promise<string[]>
    chipActionFn?: (chip: string) => void
  }) => mount(BookTableChipsCell, { props, global: { stubs: chipsStubs } })

  it('renders chips in display mode', () => {
    const wrapper = mountChips({ value: ['Vue', 'React'], isActive: false })
    const spans = wrapper.findAll('span').filter((s) => ['Vue', 'React'].includes(s.text()))
    expect(spans).toHaveLength(2)
  })

  it('shows overflow count for more than 2 chips', () => {
    const wrapper = mountChips({ value: ['a', 'b', 'c', 'd'], isActive: false })
    expect(wrapper.text()).toContain('+2')
  })

  it('renders placeholder when empty and inactive', () => {
    const wrapper = mountChips({ value: [], isActive: false })
    expect(wrapper.find('span').text()).toBe('-')
  })

  it('popover is closed when inactive', () => {
    const wrapper = mountChips({ value: [], isActive: false })
    expect(wrapper.find('[data-testid="popover"]').attributes('data-open')).toBe('false')
  })

  it('popover opens when isActive becomes true', async () => {
    const wrapper = mountChips({ value: [], isActive: false })
    await wrapper.setProps({ isActive: true })
    expect(wrapper.find('[data-testid="popover"]').attributes('data-open')).toBe('true')
  })

  it('popover closes when isActive becomes false', async () => {
    const wrapper = mountChips({ value: ['a'], isActive: true })
    await wrapper.setProps({ isActive: false })
    expect(wrapper.find('[data-testid="popover"]').attributes('data-open')).toBe('false')
  })

  it('emits activate when Popover opens via user interaction', async () => {
    const wrapper = mountChips({ value: [], isActive: false })
    await wrapper.findComponent({ name: 'Popover' }).vm.$emit('update:open', true)
    expect(wrapper.emitted('activate')).toBeTruthy()
  })

  it('emits save with draft when Popover closes while active', async () => {
    const wrapper = mountChips({ value: ['a', 'b'], isActive: true })
    const chipInput = wrapper.findComponent({ name: 'ChipInput' })
    await chipInput.vm.$emit('update:modelValue', ['a', 'b', 'c'])
    await wrapper.findComponent({ name: 'Popover' }).vm.$emit('update:open', false)
    expect(wrapper.emitted('save')?.[0]).toEqual([['a', 'b', 'c']])
  })

  it('emits cancel when Popover closes without changes', async () => {
    const wrapper = mountChips({ value: ['a', 'b'], isActive: true })
    await wrapper.findComponent({ name: 'Popover' }).vm.$emit('update:open', false)
    expect(wrapper.emitted('save')).toBeFalsy()
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits navigate next on Tab keydown in popover content', async () => {
    const wrapper = mountChips({ value: [], isActive: true })
    await wrapper.find('[data-testid="popover-content"]').trigger('keydown', { key: 'Tab', shiftKey: false })
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['next'])
    expect(wrapper.emitted('save')).toBeTruthy()
  })

  it('emits navigate prev on Shift+Tab in popover content', async () => {
    const wrapper = mountChips({ value: [], isActive: true })
    await wrapper.find('[data-testid="popover-content"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['prev'])
  })

  it('passes searchFn prop to ChipInput', () => {
    const searchFn = vi.fn<() => Promise<string[]>>()
    const wrapper = mountChips({ value: [], isActive: true, searchFn })
    const chipInput = wrapper.findComponent({ name: 'ChipInput' })
    expect(chipInput.props('searchFn')).toBe(searchFn)
  })

  it('draft is initialized from value when popover opens', async () => {
    const wrapper = mountChips({ value: ['x', 'y'], isActive: false })
    await wrapper.setProps({ isActive: true })
    const chipInput = wrapper.findComponent({ name: 'ChipInput' })
    expect(chipInput.props('modelValue')).toEqual(['x', 'y'])
  })

  it('popover trigger is disabled when read-only', () => {
    const wrapper = mountChips({ value: [], isActive: false, isReadOnly: true })
    expect(wrapper.find('[data-testid="popover-trigger"]').attributes('data-disabled')).toBe('true')
  })

  it('chips trigger is focusable and has button role when editable', () => {
    const wrapper = mountChips({ value: ['Fantasy'], isActive: false, isReadOnly: false })
    const trigger = wrapper.find('[data-cell-activator="true"]')
    expect(trigger.attributes('role')).toBe('button')
    expect(trigger.attributes('tabindex')).toBe('0')
  })

  it('renders chip buttons and invokes action callback when chipActionFn is provided', async () => {
    const chipActionFn = vi.fn<(chip: string) => void>()
    const wrapper = mountChips({ value: ['Fantasy', 'Epic'], isActive: false, chipActionFn })
    const chipButtons = wrapper.findAll('button')

    expect(chipButtons).toHaveLength(2)
    await chipButtons[0]!.trigger('click')
    expect(chipActionFn).toHaveBeenCalledWith('Fantasy')
  })
})

// ─── BookTableReadStatusCell ───────────────────────────────────────────────────

describe('BookTableReadStatusCell', () => {
  const baseStatus: UserBookStatus = {
    status: 'unread',
    source: 'manual',
    startedAt: null,
    finishedAt: null,
    updatedAt: '2024-01-01T00:00:00Z',
  }

  const mountStatus = (props: { value: UserBookStatus | null; isActive: boolean; isReadOnly?: boolean }) =>
    mount(BookTableReadStatusCell, { props, global: { stubs: statusStubs } })

  it('renders current status label', () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: false })
    expect(wrapper.text()).toContain('Unread')
  })

  it('renders Unread as default when value is null', () => {
    const wrapper = mountStatus({ value: null, isActive: false })
    expect(wrapper.text()).toContain('Unread')
  })

  it('dropdown is closed when inactive', () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: false })
    expect(wrapper.find('[data-testid="dropdown"]').attributes('data-open')).toBe('false')
  })

  it('dropdown opens when isActive becomes true', async () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: false })
    await wrapper.setProps({ isActive: true })
    expect(wrapper.find('[data-testid="dropdown"]').attributes('data-open')).toBe('true')
  })

  it('emits activate when DropdownMenu opens via user interaction', async () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: false })
    await wrapper.findComponent({ name: 'DropdownMenu' }).vm.$emit('update:open', true)
    expect(wrapper.emitted('activate')).toBeTruthy()
  })

  it('emits save when a status item is selected', async () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: true })
    const items = wrapper.findAll('button')
    const readingBtn = items.find((b) => b.text().includes('Reading'))
    await readingBtn!.trigger('click')
    expect(wrapper.emitted('save')?.[0]).toEqual(['reading'])
  })

  it('emits cancel when dropdown closes without a save', async () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: true })
    await wrapper.findComponent({ name: 'DropdownMenu' }).vm.$emit('update:open', false)
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('does not emit cancel after a status is selected', async () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: true })
    const items = wrapper.findAll('button')
    const readBtn = items.find((b) => b.text().includes('Read'))
    await readBtn!.trigger('click')
    await wrapper.findComponent({ name: 'DropdownMenu' }).vm.$emit('update:open', false)
    const cancelCount = wrapper.emitted('cancel')?.length ?? 0
    expect(cancelCount).toBe(0)
  })

  it('emits navigate next on Tab in dropdown content', async () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: true })
    await wrapper.find('[data-testid="dropdown-content"]').trigger('keydown', { key: 'Tab', shiftKey: false })
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['next'])
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits navigate prev on Shift+Tab in dropdown content', async () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: true })
    await wrapper.find('[data-testid="dropdown-content"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(wrapper.emitted('navigate')?.[0]).toEqual(['prev'])
  })

  it('dropdown trigger is not disabled when not read-only', () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: false, isReadOnly: false })
    expect(wrapper.find('[data-testid="dropdown-trigger"]').attributes('data-disabled')).toBe('false')
  })

  it('dropdown trigger is disabled when read-only', () => {
    const wrapper = mountStatus({ value: baseStatus, isActive: false, isReadOnly: true })
    expect(wrapper.find('[data-testid="dropdown-trigger"]').attributes('data-disabled')).toBe('true')
  })
})
