import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import BulkRenameStatusBadge from '../BulkRenameStatusBadge.vue'
import type { BulkRenameStatus } from '@bookorbit/types'

describe('BulkRenameStatusBadge', () => {
  const cases: { status: BulkRenameStatus; expectedLabel: string; expectedClass: string }[] = [
    { status: 'will_rename', expectedLabel: 'Will Rename', expectedClass: 'bg-primary/15' },
    { status: 'unchanged', expectedLabel: 'Unchanged', expectedClass: 'bg-muted' },
    { status: 'collision', expectedLabel: 'Collision', expectedClass: 'bg-amber-500/15' },
    { status: 'no_pattern', expectedLabel: 'No Pattern', expectedClass: 'bg-muted' },
    { status: 'error', expectedLabel: 'Error', expectedClass: 'bg-destructive/15' },
  ]

  for (const { status, expectedLabel, expectedClass } of cases) {
    it(`renders "${expectedLabel}" for status "${status}"`, () => {
      const wrapper = mount(BulkRenameStatusBadge, { props: { status } })

      expect(wrapper.text()).toBe(expectedLabel)
      expect(wrapper.find('span').classes()).toContain(expectedClass)
    })
  }
})
