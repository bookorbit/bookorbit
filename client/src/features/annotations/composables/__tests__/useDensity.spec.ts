import { describe, it, expect, beforeEach } from 'vitest'
import { nextTick } from 'vue'
import { useDensity } from '../useDensity'

const STORAGE_KEY = 'annotations:density'

describe('useDensity', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to comfortable when nothing is stored', () => {
    const { density } = useDensity()
    expect(density.value).toBe('comfortable')
  })

  it('restores a valid stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'compact')
    const { density } = useDensity()
    expect(density.value).toBe('compact')
  })

  it('falls back to comfortable for an unrecognized stored value', () => {
    localStorage.setItem(STORAGE_KEY, 'cozy')
    const { density } = useDensity()
    expect(density.value).toBe('comfortable')
  })

  it('persists changes back to localStorage', async () => {
    const { density } = useDensity()
    density.value = 'compact'
    await nextTick()
    expect(localStorage.getItem(STORAGE_KEY)).toBe('compact')
  })
})
