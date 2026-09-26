import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import PodcastAcquisitionField from './PodcastAcquisitionField.vue'

describe('PodcastAcquisitionField', () => {
  it('presents only distinct automatic download policies', () => {
    const wrapper = mountField('remote_only')

    expect(wrapper.findAll('option').map((option) => option.text())).toEqual(['Never', 'New episodes', 'Recent episodes'])
    expect(wrapper.text()).toContain('You can still download individual episodes')
    expect(wrapper.find('option[value="manual"]').exists()).toBe(false)
  })

  it('explains publication-date and storage-retention behavior', () => {
    const wrapper = mountField('window')

    expect(wrapper.text()).toContain('Episodes without a publication date are skipped')
    expect(wrapper.text()).toContain('storage retention can remove unpinned downloads')
    expect(wrapper.get('input').attributes()).toMatchObject({ min: '1', max: '3650', required: '' })
  })
})

function mountField(policy: 'remote_only' | 'window') {
  return mount(PodcastAcquisitionField, {
    props: {
      policy,
      limit: 3,
      windowDays: 30,
      'onUpdate:policy': () => undefined,
      'onUpdate:limit': () => undefined,
      'onUpdate:windowDays': () => undefined,
    },
  })
}
