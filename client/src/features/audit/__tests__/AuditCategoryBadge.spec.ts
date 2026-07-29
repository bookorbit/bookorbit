import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AuditCategoryBadge from '../AuditCategoryBadge.vue'

describe('AuditCategoryBadge', () => {
  it.each([
    ['authentication', '--audit-authentication'],
    ['books', '--audit-books'],
    ['users', '--audit-users'],
    ['libraries', '--audit-libraries'],
    ['collections', '--audit-collections'],
    ['integrations', '--audit-integrations'],
    ['settings', '--audit-settings'],
  ] as const)('color-codes the %s event category', (category, token) => {
    const wrapper = mount(AuditCategoryBadge, { props: { category } })

    expect(wrapper.get('span').attributes('class')).toContain(token)
  })
})
