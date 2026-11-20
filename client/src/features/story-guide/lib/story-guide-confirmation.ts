import type { StoryGuideFixesChoice, StoryGuideStatus } from '@bookorbit/types'

import { i18n } from '@/i18n'
import { storyGuideDollars, storyGuideEstimateSentence } from './story-guide-copy'
import type { StoryGuideAction } from './story-guide-presentation'

const t = i18n.global.t

/** One button in a confirmation. `cancel` only closes it. */
export interface StoryGuideConfirmationChoice {
  id: string
  label: string
  variant: 'default' | 'destructive' | 'destructive-outline' | 'outline'
  /** What it sends; absent for a button that only closes the dialog. */
  action?: StoryGuideAction
  fixes?: StoryGuideFixesChoice
}

export interface StoryGuideConfirmation {
  title: string
  message: string
  /** A whole sentence of its own under the message: the time, and dollars for admins. */
  estimate: string | null
  /** Stop and delete get the warning mark. */
  destructive: boolean
  choices: StoryGuideConfirmationChoice[]
}

function cancel(label = t('common.cancel')): StoryGuideConfirmationChoice {
  return { id: 'cancel', label, variant: 'outline' }
}

/**
 * What an action asks before it is sent (`ux.md`, Confirmations). Try again and Dismiss ask
 * nothing, so they have none.
 */
export function storyGuideConfirmation(action: StoryGuideAction, status: StoryGuideStatus | null): StoryGuideConfirmation | null {
  switch (action) {
    case 'build':
      return {
        title: t('book.detail.storyGuide.confirm.buildTitle'),
        message: t('book.detail.storyGuide.confirm.buildBody'),
        estimate: storyGuideEstimateSentence(status?.estimate),
        destructive: false,
        choices: [cancel(), { id: 'build', label: t('book.detail.storyGuide.confirm.buildAction'), variant: 'default', action: 'build' }],
      }
    case 'update':
      return {
        title: t('book.detail.storyGuide.confirm.updateTitle'),
        message: t('book.detail.storyGuide.confirm.updateBody'),
        estimate: storyGuideEstimateSentence(status?.updateEstimate),
        destructive: false,
        choices: [cancel(), { id: 'update', label: t('book.detail.storyGuide.confirm.updateAction'), variant: 'default', action: 'update' }],
      }
    case 'rebuild':
      return {
        title: t('book.detail.storyGuide.confirm.rebuildTitle'),
        message: t('book.detail.storyGuide.confirm.rebuildBody'),
        estimate: storyGuideEstimateSentence(status?.estimate),
        destructive: false,
        choices: [cancel(), { id: 'rebuild', label: t('book.detail.storyGuide.confirm.rebuildAction'), variant: 'default', action: 'rebuild' }],
      }
    case 'delete': {
      const state = status?.job?.state
      const jobUnfinished = state !== undefined && state !== 'failed'
      return {
        title: t('book.detail.storyGuide.confirm.deleteTitle'),
        message: jobUnfinished ? t('book.detail.storyGuide.confirm.deleteBodyStopsBuild') : t('book.detail.storyGuide.confirm.deleteBody'),
        estimate: null,
        destructive: true,
        choices: [
          cancel(),
          { id: 'delete-keep', label: t('book.detail.storyGuide.confirm.deleteKeepFixes'), variant: 'destructive', action: 'delete', fixes: 'keep' },
          {
            id: 'delete-all',
            label: t('book.detail.storyGuide.confirm.deleteWithFixes'),
            variant: 'destructive-outline',
            action: 'delete',
            fixes: 'delete',
          },
        ],
      }
    }
    case 'cancelBuild':
      return {
        title: t('book.detail.storyGuide.confirm.cancelTitle'),
        message:
          status?.job?.kind === 'rebuild'
            ? t('book.detail.storyGuide.confirm.cancelBodyRebuild')
            : t('book.detail.storyGuide.confirm.cancelBodyBuild'),
        estimate: null,
        destructive: true,
        choices: [
          cancel(t('book.detail.storyGuide.confirm.keepBuilding')),
          { id: 'cancel-build', label: t('book.detail.storyGuide.actions.cancelBuild'), variant: 'destructive', action: 'cancelBuild' },
        ],
      }
    case 'keepBuilding': {
      const cost = typeof status?.estimate?.cost === 'number' && status.estimate.cost > 0 ? status.estimate.cost : null
      return {
        title: t('book.detail.storyGuide.confirm.continueTitle'),
        // The pause comes at three times the estimate, and the next one as much again further on.
        message:
          cost !== null
            ? t('book.detail.storyGuide.confirm.continueBodyCost', { cost: storyGuideDollars(cost * 3) })
            : t('book.detail.storyGuide.confirm.continueBody'),
        estimate: null,
        destructive: false,
        choices: [
          { id: 'cancel-build', label: t('book.detail.storyGuide.actions.cancelBuild'), variant: 'destructive', action: 'cancelBuild' },
          { id: 'continue', label: t('book.detail.storyGuide.actions.keepBuilding'), variant: 'default', action: 'keepBuilding' },
        ],
      }
    }
    case 'retry':
    case 'resume':
    case 'dismiss':
      return null
  }
}
