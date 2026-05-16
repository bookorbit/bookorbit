import type { AchievementRarity } from '@bookorbit/types'
import { toast } from 'vue-sonner'

const RARITY_EMOJI: Record<AchievementRarity, string> = {
  common: '⭐',
  rare: '💎',
  epic: '🚀',
  legendary: '🏆',
}

const RARITY_RANK: Record<AchievementRarity, number> = {
  common: 0,
  rare: 1,
  epic: 2,
  legendary: 3,
}

const CONFETTI_DURATION_MS: Record<AchievementRarity, number> = {
  common: 3000,
  rare: 3500,
  epic: 1500,
  legendary: 7000,
}

let confettiBatch: AchievementRarity[] = []
let batchTimer: ReturnType<typeof setTimeout> | null = null
let confettiActive = false

export function showAchievementToast(name: string, rarity: AchievementRarity): void {
  const achievementName = name.trim() || 'New achievement'

  toast.success(`${RARITY_EMOJI[rarity]} ${achievementName}`, {
    description: 'Achievement Unlocked!',
    duration: rarity === 'epic' || rarity === 'legendary' ? 6000 : 4000,
  })

  scheduleConfetti(rarity)
}

function scheduleConfetti(rarity: AchievementRarity): void {
  confettiBatch.push(rarity)

  if (batchTimer !== null) clearTimeout(batchTimer)

  batchTimer = setTimeout(() => {
    batchTimer = null

    if (confettiActive) {
      confettiBatch = []
      return
    }

    const best = confettiBatch.reduce((a, b) => (RARITY_RANK[a] >= RARITY_RANK[b] ? a : b))
    confettiBatch = []
    confettiActive = true

    triggerConfetti(best)
    setTimeout(() => {
      confettiActive = false
    }, CONFETTI_DURATION_MS[best])
  }, 300)
}

async function triggerConfetti(rarity: AchievementRarity): Promise<void> {
  try {
    const { default: confetti } = await import('canvas-confetti')

    if (rarity === 'common') {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } })
    } else if (rarity === 'rare') {
      const count = 200
      const origin = { y: 0.7 }
      confetti({ origin, particleCount: Math.floor(count * 0.25), spread: 26, startVelocity: 55 })
      confetti({ origin, particleCount: Math.floor(count * 0.2), spread: 60 })
      confetti({ origin, particleCount: Math.floor(count * 0.35), spread: 100, decay: 0.91, scalar: 0.8 })
      confetti({ origin, particleCount: Math.floor(count * 0.1), spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 })
      confetti({ origin, particleCount: Math.floor(count * 0.1), spread: 120, startVelocity: 45 })
    } else if (rarity === 'epic') {
      const defaults = { spread: 360, ticks: 50, gravity: 0, decay: 0.94, startVelocity: 30 }
      const shoot = () => {
        confetti({ ...defaults, particleCount: 40, scalar: 1.2, shapes: ['star'] })
        confetti({ ...defaults, particleCount: 10, scalar: 0.75, shapes: ['circle'] })
      }
      shoot()
      setTimeout(shoot, 100)
      setTimeout(shoot, 200)
    } else {
      const duration = 6000
      const end = Date.now() + duration
      const randRange = (min: number, max: number) => Math.random() * (max - min) + min
      const interval = setInterval(() => {
        const timeLeft = end - Date.now()
        if (timeLeft <= 0) {
          clearInterval(interval)
          return
        }
        const particleCount = 50 * (timeLeft / duration)
        confetti({ startVelocity: 30, spread: 360, ticks: 60, particleCount, origin: { x: randRange(0.1, 0.3), y: Math.random() - 0.2 } })
        confetti({ startVelocity: 30, spread: 360, ticks: 60, particleCount, origin: { x: randRange(0.7, 0.9), y: Math.random() - 0.2 } })
      }, 250)
    }
  } catch {
    // canvas-confetti not available, skip silently
  }
}
