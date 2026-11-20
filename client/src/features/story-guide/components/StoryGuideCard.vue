<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { ArrowUpCircle, Ellipsis, Galaxy, Loader2, Play, RefreshCw, RotateCcw, Sparkles, Trash2, X, XCircle } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatPercent } from '@/i18n/formatters'
import { useStoryGuideStatus } from '../composables/useStoryGuideStatus'
import { storyGuideConfirmation, type StoryGuideConfirmation, type StoryGuideConfirmationChoice } from '../lib/story-guide-confirmation'
import {
  storyGuideActionLabel,
  storyGuideBuiltLine,
  storyGuideBuiltText,
  storyGuideEstimateLine,
  storyGuideNoticeSentence,
  storyGuidePhaseText,
  storyGuideProgressTitle,
} from '../lib/story-guide-copy'
import { DESTRUCTIVE_STORY_GUIDE_ACTIONS, type StoryGuideAction, type StoryGuidePhase } from '../lib/story-guide-presentation'
import StoryGuideConfirmDialog from './StoryGuideConfirmDialog.vue'

const props = defineProps<{ bookId: number }>()

const { t } = useI18n()
const headingId = useId()

const { status, presentation, pending, perform } = useStoryGuideStatus(() => props.bookId)

const confirming = ref<StoryGuideConfirmation | null>(null)
const busyChoice = ref<string | null>(null)
const menuTrigger = ref<HTMLButtonElement | null>(null)
/** The control that asked: focus goes back there when the confirmation closes. */
const opener = ref<HTMLElement | null>(null)

// A confirmation belongs to the book it was asked on; another book's page drops it unanswered.
watch(
  () => props.bookId,
  () => {
    confirming.value = null
  },
)

const builtText = computed(() => (presentation.value.builtNote ? storyGuideBuiltText(presentation.value.builtNote) : null))
/** A built guide with nothing else to show gets a status row; beside other rows it stays a footnote. */
const builtLine = computed(() =>
  presentation.value.rows.length === 0 && presentation.value.builtNote ? storyGuideBuiltLine(presentation.value.builtNote) : null,
)
const builtModels = computed(() => presentation.value.builtNote?.models ?? [])
const shown = computed(() => presentation.value.rows.length > 0 || presentation.value.menu.length > 0 || builtText.value !== null)
const busy = computed(() => pending.value !== null)

const ICONS = {
  build: Sparkles,
  update: ArrowUpCircle,
  rebuild: RotateCcw,
  retry: RefreshCw,
  keepBuilding: Play,
  resume: Play,
  cancelBuild: XCircle,
  dismiss: X,
  delete: Trash2,
} as const

function isDestructive(action: StoryGuideAction): boolean {
  return DESTRUCTIVE_STORY_GUIDE_ACTIONS.has(action)
}

function phaseText(phase: StoryGuidePhase): string {
  return storyGuidePhaseText(phase)
}

function percent(fraction: number): number {
  return Math.round(fraction * 100)
}

function progressLabel(fraction: number): string {
  return formatPercent(fraction)
}

/** Asks first when the action has a confirmation; Try again and Dismiss go straight through. */
function request(action: StoryGuideAction, from: HTMLElement | null) {
  const confirmation = storyGuideConfirmation(action, status.value)
  if (!confirmation) {
    void perform(action)
    return
  }
  opener.value = from
  confirming.value = confirmation
}

function control(event: Event): HTMLElement | null {
  return event.currentTarget instanceof HTMLElement ? event.currentTarget : null
}

/** A menu item is gone once the menu closes, so its confirmation hands focus back to the menu button. */
function handleMenuAction(action: StoryGuideAction) {
  request(action, menuTrigger.value)
}

function handleRowAction(action: StoryGuideAction, event: Event) {
  request(action, control(event))
}

function handleBuild(event: Event) {
  request('build', control(event))
}

function handleUpdate(event: Event) {
  request('update', control(event))
}

