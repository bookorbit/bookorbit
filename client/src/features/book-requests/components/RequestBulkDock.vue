<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, X } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatNumber } from '@/i18n/formatters'
import { isDestructiveAction, REQUEST_ACTION_GROUPS, type BulkActionState, type RequestAction } from '../requestSelection'

/**
 * The selection's actions below `xl`, docked at the bottom within reach of a thumb. One suggested
 * action, never a destructive one, and the full set behind a menu in the same groups and order as
 * every row menu, each with its count or the reason it does not apply.
 */
const props = defineProps<{
  selectedCount: number
  actions: BulkActionState[]
  busy: boolean
}>()

const emit = defineEmits<{
  clear: []
  run: [action: RequestAction]
}>()

const { t } = useI18n()

const suggested = computed(() => props.actions.find((entry) => entry.rows > 0 && !isDestructiveAction(entry.action)) ?? null)

const groups = computed(() =>
  (['decide', 'keep', 'remove'] as const)
    .map((group) => ({ group, entries: props.actions.filter((entry) => REQUEST_ACTION_GROUPS[entry.action] === group) }))
    .filter((group) => group.entries.length > 0),
)

function handleClear() {
  emit('clear')
}

function handleSuggested() {
  if (suggested.value) emit('run', suggested.value.action)
}

function handleRun(action: RequestAction) {
  emit('run', action)
}
</script>

<template>
  <div class="pointer-events-none sticky bottom-0 z-40 mt-3 flex justify-center pb-[max(0.75rem,env(safe-area-inset-bottom))] xl:hidden">
    <div
      class="pointer-events-auto flex w-full max-w-md items-center justify-end gap-2 rounded-xl border border-border bg-card py-2 ps-3 pe-2 shadow-lg"
      role="region"
      :aria-label="t('bookRequests.bulkBar.label')"
    >
      <!-- On a phone the strip above the list already says how many are ticked; the buttons need the width. -->
      <p class="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground tabular-nums max-sm:sr-only">
        {{ t('bookRequests.bulkBar.selected', { count: selectedCount }) }}
      </p>

      <Button v-if="suggested" size="sm" class="h-8 shrink-0 gap-1.5 px-2.5 text-[13px] max-sm:flex-1" :disabled="busy" @click="handleSuggested">
        {{ t(`bookRequests.bulkBar.action.${suggested.action}`) }}
        <span class="min-w-4 rounded-xs bg-primary-foreground/20 px-1 text-center text-xs tabular-nums">{{ formatNumber(suggested.rows) }}</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button variant="outline" size="sm" class="h-8 shrink-0 gap-1 px-2.5 text-[13px]" :disabled="busy">
            {{ t('bookRequests.bulkBar.actions') }}
            <ChevronDown :size="14" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="top" class="w-64">
          <template v-for="(group, index) in groups" :key="group.group">
            <DropdownMenuSeparator v-if="index > 0" />
            <DropdownMenuLabel class="px-2 pt-1.5 pb-1 text-[10.5px] leading-[13px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
              {{ t(`bookRequests.bulkBar.groups.${group.group}`) }}
            </DropdownMenuLabel>
            <DropdownMenuItem
              v-for="entry in group.entries"
              :key="entry.action"
              :variant="isDestructiveAction(entry.action) && entry.rows > 0 ? 'destructive' : 'default'"
              :disabled="entry.rows === 0"
              @click="handleRun(entry.action)"
            >
              <span class="flex-1">{{ t(`bookRequests.bulkBar.action.${entry.action}`) }}</span>
              <span v-if="entry.rows > 0" class="min-w-4 rounded-xs bg-foreground/8 px-1 text-center text-xs tabular-nums">{{
                formatNumber(entry.rows)
              }}</span>
              <span v-else class="text-xs text-muted-foreground">{{ t(`bookRequests.bulkBar.why.${entry.action}`) }}</span>
            </DropdownMenuItem>
          </template>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button variant="ghost" size="icon-sm" class="shrink-0" :aria-label="t('bookRequests.bulkBar.clear')" @click="handleClear">
        <X :size="16" aria-hidden="true" />
      </Button>
    </div>
  </div>
</template>
