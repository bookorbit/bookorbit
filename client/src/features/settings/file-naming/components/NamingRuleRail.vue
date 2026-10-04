<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronRight } from '@lucide/vue'
import AppIcon from '@/components/AppIcon.vue'
import type { NamingRuleId } from '../lib/naming-rules'

export interface RailItem {
  id: NamingRuleId
  name: string
  icon: string
  custom: boolean
  dirty: boolean
}

/** A global default and the libraries that sit under it: inheritance is drawn, not described. */
export interface RailGroup {
  rule: RailItem
  libraries: RailItem[]
  /** Drawn apart from the groups above it, for a rule that governs something other than uploads. */
  separate?: boolean
}

const props = defineProps<{
  groups: RailGroup[]
  selectedId: NamingRuleId
  editorId: string
}>()

const emit = defineEmits<{ select: [id: NamingRuleId] }>()

const { t } = useI18n()

function handleSelect(id: NamingRuleId) {
  emit('select', id)
}

function isCurrent(id: NamingRuleId): boolean {
  return id === props.selectedId
}
</script>

<template>
  <nav class="flex min-w-0 flex-col gap-1 border-border bg-muted/25 p-2 md:border-e" :aria-label="t('settings.reader.fileNaming.rulesNav')">
    <ul class="flex list-none flex-col gap-0.5 p-0">
      <li v-for="group in groups" :key="group.rule.id" :class="group.separate ? 'mt-1.5 border-t border-border pt-2' : ''">
        <button
          type="button"
          :aria-current="isCurrent(group.rule.id) ? 'true' : undefined"
          :aria-controls="editorId"
          class="relative flex min-h-11 w-full items-center gap-2.5 rounded-md px-2 text-start @2xl/naming:min-h-9 transition-colors hover:bg-primary/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
          :class="isCurrent(group.rule.id) ? 'bg-primary/12 shadow-[inset_2px_0_0_var(--primary)]' : ''"
          @click="handleSelect(group.rule.id)"
        >
          <span
            class="grid size-6 shrink-0 place-items-center rounded-[5px]"
            :class="isCurrent(group.rule.id) ? 'bg-primary/20 text-primary' : 'bg-surface-3 text-muted-foreground'"
          >
            <AppIcon :icon="group.rule.icon" fallback="File" :size="13" aria-hidden="true" />
          </span>
          <span
            class="min-w-0 flex-1 truncate text-sm font-medium @2xl/naming:text-[13px]"
            :class="isCurrent(group.rule.id) ? 'font-semibold text-primary' : 'text-foreground'"
          >
            {{ group.rule.name }}
          </span>
          <span
            v-if="group.rule.dirty"
            class="size-1.5 shrink-0 rounded-full bg-warning"
            role="img"
            :aria-label="t('settings.reader.fileNaming.unsavedMarker')"
          />
          <ChevronRight :size="16" class="shrink-0 text-muted-foreground @2xl/naming:hidden" aria-hidden="true" />
        </button>

        <ul v-if="group.libraries.length" class="mb-1.5 ms-5 mt-px flex list-none flex-col gap-px border-s border-border p-0">
          <li v-for="item in group.libraries" :key="item.id">
            <button
              type="button"
              :aria-current="isCurrent(item.id) ? 'true' : undefined"
              :aria-controls="editorId"
              class="relative flex min-h-10 w-full items-center gap-2 rounded-e-md ps-4 pe-2 text-start @2xl/naming:min-h-7.5 transition-colors before:absolute before:start-0 before:top-1/2 before:h-px before:w-2.5 before:bg-border hover:bg-primary/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              :class="isCurrent(item.id) ? 'bg-primary/12 shadow-[inset_2px_0_0_var(--primary)]' : ''"
              @click="handleSelect(item.id)"
            >
              <AppIcon
                :icon="item.icon"
                fallback="FolderOpen"
                :size="14"
                class="shrink-0"
                :class="item.custom || isCurrent(item.id) ? 'text-primary' : 'text-muted-foreground'"
                aria-hidden="true"
              />
              <span
                class="min-w-0 flex-1 truncate text-sm @2xl/naming:text-[13px]"
                :class="isCurrent(item.id) ? 'font-semibold text-primary' : 'text-foreground'"
              >
                {{ item.name }}
              </span>
              <span
                v-if="item.dirty"
                class="size-1.5 shrink-0 rounded-full bg-warning"
                role="img"
                :aria-label="t('settings.reader.fileNaming.unsavedMarker')"
              />
              <span
                v-else-if="item.custom"
                class="shrink-0 rounded bg-primary/15 px-1 py-px text-[9.5px] font-bold uppercase tracking-wide text-primary"
              >
                {{ t('settings.reader.fileNaming.badgeCustom') }}
              </span>
              <ChevronRight :size="16" class="shrink-0 text-muted-foreground @2xl/naming:hidden" aria-hidden="true" />
            </button>
          </li>
        </ul>
      </li>
    </ul>

    <p class="mt-auto px-2 pb-1 pt-3 text-[11.5px] leading-normal text-muted-foreground">{{ t('settings.reader.fileNaming.railFoot') }}</p>
  </nav>
</template>