/** The control that asked, or the menu button when a finished action took that control away. */
function returnFocus(): HTMLElement | null {
  if (opener.value?.isConnected) return opener.value
  return menuTrigger.value?.isConnected ? menuTrigger.value : null
}

async function handleChoice(choice: StoryGuideConfirmationChoice) {
  if (!choice.action) return
  busyChoice.value = choice.id
  try {
    await perform(choice.action, choice.fixes)
  } finally {
    busyChoice.value = null
    confirming.value = null
  }
}

function handleCloseConfirmation() {
  confirming.value = null
}
</script>

<template>
  <section v-if="shown" class="rounded-xl border border-border bg-card px-3.5 py-3" :aria-labelledby="headingId" data-testid="story-guide-card">
    <div class="flex min-h-5 items-center gap-2">
      <h3 :id="headingId" class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {{ t('book.detail.storyGuide.title') }}
      </h3>
      <DropdownMenu v-if="presentation.menu.length > 0">
        <DropdownMenuTrigger as-child>
          <button
            ref="menuTrigger"
            type="button"
            class="-my-1 -me-1.5 ms-auto inline-flex size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            :aria-label="t('book.detail.storyGuide.menu')"
            :disabled="busy"
            data-testid="story-guide-menu"
          >
            <Ellipsis class="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-48">
          <DropdownMenuItem
            v-for="action in presentation.menu"
            :key="action"
            :variant="isDestructive(action) ? 'destructive' : 'default'"
            :data-action="action"
            @select="handleMenuAction(action)"
          >
            <component :is="ICONS[action]" aria-hidden="true" />
            {{ storyGuideActionLabel(action) }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div v-if="presentation.rows.length > 0" class="mt-2 flex flex-col gap-3">
      <template v-for="row in presentation.rows" :key="row.kind">
        <div v-if="row.kind === 'buildCard'" data-testid="story-guide-build-card">
          <p class="text-[13px] leading-snug text-muted-foreground">{{ t('book.detail.storyGuide.cardSummary') }}</p>
          <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <Button size="sm" :disabled="busy" data-testid="story-guide-build" @click="handleBuild">
              <Loader2 v-if="pending === 'build'" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <Sparkles v-else aria-hidden="true" />
              {{ t('book.detail.storyGuide.build') }}
            </Button>
            <span
              v-if="storyGuideEstimateLine(row.estimate)"
              class="text-[11px] tabular-nums text-muted-foreground"
              data-testid="story-guide-estimate"
            >
              {{ storyGuideEstimateLine(row.estimate) }}
            </span>
          </div>
        </div>

        <p v-else-if="row.kind === 'checking'" class="flex items-center gap-2 text-[13px] text-muted-foreground" role="status">
          <Loader2 class="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {{ t('book.detail.storyGuide.checking') }}
        </p>

        <div v-else-if="row.kind === 'waiting'" data-testid="story-guide-waiting">
          <p v-if="row.title !== 'storyGuide'" class="text-[13px] font-medium text-foreground">{{ storyGuideProgressTitle(row.title) }}</p>
          <p class="text-[13px] leading-snug" :class="row.title === 'storyGuide' ? 'text-foreground' : 'text-muted-foreground'">
            {{ t('book.detail.storyGuide.waiting') }}
          </p>
          <p v-if="row.ahead !== null" class="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
            {{ t('book.detail.storyGuide.ahead', { count: row.ahead }) }}
          </p>
        </div>

        <div v-else-if="row.kind === 'progress'" data-testid="story-guide-progress">
          <p v-if="row.title !== 'storyGuide'" class="text-[13px] font-medium text-foreground">{{ storyGuideProgressTitle(row.title) }}</p>
          <div class="flex items-baseline gap-3">
            <p class="min-w-0 flex-1 text-[13px] leading-snug text-muted-foreground tabular-nums">{{ phaseText(row.phase) }}</p>
            <p v-if="row.minutesLeft !== null" class="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {{ t('book.detail.storyGuide.minutesLeft', { count: row.minutesLeft }) }}
            </p>
          </div>
          <div
            v-if="row.fraction !== null"
            class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="percent(row.fraction)"
            :aria-valuetext="progressLabel(row.fraction)"
            :aria-label="phaseText(row.phase)"
          >
            <div
              class="h-full rounded-full bg-primary transition-[width] duration-500 motion-reduce:transition-none"
              :style="{ width: `${percent(row.fraction)}%` }"
            />
          </div>
        </div>

        <div v-else-if="row.kind === 'notice'" data-testid="story-guide-notice">
          <p v-if="row.title !== 'storyGuide'" class="text-[13px] font-medium text-foreground">{{ storyGuideProgressTitle(row.title) }}</p>
          <p class="text-[13px] leading-snug text-foreground" role="status">{{ storyGuideNoticeSentence(row.notice) }}</p>
          <p v-if="row.stillTheCase" class="mt-0.5 text-[11px] text-muted-foreground" role="status" data-testid="story-guide-still">
            {{ t('book.detail.storyGuide.stillTheCase') }}
          </p>
          <p v-if="row.settingsHint" class="mt-1 text-[11px] leading-snug" data-testid="story-guide-settings-hint">
            <RouterLink
              :to="{ name: 'settings-admin-ai' }"
              class="text-foreground underline decoration-border underline-offset-2 transition-colors hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {{ t('book.detail.storyGuide.settingsHint') }}
            </RouterLink>
          </p>
          <div v-if="row.actions.length > 0" class="mt-2.5 flex flex-wrap gap-2">
            <Button
              v-for="action in row.actions"
              :key="action"
              size="sm"
              :variant="isDestructive(action) ? 'destructive-outline' : 'outline'"
              :disabled="busy"
              :data-action="action"
              @click="handleRowAction(action, $event)"
            >
              <Loader2 v-if="pending === action" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
              {{ storyGuideActionLabel(action) }}
            </Button>
          </div>
        </div>

        <div v-else-if="row.kind === 'update'" class="flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="story-guide-update">
          <p class="min-w-0 flex-1 text-[13px] leading-snug text-foreground">{{ t('book.detail.storyGuide.updateAvailable') }}</p>
          <Button size="sm" variant="outline" :disabled="busy" @click="handleUpdate">
            <Loader2 v-if="pending === 'update'" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {{ t('book.detail.storyGuide.update') }}
          </Button>
        </div>
      </template>
    </div>

    <template v-if="builtLine">
      <div class="mt-2.5 flex items-center gap-2.5" data-testid="story-guide-built">
        <span
          class="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] bg-primary/14 text-primary ring-1 ring-inset ring-primary/30"
          aria-hidden="true"
        >
          <Galaxy class="size-[17px]" />
        </span>
        <div class="min-w-0">
          <p class="text-[13px] font-semibold leading-tight text-foreground">{{ t('book.detail.storyGuide.readyInApps') }}</p>
          <p class="mt-px text-[11.5px] leading-snug tabular-nums text-muted-foreground">{{ builtLine }}</p>
        </div>
      </div>
      <ul
        v-if="builtModels.length > 0"
        class="mt-2.5 flex flex-wrap gap-1.5 border-t border-border pt-2.5"
        :aria-label="t('book.detail.storyGuide.models')"
        data-testid="story-guide-models"
      >
        <li
          v-for="model in builtModels"
          :key="model"
          class="rounded-md bg-muted px-[7px] py-1 font-mono text-[10.5px] leading-none text-muted-foreground"
        >
          {{ model }}
        </li>
      </ul>
    </template>
    <p
      v-else-if="builtText"
      class="text-muted-foreground"
      :class="presentation.rows.length > 0 ? 'mt-3 border-t border-border pt-2 text-[11px]' : 'mt-1.5 text-[13px] leading-snug'"
      data-testid="story-guide-built"
    >
      {{ builtText }}
    </p>

    <StoryGuideConfirmDialog
      :confirmation="confirming"
      :busy-choice="busyChoice"
      :return-focus="returnFocus"
      @choose="handleChoice"
      @close="handleCloseConfirmation"
    />
  </section>
</template>
