<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatNumber } from '@/i18n/formatters'
import type { ResolvedSidebarNavEntry, SidebarNavBadge } from '@/composables/useSidebarNav'

const props = defineProps<{ entries: ResolvedSidebarNavEntry[] }>()

const emit = defineEmits<{ navigate: [] }>()

const { t } = useI18n()
const uid = useId()

const ICON_SIZE = 16
const CHIP_MAX = 99

const tileClass = [
  'relative flex size-8 items-center justify-center rounded-(--shell-radius) border border-(--shell-accent-line) text-sidebar-foreground outline-hidden',
  'transition-colors duration-150 hover:bg-(--shell-accent-wash) focus-visible:ring-2 focus-visible:ring-sidebar-ring',
  'data-[active=true]:border-primary/60 data-[active=true]:bg-(--sidebar-active-bg) data-[active=true]:text-primary',
].join(' ')

/** Library totals are not work waiting on the user, so only accent counts earn a chip on the tile. */
function chipOf(badge: SidebarNavBadge | null): string | null {
  if (badge === null || badge.tone !== 'accent' || badge.value <= 0) return null
  return badge.value > CHIP_MAX ? t('components.sidebar.iconBadgeOverflow', { count: formatNumber(CHIP_MAX) }) : formatNumber(badge.value)
}

const tiles = computed(() =>
  props.entries.map((entry) => {
    const chip = chipOf(entry.badge)
    const signal = entry.signal
    const described = chip !== null || signal !== null
    return {
      entry,
      chip,
      signal,
      badgeId: described ? `${uid}-${entry.id}-badge` : undefined,
      badgeText: signal?.description ?? entry.badge?.label ?? formatNumber(entry.badge?.value ?? 0),
      tipLines: signal ? signal.details : entry.badge?.label ? [entry.badge.label] : [],
    }
  }),
)

function handleNavigate() {
  emit('navigate')
}
</script>

<template>
  <li data-testid="sidebar-icon-row">
    <ul class="grid auto-cols-fr grid-flow-col">
      <li v-for="tile in tiles" :key="tile.entry.id" class="flex justify-center">
        <Tooltip>
          <TooltipTrigger as-child>
            <RouterLink
              :to="tile.entry.to"
              :class="[tileClass, 'nav-signal-tile']"
              :data-active="tile.entry.isActive"
              :data-signal="tile.signal?.activity ?? undefined"
              :data-tour="tile.entry.tourId"
              :aria-label="tile.entry.label"
              :aria-current="tile.entry.isActive ? 'page' : undefined"
              :aria-describedby="tile.badgeId"
              @click="handleNavigate"
            >
              <component
                :is="tile.entry.icon"
                :size="ICON_SIZE"
                class="nav-signal-glyph"
                :data-signal="tile.signal?.activity ?? undefined"
                aria-hidden="true"
              />
              <span
                v-if="tile.signal?.failed"
                class="pointer-events-none absolute end-[5px] bottom-[5px] size-[7px] rounded-full bg-destructive ring-2 ring-(--shell-surface)"
                aria-hidden="true"
              />
              <span
                v-if="tile.chip !== null"
                class="pointer-events-none absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-bold tabular-nums text-primary-foreground ring-2 ring-sidebar"
                aria-hidden="true"
                >{{ tile.chip }}</span
              >
            </RouterLink>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <span class="block">{{ tile.entry.label }}</span>
            <span v-for="line in tile.tipLines" :key="line" class="block text-[11px]">{{ line }}</span>
          </TooltipContent>
        </Tooltip>
        <span v-if="tile.badgeId" :id="tile.badgeId" class="sr-only">{{ tile.badgeText }}</span>
      </li>
    </ul>
  </li>
</template>
