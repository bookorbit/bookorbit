<script lang="ts">
export type { PodcastStatusKind } from '../lib/podcast-episode-presentation'
</script>

<script setup lang="ts">
import { computed, type Component } from 'vue'
import { AlertCircle, Check, CheckCircle2, Clock3, ListEnd, LoaderCircle, Pause, Volume2, WifiOff } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { PodcastStatusKind } from '../lib/podcast-episode-presentation'

const props = withDefaults(defineProps<{ kind: PodcastStatusKind; compact?: boolean }>(), { compact: false })
const { t } = useI18n()

/** A record rather than a switch: every kind must have an entry, and there is no fallback branch. */
const PRESENTATION: Record<PodcastStatusKind, { icon: Component; labelKey: string; classes: string }> = {
  downloaded: { icon: CheckCircle2, labelKey: 'podcast.status.downloaded', classes: 'text-success' },
  downloadQueued: { icon: Clock3, labelKey: 'podcast.status.downloadQueued', classes: 'text-warning' },
  downloading: { icon: LoaderCircle, labelKey: 'podcast.status.downloading', classes: 'text-info' },
  failed: { icon: AlertCircle, labelKey: 'podcast.status.downloadFailed', classes: 'text-destructive' },
  unavailable: { icon: WifiOff, labelKey: 'podcast.status.unavailable', classes: 'text-destructive' },
  played: { icon: Check, labelKey: 'podcast.status.played', classes: 'text-success' },
  removedFromFeed: { icon: WifiOff, labelKey: 'podcast.status.removedFromFeed', classes: 'text-warning' },
  nowPlaying: { icon: Volume2, labelKey: 'podcast.status.nowPlaying', classes: 'bg-primary/10 text-primary' },
  paused: { icon: Pause, labelKey: 'podcast.status.paused', classes: 'bg-muted text-foreground' },
  inQueue: { icon: ListEnd, labelKey: 'podcast.status.inQueue', classes: 'text-muted-foreground' },
}

const status = computed(() => {
  const presentation = PRESENTATION[props.kind]
  return { icon: presentation.icon, label: t(presentation.labelKey), classes: presentation.classes }
})

const chipClasses = computed(() => [
  status.value.classes,
  props.kind === 'removedFromFeed' ? 'rounded border border-warning/30' : 'rounded-full',
  props.compact ? 'size-6 justify-center p-0' : 'gap-1 px-1.5 py-0.5',
])
</script>

<template>
  <TooltipProvider v-if="compact">
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="inline-flex shrink-0 items-center font-medium" :class="chipClasses">
          <component
            :is="status.icon"
            data-testid="podcast-status-icon"
            class="size-3"
            :class="kind === 'downloading' ? 'animate-spin motion-reduce:animate-none' : ''"
          />
          <span class="sr-only">{{ status.label }}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ status.label }}</TooltipContent>
    </Tooltip>
  </TooltipProvider>
  <span v-else class="inline-flex shrink-0 items-center font-medium" :class="chipClasses">
    <component
      :is="status.icon"
      data-testid="podcast-status-icon"
      class="size-3"
      :class="kind === 'downloading' ? 'animate-spin motion-reduce:animate-none' : ''"
    />
    {{ status.label }}
  </span>
</template>
