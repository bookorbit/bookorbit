<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ExternalLink, Loader2, MoreHorizontal, RefreshCw, Trash2 } from '@lucide/vue'
import type { AuthorCoverShape, AuthorSummary } from '@bookorbit/types'
import { formatNumber, formatRelativeFromNow } from '@/i18n/formatters'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import AuthorPortrait from './AuthorPortrait.vue'

const props = withDefaults(
  defineProps<{
    author: AuthorSummary
    shape?: AuthorCoverShape
    selectionMode?: boolean
    selected?: boolean
    canRefresh?: boolean
    canDelete?: boolean
    refreshing?: boolean
    deleting?: boolean
    coverFallback?: boolean
  }>(),
  { shape: 'square', coverFallback: true },
)

const emit = defineEmits<{
  open: [authorId: number]
  select: [event: MouseEvent]
  refresh: [authorId: number]
  delete: [authorId: number]
}>()

const { t } = useI18n()

const bookCountLabel = computed(() => formatNumber(props.author.bookCount))
const lastAdded = computed(() => (props.author.lastAddedAt ? formatRelativeFromNow(new Date(props.author.lastAddedAt)) : ''))

const countLine = computed(() => t('author.index.bookCount', { count: props.author.bookCount }))

const accessibleLabel = computed(() => t('author.index.rowLabel', { name: props.author.name, count: props.author.bookCount }))

const menuOpen = ref(false)
/**
 * A circle inscribed in the tile meets its corner diagonal at ~14.6% of the width,
 * so on a circular tile the badges move inwards to sit on the arc rather than
 * floating in the empty corner beside it.
 */
const badgeInset = computed(() =>
  props.shape === 'circle'
    ? { topLeft: 'left-[7%] top-[7%]', topRight: 'right-[7%] top-[7%]', bottomRight: 'bottom-[7%] right-[7%]' }
    : { topLeft: 'left-1.5 top-1.5', topRight: 'right-1.5 top-1.5', bottomRight: 'bottom-1.5 right-1.5' },
)

const busy = computed(() => Boolean(props.refreshing || props.deleting))
const busyLabel = computed(() =>
  props.deleting ? t('author.index.deleting', { name: props.author.name }) : t('author.index.refreshing', { name: props.author.name }),
)

function handleActivate(event: MouseEvent) {
  if (props.selectionMode || event.metaKey || event.ctrlKey || event.shiftKey) {
    emit('select', event)
    return
  }
  emit('open', props.author.id)
}

function handleRefresh() {
  if (!props.canRefresh || props.refreshing) return
  emit('refresh', props.author.id)
}

function handleDelete() {
  if (!props.canDelete || props.deleting) return
  emit('delete', props.author.id)
}
</script>

