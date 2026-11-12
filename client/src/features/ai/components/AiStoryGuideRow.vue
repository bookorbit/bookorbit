<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { RotateCcw, Trash2 } from '@lucide/vue'
import type { StoryGuideListItem } from '@bookorbit/types'

import { Button } from '@/components/ui/button'
import { formatDateTime, formatRelativeTimeFromNow } from '@/i18n/formatters'
import { formatBytes } from '@/lib/formatting'
import { formatAiDollars, formatBuildTime, modelPairLabel } from '../lib/ai-format'
import AiJobCover from './AiJobCover.vue'

const props = defineProps<{
  item: StoryGuideListItem
  /** Rebuild and Delete act through the book, so they need its permission and a book that still has the text. */
  canAct: boolean
  busy: boolean
}>()

const emit = defineEmits<{ rebuild: [item: StoryGuideListItem]; delete: [item: StoryGuideListItem] }>()

const { t } = useI18n()

const name = computed(() => props.item.title ?? t('aiArea.storyGuides.list.noBook'))
const bookUrl = computed(() => (props.item.bookId === null ? null : `/book/${props.item.bookId}`))
const builtText = computed(() => formatRelativeTimeFromNow(props.item.builtAt, { smallestUnit: 'minute' }))
const builtTitle = computed(() => formatDateTime(new Date(props.item.builtAt)))
const modelsText = computed(() => modelPairLabel(props.item.models?.fast?.model, props.item.models?.careful?.model))
const timeText = computed(() => (props.item.seconds === null ? null : formatBuildTime(props.item.seconds)))
const costText = computed(() => (props.item.cost === null ? null : formatAiDollars(props.item.cost)))
const sizeText = computed(() => formatBytes(props.item.bytes))
const actionable = computed(() => props.canAct && props.item.bookId !== null)

function handleRebuild() {
  emit('rebuild', props.item)
}

function handleDelete() {
  emit('delete', props.item)
}
</script>

<template>
  <tr class="border-t border-border transition-colors first:border-t-0 hover:bg-muted/40" data-testid="ai-story-guide-row" :data-key="item.key">
    <td class="w-[40%] max-w-0 py-1.5 ps-3 pe-3 align-middle max-lg:w-full">
      <div class="flex min-w-0 items-center gap-2.5">
        <AiJobCover :src="item.image" class="h-9 w-6 rounded-xs" :icon-size="12" />
        <div class="min-w-0 flex-1">
          <RouterLink
            v-if="bookUrl"
            :to="bookUrl"
            class="block truncate text-sm font-medium text-foreground underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {{ name }}
          </RouterLink>
          <span v-else class="block truncate text-sm font-medium text-muted-foreground">{{ name }}</span>
          <p class="truncate text-xs text-muted-foreground">
            <span v-if="item.byline">{{ item.byline }}</span>
            <span v-if="item.byline" class="sm:hidden" aria-hidden="true"> · </span>
            <span class="sm:hidden">{{ builtText }}</span>
          </p>
        </div>
      </div>
    </td>
    <td class="py-1.5 pe-3 align-middle text-xs whitespace-nowrap text-muted-foreground max-sm:hidden" :title="builtTitle">{{ builtText }}</td>
    <td class="w-[24%] max-w-0 py-1.5 pe-3 align-middle text-xs text-foreground max-lg:hidden">
      <span v-if="modelsText" class="block truncate" :title="modelsText">{{ modelsText }}</span>
    </td>
    <td class="py-1.5 pe-3 text-end align-middle text-xs whitespace-nowrap text-muted-foreground tabular-nums max-md:hidden">{{ timeText ?? '' }}</td>
    <td class="py-1.5 pe-3 text-end align-middle text-xs whitespace-nowrap text-muted-foreground tabular-nums max-md:hidden">{{ costText ?? '' }}</td>
    <td class="py-1.5 pe-3 text-end align-middle text-xs whitespace-nowrap text-muted-foreground tabular-nums max-xl:hidden">{{ sizeText }}</td>
    <td class="w-px py-1.5 pe-2 align-middle">
      <div v-if="actionable" class="flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          class="size-7"
          :disabled="busy"
          :aria-label="t('aiArea.storyGuides.list.rebuildOn', { name })"
          :title="t('aiArea.storyGuides.list.rebuild')"
          data-testid="ai-story-guide-rebuild"
          @click="handleRebuild"
        >
          <RotateCcw class="size-3.5" aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="size-7 text-destructive hover:text-destructive"
          :disabled="busy"
          :aria-label="t('aiArea.storyGuides.list.deleteOn', { name })"
          :title="t('aiArea.storyGuides.list.delete')"
          data-testid="ai-story-guide-delete"
          @click="handleDelete"
        >
          <Trash2 class="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    </td>
  </tr>
</template>
