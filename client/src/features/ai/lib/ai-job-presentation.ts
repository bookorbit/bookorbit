import type { Component } from 'vue'
import { ArrowUpToLine, EyeOff, Pause, Play, RotateCcw, X } from '@lucide/vue'
import type { AiJobQueueAction } from '@bookorbit/types'

/** The order actions are offered in: the step forward first, the way out last. */
export const AI_JOB_ACTION_ORDER: readonly AiJobQueueAction[] = ['resume', 'retry', 'pause', 'prioritize', 'dismiss', 'cancel']

export const AI_JOB_ACTION_ICONS: Record<AiJobQueueAction, Component> = {
  resume: Play,
  retry: RotateCcw,
  pause: Pause,
  prioritize: ArrowUpToLine,
  dismiss: EyeOff,
  cancel: X,
}

export function orderedActions(actions: readonly AiJobQueueAction[]): AiJobQueueAction[] {
  return AI_JOB_ACTION_ORDER.filter((action) => actions.includes(action))
}
