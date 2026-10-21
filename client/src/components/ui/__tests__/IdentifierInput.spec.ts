import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IdentifierInputKind } from '@bookorbit/types'
import IdentifierInput from '../IdentifierInput.vue'

let wrapper: VueWrapper | undefined

afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
})

function mountInput(kind: IdentifierInputKind, modelValue: string | null = null, attrs: Record<string, unknown> = {}) {
  wrapper = mount(IdentifierInput, {
    props: { kind, modelValue, 'onUpdate:modelValue': (value: string) => wrapper!.setProps({ modelValue: value }) },
    attrs,
    attachTo: document.body,
  })
  return wrapper
}

function field(target: VueWrapper) {
  return target.get<HTMLInputElement>('input')
}

function emitted(target: VueWrapper): string[] {
  return (target.emitted('update:modelValue') ?? []).map(([value]) => value as string)
}

async function typeAt(target: VueWrapper, value: string, caret: number) {
  const input = field(target).element
  input.focus()
  input.value = value
  input.setSelectionRange(caret, caret)
  await field(target).trigger('input')
  return input
}

describe('IdentifierInput', () => {
  it('renders the bound value, and an empty field for null', async () => {
    const target = mountInput('isbn', '9783426226223')
    expect(field(target).element.value).toBe('9783426226223')

    await target.setProps({ modelValue: null })
    expect(field(target).element.value).toBe('')
  })

  it('has no length limit that could cut a pasted identifier', () => {
    const target = mountInput('isbn')
    expect(field(target).attributes('maxlength')).toBeUndefined()
    expect(field(target).attributes('type')).toBe('text')
  })

  it('cleans a pasted hyphenated ISBN instead of truncating it', async () => {
    const target = mountInput('isbn')

    await field(target).setValue('978-3426226223')

    expect(field(target).element.value).toBe('9783426226223')
    expect(emitted(target)).toEqual(['9783426226223'])
  })

  it('cleans an ISBN copied with its Amazon label and invisible characters', async () => {
    const target = mountInput('isbn')

    await field(target).setValue('\u200BISBN-13 : 978-3426226223\u200E')

    expect(field(target).element.value).toBe('9783426226223')
    expect(emitted(target)).toEqual(['9783426226223'])
  })

  it('removes the invisible character copied in front of an ASIN', async () => {
    const target = mountInput('asin')

    await field(target).setValue('\u200Bb00x47zvxm')

    expect(field(target).element.value).toBe('B00X47ZVXM')
    expect(emitted(target)).toEqual(['B00X47ZVXM'])
  })

  it('keeps the punctuation of other provider ids while dropping whitespace', async () => {
    const target = mountInput('provider-id')

    await field(target).setValue(' zyTC-Al_FPjgYC\uFEFF')

    expect(field(target).element.value).toBe('zyTC-Al_FPjgYC')
    expect(emitted(target)).toEqual(['zyTC-Al_FPjgYC'])
  })

  it('shows an over-long value in full so validation can name it', async () => {
    const target = mountInput('isbn')

    await field(target).setValue('978-3426226223-0000')

    expect(field(target).element.value).toBe('97834262262230000')
    expect(emitted(target)).toEqual(['97834262262230000'])
  })

  it('swallows a typed separator without emitting an unchanged value', async () => {
    const target = mountInput('isbn', '978')

    const input = await typeAt(target, '978-', 4)

    expect(input.value).toBe('978')
    expect(input.selectionStart).toBe(3)
    expect(emitted(target)).toEqual([])
  })

  it('keeps the caret after the same character when text is cleaned mid-value', async () => {
    const target = mountInput('isbn', '978226223')

    const input = await typeAt(target, '978-3426-226223', 8)

    expect(input.value).toBe('9783426226223')
    expect(input.selectionStart).toBe(7)
    expect(input.selectionEnd).toBe(7)
  })

  it('leaves the caret alone when nothing needed cleaning', async () => {
    const target = mountInput('isbn', '978')

    const input = await typeAt(target, '9783', 4)

    expect(input.selectionStart).toBe(4)
    expect(emitted(target)).toEqual(['9783'])
  })

  it('emits an empty string when an existing value is cleared', async () => {
    const target = mountInput('isbn', '9783426226223')

    await field(target).setValue('')

    expect(emitted(target)).toEqual([''])
  })

  it('does not turn an empty field into an edit when only separators were typed', async () => {
    const target = mountInput('isbn', null)

    await field(target).setValue('-')

    expect(field(target).element.value).toBe('')
    expect(emitted(target)).toEqual([])
  })

  it('waits for an input method composition to finish before cleaning', async () => {
    const target = mountInput('isbn')
    const input = field(target).element

    input.value = '\uFF19\uFF17\uFF18\uFF0D'
    input.dispatchEvent(new InputEvent('input', { isComposing: true }))
    expect(input.value).toBe('\uFF19\uFF17\uFF18\uFF0D')
    expect(emitted(target)).toEqual([])

    input.dispatchEvent(new CompositionEvent('compositionend'))
    expect(input.value).toBe('978')
    expect(emitted(target)).toEqual(['978'])
  })

  it('reflects a value set from outside, such as an applied metadata match', async () => {
    const target = mountInput('isbn', '')

    await target.setProps({ modelValue: '9780306406157' })

    expect(field(target).element.value).toBe('9780306406157')
  })

  it('passes attributes and listeners through to the input', async () => {
    const onInput = vi.fn<(event: Event) => void>()
    const target = mountInput('isbn', null, { id: 'isbn-field', class: 'font-mono', disabled: true, onInput })

    expect(field(target).attributes('id')).toBe('isbn-field')
    expect(field(target).classes()).toContain('font-mono')
    expect(field(target).element.disabled).toBe(true)

    field(target).element.disabled = false
    await field(target).setValue('978-0')

    expect(onInput).toHaveBeenCalledTimes(1)
    expect(emitted(target)).toEqual(['9780'])
  })
})
