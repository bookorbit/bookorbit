import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { ALL_METADATA_FIELDS } from '@bookorbit/types'
import type { FieldPreference, MetadataFetchPreferences, MetadataField } from '@bookorbit/types'
import GlobalPreferencePanel from './GlobalPreferencePanel.vue'

function makePreferences(maxCount: number | null = null): MetadataFetchPreferences {
  const fields = ALL_METADATA_FIELDS.reduce<Record<MetadataField, FieldPreference>>(
    (result, field) => {
      result[field] = {
        enabled: true,
        providers: [],
        mergeStrategy: 'overwriteIfProvided',
      }
      return result
    },
    {} as Record<MetadataField, FieldPreference>,
  )

  return {
    fields,
    options: {
      genres: {
        mode: 'merge',
        blocklist: [],
        maxCount,
      },
      saveProviderIds: true,
    },
  }
}

function mountPanel(preferences = makePreferences()) {
  return mount(GlobalPreferencePanel, {
    props: {
      preferences,
      statuses: [],
      saving: false,
    },
    global: {
      stubs: {
        FieldPreferenceTable: true,
      },
    },
  })
}

function saveButtons(wrapper: ReturnType<typeof mountPanel>) {
  return wrapper.findAll('button').filter((button) => button.text().trim() === 'Save Defaults')
}

describe('GlobalPreferencePanel', () => {
  it('saves a maximum genre count', async () => {
    const wrapper = mountPanel()
    const input = wrapper.get('#genre-max-count')

    expect(input.classes()).toContain('w-24')
    expect(input.classes()).not.toContain('w-full')
    await input.setValue('3')
    await saveButtons(wrapper)[0]!.trigger('click')

    const saved = wrapper.emitted('save')?.[0]?.[0] as MetadataFetchPreferences
    expect(saved.options?.genres.maxCount).toBe(3)
  })

  it('uses an empty maximum as unlimited', async () => {
    const wrapper = mountPanel(makePreferences(3))

    await wrapper.get('#genre-max-count').setValue('')
    await saveButtons(wrapper)[0]!.trigger('click')

    const saved = wrapper.emitted('save')?.[0]?.[0] as MetadataFetchPreferences
    expect(saved.options?.genres.maxCount).toBeNull()
  })

  it('prevents saving an invalid maximum', async () => {
    const wrapper = mountPanel()

    await wrapper.get('#genre-max-count').setValue('0')

    expect(wrapper.get('#genre-max-count').attributes('aria-invalid')).toBe('true')
    expect(wrapper.get('#genre-max-count-error').text()).toContain('1 to 50')
    expect(saveButtons(wrapper).every((button) => button.attributes('disabled') !== undefined)).toBe(true)
  })

  it('exposes genre and provider ID toggles as switches', () => {
    const wrapper = mountPanel()
    const switches = wrapper.findAll('[role="switch"]')

    expect(switches).toHaveLength(2)
    expect(switches[0]!.attributes('aria-checked')).toBe('true')
    expect(switches[1]!.attributes('aria-checked')).toBe('true')
  })
})
