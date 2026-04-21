import { driver } from 'driver.js'
import type { DriveStep } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useAuth } from '@/features/auth/composables/useAuth'
import { api } from '@/lib/api'

export function useOnboardingTour() {
  const { user, me } = useAuth()

  function isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.innerWidth < 768
  }

  function isTourCompleted(): boolean {
    return user.value?.settings?.onboarding?.tourCompleted === true
  }

  function buildSteps(): DriveStep[] {
    const hasWelcomeCard = document.querySelector('[data-tour="welcome-card"]') !== null

    const firstStep: DriveStep = hasWelcomeCard
      ? {
          element: '[data-tour="welcome-card"]',
          popover: {
            title: 'Your library is empty',
            description: 'Create a library to start organizing and reading your books. Point it to a folder and it will do the rest.',
            side: 'top',
            align: 'center',
          },
        }
      : {
          element: '[data-tour="settings-nav"]',
          popover: {
            title: 'Create your first library',
            description: 'Head to Settings to create your first library and start scanning your books.',
            side: 'right',
            align: 'start',
          },
        }

    const candidates: DriveStep[] = [
      firstStep,
      {
        element: '[data-tour="sidebar-libraries"]',
        popover: {
          title: 'Your libraries live here',
          description: 'Once created, your libraries appear here. Click any library to browse its books.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="sidebar-smartScopes"]',
        popover: {
          title: 'SmartScopes - smart filters',
          description:
            'SmartScopes are saved filter rules that always stay up to date. Define criteria once - like "unread sci-fi" - and browse that slice of your library instantly.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="sidebar-collections"]',
        popover: {
          title: 'Collections - curated lists',
          description:
            'Collections are manual lists you build yourself - great for reading orders, recommendations, or syncing a specific set of books to your Kobo.',
          side: 'right',
          align: 'start',
        },
      },
      {
        element: '[data-tour="global-search"]',
        popover: {
          title: 'Search your collection',
          description: 'Use the search bar to instantly find any book, author, or series across your library.',
          side: 'bottom',
          align: 'start',
        },
      },
      {
        element: '[data-tour="statistics-btn"]',
        popover: {
          title: 'Reading statistics',
          description:
            'Explore 33+ charts covering your reading pace, genre breakdown, session patterns, top authors, and more. Your full reading history at a glance.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="appearance-picker"]',
        popover: {
          title: 'Make it yours',
          description: 'Customize your theme, accent color, and background from the appearance menu.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="upload-button"]',
        popover: {
          title: 'Upload books',
          description: 'Upload books directly from your browser. They land in the Book Dock for metadata review before being added to a library.',
          side: 'bottom',
          align: 'end',
        },
      },
      {
        element: '[data-tour="book-dock-btn"]',
        popover: {
          title: 'Book Dock',
          description: 'Uploaded files wait here. Review metadata, set the target library, then finalize to add them to your collection.',
          side: 'bottom',
          align: 'end',
        },
      },
    ]

    return candidates.filter((step) => document.querySelector(step.element as string) !== null)
  }

  function markCompletedLocally(): void {
    if (!user.value) return
    user.value = {
      ...user.value,
      settings: {
        ...user.value.settings,
        onboarding: { tourCompleted: true },
      },
    }
  }

  function persistCompletion(): void {
    api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { onboarding: { tourCompleted: true } } }),
    }).catch(() => {})
  }

  function startTour(): void {
    const steps = buildSteps()
    if (steps.length === 0) return

    const driverObj = driver({
      showProgress: true,
      progressText: '{{current}} of {{total}}',
      nextBtnText: 'Next',
      prevBtnText: 'Back',
      doneBtnText: 'Done',
      disableActiveInteraction: true,
      onDestroyed: () => {
        markCompletedLocally()
        persistCompletion()
      },
      steps,
    })

    driverObj.drive()
  }

  function maybeStartTour(): void {
    if (isMobileViewport()) return
    if (isTourCompleted()) return
    startTour()
  }

  async function resetTour(): Promise<void> {
    await api('/api/v1/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: { onboarding: { tourCompleted: false } } }),
    })
    await me()
    startTour()
  }

  return { maybeStartTour, startTour, resetTour }
}
