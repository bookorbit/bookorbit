import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import type { ProviderStatus } from '@bookorbit/types'
import MovedProvidersNotice from '../components/MovedProvidersNotice.vue'

function moved(key: string, label: string, inUse: boolean, image: string | null = `ghcr.io/bookorbit/${key}-provider`): ProviderStatus {
  return { key, label, enabled: false, configured: false, source: 'external', movedOut: { image, inUse } }
}

const GOOGLE: ProviderStatus = { key: 'google', label: 'Google Books', enabled: true, configured: true, source: 'builtin' }

describe('MovedProvidersNotice', () => {
  it('says nothing when no moved source is still in use', () => {
    const wrapper = mount(MovedProvidersNotice, { props: { statuses: [GOOGLE, moved('lubimyczytac', 'LubimyCzytac', false)] } })

    expect(wrapper.find('[role="status"]').exists()).toBe(false)
  })

  it('names the image to run for a source that moved, and says a closed source cannot come back', () => {
    const wrapper = mount(MovedProvidersNotice, {
      props: { statuses: [GOOGLE, moved('lubimyczytac', 'LubimyCzytac', true), moved('aladin', 'Aladin', true, null)] },
    })

    const items = wrapper.findAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toContain('LubimyCzytac')
    expect(items[0]!.find('code').text()).toBe('ghcr.io/bookorbit/lubimyczytac-provider')
    expect(items[1]!.text()).toContain('Aladin')
    expect(items[1]!.find('code').exists()).toBe(false)
  })
})
