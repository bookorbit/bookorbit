<script setup lang="ts">
import type { Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ellipsis, PanelRight } from '@lucide/vue'
import type { BookCardLinkInfo } from '@bookorbit/types'
import { DropdownMenu, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import BookCardFormatStripes from './BookCardFormatStripes.vue'
import BookCardLabel from './BookCardLabel.vue'

export interface CardDockAction {
  icon: Component
  /** Short visible label: Read, Continue, Listen and so on. */
  label: string
  /** Full name for assistive technology and the tooltip. */
  ariaLabel: string
  /** Reading progress (0-100) to tint the segment with, or null when the book is not under way. */
  progress: number | null
  /** The progress as text, shown beside the label on wide covers. */
  progressLabel: string | null
}

withDefaults(
  defineProps<{
    action: CardDockAction
    ownKeys: string[]
    linked?: BookCardLinkInfo | null
    showFormats: boolean
    /** Null leaves title and author to the label row below the cover. */
    title: string | null
    author: string | null
    showMenu: boolean
    menuLabel: string
  }>(),
  { linked: null },
)

const emit = defineEmits<{
  primary: [event: MouseEvent]
  'quick-view': []
  author: [event: MouseEvent]
}>()

const { t } = useI18n()

const coverButtonFocus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cover-chip-foreground'

function handlePrimary(event: MouseEvent) {
  emit('primary', event)
}

function handleQuickView() {
  emit('quick-view')
}

function handleAuthor(event: MouseEvent) {
  emit('author', event)
}
</script>

<template>
  <div class="card-hover-panel relative isolate flex min-w-0 flex-col" data-testid="grid-card-hover-panel">
    <BookCardFormatStripes v-if="showFormats" class="card-hover-panel__formats mb-[clamp(4px,3.2cqi,8px)]" :own-keys="ownKeys" :linked="linked" />

    <template v-if="title !== null">
      <BookCardLabel
        as="p"
        :text="title"
        :lines="2"
        class="card-hover-panel__title min-w-0 text-[clamp(11px,6.4cqi,15px)] leading-[1.2] font-[650] tracking-[-0.005em] text-pretty text-cover-chip-foreground text-shadow-[0_1px_3px_rgb(0_0_0/0.5)]"
        data-testid="grid-card-hover-title"
      />
      <BookCardLabel
        v-if="author"
        :text="author"
        class="card-hover-panel__author mt-0.5 w-full text-[clamp(9.5px,5.2cqi,12px)] leading-[1.3] text-cover-chip-muted-foreground"
        data-testid="grid-card-hover-author"
        @activate="handleAuthor"
      />
    </template>

    <div
      class="mt-[clamp(6px,4.5cqi,11px)] flex h-(--dock-h) items-stretch gap-0.5 rounded-full bg-black/50 p-0.5 ring-1 ring-white/16 ring-inset backdrop-blur-[10px] backdrop-saturate-140"
      data-testid="grid-card-dock"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="relative flex min-w-0 flex-1 items-center overflow-hidden rounded-full bg-primary px-[clamp(5px,3.6cqi,10px)] text-[clamp(10.5px,6cqi,13px)] font-[650] text-primary-foreground transition-[filter] duration-150 hover:brightness-107"
            :class="coverButtonFocus"
            :aria-label="action.ariaLabel"
            data-testid="grid-card-primary-action"
            @click.stop="handlePrimary"
          >
            <span
              v-if="action.progress !== null"
              class="pointer-events-none absolute inset-y-0 start-0 bg-[color-mix(in_oklch,var(--primary-foreground)_14%,transparent)]"
              :style="{ width: `${action.progress}%` }"
              aria-hidden="true"
              data-testid="grid-card-primary-progress"
            />
            <!-- Fit or hide, never truncate: a label or percentage that does not fit on the first line wraps
                 onto a second one, which the fixed height clips, leaving the icon centred on its own. -->
            <span
              class="relative flex h-[1.15em] min-w-0 flex-1 flex-wrap content-start items-center justify-center gap-x-[0.42em] overflow-hidden leading-none"
              aria-hidden="true"
            >
              <component :is="action.icon" class="size-[1.15em] shrink-0" />
              <span class="whitespace-nowrap" data-testid="grid-card-primary-label">{{ action.label }}</span>
              <span
                v-if="action.progressLabel"
                class="ms-auto ps-[0.3em] font-semibold whitespace-nowrap tabular-nums"
                data-testid="grid-card-primary-progress-label"
                >{{ action.progressLabel }}</span
              >
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ action.ariaLabel }}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger as-child>
          <button
            type="button"
            class="card-hover-dock__button grid shrink-0 place-items-center rounded-full text-cover-chip-foreground transition-colors duration-150 hover:bg-white/16"
            :class="coverButtonFocus"
            :aria-label="t('book.actions.quickView')"
            data-testid="grid-card-quick-view"
            @click.stop="handleQuickView"
          >
            <PanelRight class="size-[1em]" aria-hidden="true" />
          </button>
        </TooltipTrigger>
        <TooltipContent>{{ t('book.actions.quickView') }}</TooltipContent>
      </Tooltip>

      <DropdownMenu v-if="showMenu">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="card-hover-dock__button grid shrink-0 place-items-center rounded-full text-cover-chip-foreground transition-colors duration-150 hover:bg-white/16"
            :class="coverButtonFocus"
            :aria-label="menuLabel"
            data-testid="grid-card-dock-menu"
          >
            <Ellipsis class="size-[1em]" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <slot name="menu" />
      </DropdownMenu>
    </div>
  </div>
</template>

<style scoped>
.card-hover-panel {
  --pad: clamp(6px, 5cqi, 12px);
  --fade: clamp(36px, 30cqi, 90px);
  --dock-h: clamp(26px, 17cqi, 36px);
}

/* The scrim belongs to the panel: full strength behind it and fading a fixed distance above, so the
   text holds on white and busy covers while the rest of the art stays undimmed. */
.card-hover-panel::before,
.card-hover-panel::after {
  content: '';
  position: absolute;
  z-index: -1;
  pointer-events: none;
  inset: calc(-1 * var(--fade)) calc(-1 * var(--pad)) calc(-1 * var(--pad));
}

.card-hover-panel::before {
  background: linear-gradient(
    to top,
    rgb(0 0 0 / 0.92) 0%,
    rgb(0 0 0 / 0.84) calc(100% - var(--fade)),
    rgb(0 0 0 / 0.45) calc(100% - var(--fade) * 0.5),
    rgb(0 0 0 / 0.14) calc(100% - var(--fade) * 0.2),
    rgb(0 0 0 / 0) 100%
  );
}

/* Lettering on the cover behind the title is smeared as well as darkened, so it never reads as part of it. */
.card-hover-panel::after {
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  -webkit-mask-image: linear-gradient(to top, #000 calc(100% - var(--fade)), transparent calc(100% - var(--fade) * 0.3));
  mask-image: linear-gradient(to top, #000 calc(100% - var(--fade)), transparent calc(100% - var(--fade) * 0.3));
}

.card-hover-dock__button {
  width: calc(var(--dock-h) - 4px);
  font-size: calc(var(--dock-h) * 0.46);
}

/* Short covers (small squares) trade lines for room, by height rather than width. */
@container (max-height: 140px) {
  .card-hover-panel :deep(.card-hover-panel__title > span) {
    -webkit-line-clamp: 1;
    line-clamp: 1;
  }
  .card-hover-panel :deep(.card-hover-panel__author) {
    display: none;
  }
}

@container (max-height: 120px) {
  .card-hover-panel :deep(.card-hover-panel__formats) {
    display: none;
  }
}
</style>
