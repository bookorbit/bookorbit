import { describe, it, expect, vi } from 'vitest'
import { showAchievementToast } from '../utils/achievementToast'

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn<() => void>() },
}))

vi.mock('canvas-confetti', () => ({
  default: vi.fn<() => void>(),
}))

import { toast } from 'vue-sonner'

describe('showAchievementToast', () => {
  it('shows a success toast for common rarity', () => {
    showAchievementToast('First Steps', 'common')
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('First Steps'),
      expect.objectContaining({ description: 'Achievement Unlocked!', duration: 4000 }),
    )
  })

  it('shows a longer toast for epic rarity', () => {
    showAchievementToast('Centurion', 'epic')
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringContaining('Centurion'),
      expect.objectContaining({ description: 'Achievement Unlocked!', duration: 6000 }),
    )
  })

  it('shows a longer toast for legendary rarity', () => {
    showAchievementToast('Bibliophile', 'legendary')
    expect(toast.success).toHaveBeenCalledWith(expect.stringContaining('Bibliophile'), expect.objectContaining({ duration: 6000 }))
  })
})
