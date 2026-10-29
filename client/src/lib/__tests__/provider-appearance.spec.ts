import { describe, expect, it } from 'vitest'

import { createExternalProviderLinks } from '@/features/book/lib/provider-links'
import { providerIconPathSafe } from '@/features/book/lib/provider-icons'
import { registerProviderAppearance } from '../provider-appearance'
import { getProviderColor, providerChipStyle } from '../provider-colors'

describe('provider appearance', () => {
  it('gives an external provider its own icon and colour once a provider list has named them', () => {
    expect(getProviderColor('fantlab')).toBe('var(--muted-foreground)')
    expect(providerIconPathSafe('fantlab')).toBeNull()

    registerProviderAppearance([{ key: 'fantlab', iconUrl: '/api/v1/metadata-providers/fantlab/icon?v=abc', color: '#2c98cd' }])

    expect(getProviderColor('fantlab')).toBe('#2c98cd')
    expect(providerChipStyle('fantlab')).toEqual({ '--provider-color': '#2c98cd' })
    expect(providerIconPathSafe('fantlab')).toBe('/api/v1/metadata-providers/fantlab/icon?v=abc')
    expect(createExternalProviderLinks({ fantlab: '3104' } as never, { fantlab: 'https://fantlab.ru/work3104' })[0].iconUrl).toBe(
      '/api/v1/metadata-providers/fantlab/icon?v=abc',
    )
  })

  it('never lets an external provider restyle a built-in', () => {
    registerProviderAppearance([{ key: 'goodreads', iconUrl: '/evil.png', color: '#000000' }])
    expect(getProviderColor('goodreads')).toBe('#00d8d1')
    expect(providerIconPathSafe('goodreads')).toBe('/assets/provider-icons/goodreads.svg')
  })

  it('drops an icon and colour the provider no longer declares', () => {
    registerProviderAppearance([{ key: 'mangabaka', iconUrl: '/icon', color: '#e30047' }])
    registerProviderAppearance([{ key: 'mangabaka', iconUrl: null, color: null }])
    expect(getProviderColor('mangabaka')).toBe('var(--muted-foreground)')
    expect(providerIconPathSafe('mangabaka')).toBeNull()
  })
})
