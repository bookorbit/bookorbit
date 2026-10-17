import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useFailedFontFaces } from '../useFailedFontFaces'

type Face = { family: string; status: string }

/** jsdom has no FontFaceSet; this one holds faces and raises the two events the composable hears. */
function installFontSet(faces: Face[]) {
  const listeners = new Map<string, Array<() => void>>()
  const set = {
    forEach: (callback: (face: Face) => void) => faces.forEach(callback),
    addEventListener: (type: string, listener: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type: string, listener: () => void) =>
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener),
      ),
    fire: (type: string) => (listeners.get(type) ?? []).forEach((listener) => listener()),
  }
  Object.defineProperty(document, 'fonts', { value: set, configurable: true })
  return set
}

function mountProbe() {
  let state: ReturnType<typeof useFailedFontFaces> | undefined
  mount(
    defineComponent({
      setup() {
        state = useFailedFontFaces()
        return () => h('div')
      },
    }),
  )
  return state!
}

describe('useFailedFontFaces', () => {
  afterEach(() => {
    delete (document as { fonts?: unknown }).fonts
  })

  it('collects the uploaded families the browser refused, and only those', () => {
    installFontSet([
      { family: '"__serverfont_big_caslon"', status: 'error' },
      { family: '__serverfont_courgette', status: 'loaded' },
      { family: '__userfont_georgia', status: 'error' },
      { family: 'Inter Variable', status: 'error' },
    ])

    const { failed } = mountProbe()

    expect([...failed.value]).toEqual(['__serverfont_big_caslon', '__userfont_georgia'])
  })

  it('picks up a face that fails after the page has loaded', async () => {
    const faces: Face[] = [{ family: '__serverfont_outfit', status: 'loading' }]
    const set = installFontSet(faces)
    const { failed } = mountProbe()
    expect(failed.value.size).toBe(0)

    faces[0]!.status = 'error'
    set.fire('loadingerror')
    await nextTick()

    expect([...failed.value]).toEqual(['__serverfont_outfit'])
  })
})
