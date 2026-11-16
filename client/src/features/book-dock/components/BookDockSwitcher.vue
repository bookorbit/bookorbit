<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Inbox, Layers, Plus } from '@lucide/vue'
import { formatNumber } from '@/i18n/formatters'
import type { BookDockKey } from '../composables/useBookDockFiles'

export interface BookDockSwitcherTab {
  key: BookDockKey
  label: string
  total: number
  onHold: number
  error: number
  /** A dock that is turned off still lists the files it holds. */
  off?: boolean
}

const props = defineProps<{
  tabs: BookDockSwitcherTab[]
  current: BookDockKey
  canManage: boolean
}>()

const emit = defineEmits<{ select: [BookDockKey] }>()

const { t } = useI18n()
const nav = ref<HTMLElement | null>(null)

function countClass(tab: BookDockSwitcherTab): string {
  if (tab.key === props.current) return 'bg-primary/16 text-primary'
  if (tab.error > 0) return 'bg-red-500/15 text-red-600 dark:text-red-400'
  if (tab.onHold > 0) return 'bg-amber-500/16 text-amber-600 dark:text-amber-400'
  return 'bg-muted text-muted-foreground'
}

function describe(tab: BookDockSwitcherTab): string {
  return t('bookDock.switcher.tabSummary', { total: tab.total, onHold: tab.onHold, error: tab.error })
}

function select(tab: BookDockSwitcherTab) {
  emit('select', tab.key)
}

/** Keeps the current dock in view when a phone-width strip scrolls. */
function revealCurrent() {
  const current = nav.value?.querySelector<HTMLElement>('[aria-current="page"]')
  if (!nav.value || !current) return
  nav.value.scrollLeft = Math.max(0, current.offsetLeft - (nav.value.clientWidth - current.offsetWidth) / 2)
}

onMounted(revealCurrent)
watch(
  () => props.current,
  () => nextTick(revealCurrent),
)
</script>

<template>
  <nav
    ref="nav"
    data-testid="book-dock-switcher"
    :aria-label="t('bookDock.switcher.label')"
    class="dock-switcher flex items-center gap-1 overflow-x-auto rounded-[10px] border border-border bg-card p-1 shadow-xs"
  >
    <template v-for="(tab, index) in props.tabs" :key="tab.key">
      <span v-if="index === 1" class="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
      <button
        type="button"
        :data-testid="`book-dock-switcher-${tab.key}`"
        :aria-current="tab.key === props.current ? 'page' : undefined"
        class="group inline-flex h-[34px] shrink-0 items-center gap-2 whitespace-nowrap rounded-[7px] ps-3 pe-2.5 text-[13.5px] font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[current=page]:bg-primary/12 aria-[current=page]:text-primary"
        :class="tab.off && tab.key !== props.current ? 'text-muted-foreground' : 'text-foreground'"
        @click="select(tab)"
      >
        <Layers
          v-if="tab.key === 'all'"
          class="size-[15px] shrink-0 text-muted-foreground group-aria-[current=page]:text-primary"
          aria-hidden="true"
        />
        <Inbox
          v-else-if="tab.key === 'unsorted'"
          class="size-[15px] shrink-0 text-muted-foreground group-aria-[current=page]:text-primary"
          aria-hidden="true"
        />
        <span>{{ tab.label }}</span>
        <span v-if="tab.off" class="text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase">{{ t('bookDock.switcher.off') }}</span>
        <span
          class="inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums"
          :class="countClass(tab)"
          aria-hidden="true"
        >
          {{ formatNumber(tab.total) }}
        </span>
        <span class="sr-only">{{ describe(tab) }}</span>
      </button>
    </template>
    <RouterLink
      v-if="props.canManage"
      :to="{ name: 'settings-admin-book-dock' }"
      data-testid="book-dock-switcher-add"
      class="ms-1 inline-flex h-[34px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] border border-dashed border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:border-primary/45 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus class="size-3.5 text-muted-foreground" aria-hidden="true" />
      {{ t('bookDock.switcher.addDock') }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.dock-switcher {
  scrollbar-width: none;
}
.dock-switcher::-webkit-scrollbar {
  display: none;
}
</style>