<template>
  <div class="group/tile relative isolate flex h-full min-w-0 flex-col gap-1.5">
    <!-- The hit target is the whole tile, name included. Sizing it to the artwork
         instead leaves every corner of a circular tile dead, and never lets anyone
         click the name: 26 of 63 sampled points across a tile did nothing. -->
    <button
      type="button"
      class="absolute inset-0 z-10 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      :aria-label="accessibleLabel"
      :aria-pressed="selectionMode ? selected : undefined"
      @click="handleActivate"
    />
    <!-- Two boxes, deliberately: the outer one is the badge positioning context and
         does not clip, the inner one clips the artwork to its shape. Badges hung on
         the tile itself would measure from below the name; badges inside the clipped
         box get eaten by the circle. -->
    <div class="@container relative aspect-square w-full">
      <div
        class="absolute inset-0 overflow-hidden shadow-xs ring-1 ring-border/70 transition-[box-shadow,transform] duration-150"
        :class="[
          shape === 'circle' ? 'rounded-full' : 'rounded-[10px]',
          selectionMode ? '' : 'group-hover/tile:-translate-y-px group-hover/tile:shadow-md',
          selected ? 'ring-2 ring-primary' : '',
        ]"
      >
        <AuthorPortrait :author="author" :shape="shape" :cover-fallback="coverFallback" />

        <!-- Resting state stays quiet; the numbers are one hover away rather than
             printed over every tile in the grid. -->
        <span
          v-if="!selectionMode"
          class="pointer-events-none absolute inset-0 z-20 hidden flex-col justify-end gap-0.5 bg-linear-to-t from-black/75 via-black/30 to-transparent p-2 opacity-0 transition-opacity duration-150 group-focus-within/tile:opacity-100 group-hover/tile:opacity-100 @[4.5rem]:flex"
          :class="shape === 'circle' ? 'rounded-full' : 'rounded-[10px]'"
        >
          <span class="truncate text-[11px] font-bold leading-tight text-white">{{ countLine }}</span>
          <span v-if="lastAdded" class="hidden truncate text-[10px] leading-tight text-white/75 @[5.5rem]:block">{{ lastAdded }}</span>
        </span>

        <Transition
          enter-active-class="transition-opacity duration-150"
          leave-active-class="transition-opacity duration-150"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <span
            v-if="busy"
            class="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-black/55 backdrop-blur-[1px]"
            :class="shape === 'circle' ? 'rounded-full' : 'rounded-[10px]'"
            role="status"
            :aria-label="busyLabel"
          >
            <Loader2 class="size-[34cqi] animate-spin text-white drop-shadow-lg" />
          </span>
        </Transition>
      </div>
      <!-- Lives on the tile rather than inside the artwork: the artwork lifts on hover,
           and that transform makes it a stacking context, which trapped this menu
           beneath the tile's own select button. It only shows on hover, so it was
           never clickable at all. -->
      <!-- Badges live on the tile, never inside the artwork: a circular tile is
           overflow-hidden, and anything sitting in the square's corner is clipped
           away by the circle. Their inset follows the shape instead. -->
      <span
        v-if="selectionMode"
        class="pointer-events-none absolute z-20 grid size-[18px] place-items-center rounded-md backdrop-blur-[2px] transition-colors"
        :class="[badgeInset.topLeft, selected ? 'bg-primary text-primary-foreground' : 'bg-black/45 text-transparent ring-1 ring-white/55']"
      >
        <Check :size="11" />
      </span>

      <span
        v-else-if="author.bookCount > 1"
        class="pointer-events-none absolute z-20 hidden h-[17px] min-w-[17px] place-items-center rounded-full bg-background/80 px-1.5 text-[10px] font-bold tabular-nums text-foreground ring-1 ring-border backdrop-blur-[2px] transition-opacity group-hover/tile:opacity-0 sm:grid"
        :class="badgeInset.bottomRight"
      >
        {{ bookCountLabel }}
      </span>

      <DropdownMenu v-if="!selectionMode" v-model:open="menuOpen">
        <DropdownMenuTrigger as-child>
          <button
            type="button"
            class="absolute z-30 size-[22px] place-items-center rounded-md bg-black/45 text-white backdrop-blur-[2px] transition-colors hover:bg-black/65 focus-visible:grid group-focus-within/tile:grid group-hover/tile:grid"
            :class="[badgeInset.topRight, menuOpen ? 'grid' : 'hidden']"
            :aria-label="t('author.index.actionsFor', { name: author.name })"
            @click.stop
          >
            <MoreHorizontal :size="12" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="emit('open', author.id)">
            <ExternalLink class="mr-2 h-4 w-4" />
            {{ t('author.card.viewDetails') }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!canRefresh || refreshing" @click="handleRefresh">
            <Loader2 v-if="refreshing" class="mr-2 h-4 w-4 animate-spin" />
            <RefreshCw v-else class="mr-2 h-4 w-4" />
            {{ t('author.card.refreshMetadata') }}
          </DropdownMenuItem>
          <DropdownMenuItem
            :disabled="!canDelete || deleting"
            :class="canDelete ? 'text-destructive focus:text-destructive' : ''"
            @click="handleDelete"
          >
            <Loader2 v-if="deleting" class="mr-2 h-4 w-4 animate-spin" />
            <Trash2 v-else class="mr-2 h-4 w-4" />
            {{ t('author.card.deleteAuthor') }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- mt-auto pins the names to the bottom of the grid row. A 1fr track can be a
         fractional width, so aspect-square rounds two tiles in a row a pixel shorter
         than the rest; letting the gap absorb that keeps the text baselines aligned. -->
    <p
      class="mt-auto line-clamp-2 min-h-[2.6em] text-[11.5px] font-semibold leading-[1.3] tracking-[-0.005em] text-foreground [overflow-wrap:anywhere]"
      :class="shape === 'circle' ? 'text-center' : ''"
    >
      {{ author.name }}
    </p>
  </div>
</template>
