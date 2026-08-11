import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useEffectiveSeriesCollapse } from '../useEffectiveSeriesCollapse'

describe('useEffectiveSeriesCollapse', () => {
  it('suppresses collapse during selection without changing the saved preference', () => {
    const preference = ref(true)
    const selectionMode = ref(false)
    const effective = useEffectiveSeriesCollapse(preference, selectionMode)

    expect(effective.value).toBe(true)

    selectionMode.value = true

    expect(effective.value).toBe(false)
    expect(preference.value).toBe(true)

    selectionMode.value = false

    expect(effective.value).toBe(true)
    expect(preference.value).toBe(true)
  })

  it('keeps collapse disabled when the saved preference is disabled', () => {
    const preference = ref(false)
    const selectionMode = ref(false)
    const effective = useEffectiveSeriesCollapse(preference, selectionMode)

    selectionMode.value = true
    selectionMode.value = false

    expect(effective.value).toBe(false)
  })

  it('uses the latest saved preference after selection mode exits', () => {
    const preference = ref(true)
    const selectionMode = ref(true)
    const effective = useEffectiveSeriesCollapse(preference, selectionMode)

    preference.value = false
    expect(effective.value).toBe(false)

    selectionMode.value = false
    expect(effective.value).toBe(false)

    preference.value = true
    expect(effective.value).toBe(true)
  })
})
