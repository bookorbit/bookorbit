import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_RELEASE_TIERS } from '@bookorbit/types'
import type { BookRequestMediaKind, ReleaseTier } from '@bookorbit/types'
import { stubInsecureOriginCrypto, UUID_V4 } from '@/lib/__tests__/insecure-origin'
import ReleaseProfileEditor from './ReleaseProfileEditor.vue'

type Emitted = [BookRequestMediaKind, ReleaseTier[]]

function tier(id: string, name = id): ReleaseTier {
  return { id, name, conditions: {} }
}

function mountEditor(tiers: ReleaseTier[] = []) {
  return mount(ReleaseProfileEditor, { props: { mediaKind: 'ebook', tiers, indexers: [], adapters: [] } })
}

function addTierButton(wrapper: VueWrapper) {
  return wrapper.findAll('button').find((button) => button.text() === 'Add tier')!
}

function lastEmitted(wrapper: VueWrapper): Emitted {
  return wrapper.emitted<Emitted>('update')!.at(-1)!
}

function renderedNames(wrapper: VueWrapper): string[] {
  return wrapper.findAll('input[aria-label="Tier name"]').map((input) => (input.element as HTMLInputElement).value)
}

describe('ReleaseProfileEditor', () => {
  describe('adding a tier', () => {
    it('appends an empty tier named for its position and reports the whole profile', async () => {
      const wrapper = mountEditor([tier('retail', 'Retail')])

      await addTierButton(wrapper).trigger('click')

      expect(lastEmitted(wrapper)).toEqual([
        'ebook',
        [tier('retail', 'Retail'), { id: expect.stringMatching(UUID_V4), name: 'Tier 2', conditions: {} }],
      ])
      expect(renderedNames(wrapper)).toEqual(['Retail', 'Tier 2'])
    })

    it('stops offering another tier once the profile is full', async () => {
      const full = Array.from({ length: MAX_RELEASE_TIERS }, (_, index) => tier(`tier-${index}`))
      const wrapper = mountEditor(full)

      expect(addTierButton(wrapper).attributes('disabled')).toBeDefined()
      await addTierButton(wrapper).trigger('click')
      expect(wrapper.emitted('update')).toBeUndefined()
    })

    /** Issue 1722: a self-hosted install opened over plain HTTP has no `crypto.randomUUID`. */
    describe('on a plain-HTTP origin', () => {
      let insecure: ReturnType<typeof stubInsecureOriginCrypto>

      afterEach(() => insecure.restore())

      it('still adds the tier, with a UUID made from getRandomValues', async () => {
        insecure = stubInsecureOriginCrypto()
        const wrapper = mountEditor()

        await addTierButton(wrapper).trigger('click')

        expect(lastEmitted(wrapper)).toEqual(['ebook', [{ id: expect.stringMatching(UUID_V4), name: 'Tier 1', conditions: {} }]])
        expect(renderedNames(wrapper)).toEqual(['Tier 1'])
        expect(insecure.getRandomValues).toHaveBeenCalledOnce()
      })

      /** Rows are keyed by tier id, so two tiers sharing one would render and edit as one. */
      it('gives every added tier its own id', async () => {
        insecure = stubInsecureOriginCrypto()
        const wrapper = mountEditor()

        for (let click = 0; click < 3; click++) await addTierButton(wrapper).trigger('click')

        const [, tiers] = lastEmitted(wrapper)
        expect(tiers.map((added) => added.name)).toEqual(['Tier 1', 'Tier 2', 'Tier 3'])
        expect(tiers.every((added) => UUID_V4.test(added.id))).toBe(true)
        expect(new Set(tiers.map((added) => added.id)).size).toBe(3)
        expect(renderedNames(wrapper)).toEqual(['Tier 1', 'Tier 2', 'Tier 3'])
      })

      it('lets the added tier be described like any other', async () => {
        insecure = stubInsecureOriginCrypto()
        const wrapper = mountEditor([tier('retail', 'Retail')])
        await addTierButton(wrapper).trigger('click')
        const [, [, added]] = lastEmitted(wrapper)

        const addedRow = wrapper.findAll('ol > li').at(-1)!
        await addedRow
          .findAll('button[aria-pressed]')
          .find((chip) => chip.text() === 'epub')!
          .trigger('click')

        expect(lastEmitted(wrapper)).toEqual(['ebook', [tier('retail', 'Retail'), { ...added, conditions: { formats: ['epub'] } }]])
      })
    })
  })
})
