import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '@/i18n'
import PatternInput from '../PatternInput.vue'

vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: { template: '<div><slot /></div>' },
  TooltipContent: { template: '<div class="tooltip-content"><slot /></div>' },
  TooltipTrigger: { template: '<div><slot /></div>' },
}))

type Props = InstanceType<typeof PatternInput>['$props']

function mountInput(props: Partial<Props> = {}) {
  const wrapper = mount(PatternInput, {
    attachTo: document.body,
    props: {
      id: 'pattern',
      modelValue: '{authors}/{title}',
      lines: true,
      mode: 'book_per_file' as const,
      target: 'upload' as const,
      ...props,
      'onUpdate:modelValue': (value: string) => wrapper.setProps({ modelValue: value }),
    },
  })
  return wrapper
}

type Wrapper = ReturnType<typeof mountInput>

const field = (wrapper: Wrapper) => wrapper.find<HTMLTextAreaElement>('textarea')
const lastEmitted = (wrapper: Wrapper) => wrapper.emitted('update:modelValue')?.at(-1)?.[0]

async function typeAtEnd(wrapper: Wrapper, text: string) {
  const element = field(wrapper).element
  element.value += text
  element.setSelectionRange(element.value.length, element.value.length)
  await field(wrapper).trigger('input')
  await nextTick()
}

beforeEach(() => {
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

describe('PatternInput', () => {
  it('draws each folder level on its own line and keeps the saved pattern free of line breaks', async () => {
    const wrapper = mountInput()
    expect(field(wrapper).element.value).toBe('{authors}/\n{title}')

    await typeAtEnd(wrapper, ' ({year})')

    expect(lastEmitted(wrapper)).toBe('{authors}/{title} ({year})')
  })

  it('starts a new folder on Enter by inserting a slash at the caret', async () => {
    const wrapper = mountInput()
    const element = field(wrapper).element
    element.setSelectionRange(element.value.length, element.value.length)

    await field(wrapper).trigger('keydown', { key: 'Enter' })

    expect(lastEmitted(wrapper)).toBe('{authors}/{title}/')
  })

  it('joins a line to the one above on Backspace by removing the slash between them', async () => {
    const wrapper = mountInput()
    const element = field(wrapper).element
    const lineStart = element.value.indexOf('\n') + 1
    element.setSelectionRange(lineStart, lineStart)

    await field(wrapper).trigger('keydown', { key: 'Backspace' })

    expect(lastEmitted(wrapper)).toBe('{authors}{title}')
  })

  it('suggests tokens after a brace and completes the highlighted one on Enter', async () => {
    const wrapper = mountInput()
    await typeAtEnd(wrapper, ' - {sub')

    const listbox = wrapper.find('[role="listbox"]')
    expect(listbox.exists()).toBe(true)
    expect(field(wrapper).attributes('aria-controls')).toBe(listbox.attributes('id'))
    expect(field(wrapper).attributes('aria-activedescendant')).toBe('pattern-token-0')
    expect(wrapper.emitted('completing')?.at(-1)).toEqual([true])

    await field(wrapper).trigger('keydown', { key: 'Enter' })

    expect(lastEmitted(wrapper)).toBe('{authors}/{title} - {subtitle}')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(wrapper.emitted('completing')?.at(-1)).toEqual([false])
  })

  it('closes the suggestions on Escape and leaves the typed text alone', async () => {
    const wrapper = mountInput()
    await typeAtEnd(wrapper, '{ti')

    await field(wrapper).trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(lastEmitted(wrapper)).toBe('{authors}/{title}{ti')
  })

  it('toggles a folder between always created and skipped when empty from its gutter icon', async () => {
    const wrapper = mountInput({ modelValue: '{authors}/{series}/{title}' })
    const toggle = wrapper.find('button[aria-label="Skip Folder 2 when its value is missing"]')
    expect(toggle.attributes('aria-pressed')).toBe('false')

    await toggle.trigger('click')

    expect(lastEmitted(wrapper)).toBe('{authors}/<{series}/>{title}')
    expect(wrapper.find('button[aria-label="Skip Folder 2 when its value is missing"]').attributes('aria-pressed')).toBe('true')
  })

  it('offers no toggle for a folder with a fallback, the book folder or a read-only field', () => {
    expect(mountInput({ modelValue: '<{authors}|Unknown>/{title}/{title}', mode: 'book_per_folder' }).findAll('button[aria-pressed]')).toHaveLength(0)
    expect(mountInput({ modelValue: '{authors}/{title}', readonly: true }).findAll('button[aria-pressed]')).toHaveLength(0)
  })

  it('keeps a single unsplit line for a download pattern and ignores Enter', async () => {
    const wrapper = mountInput({ modelValue: '{authors}/{title}', mode: null, target: 'download' })
    expect(field(wrapper).element.value).toBe('{authors}/{title}')

    await field(wrapper).trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('update:modelValue')).toBeUndefined()
  })
})
