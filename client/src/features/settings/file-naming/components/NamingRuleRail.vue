<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { Globe, Library, Search } from '@lucide/vue'
import AppIcon from '@/components/AppIcon.vue'
import type { NamingRuleId } from '../lib/naming-rules'

export interface RailItem {
  id: NamingRuleId
  name: string
  detail: string
  icon: string
  custom: boolean
  dirty: boolean
}

const props = defineProps<{
  globals: RailItem[]
  libraries: RailItem[]
  librariesTotal: number
  customCount: number
  selectedId: NamingRuleId
  query: string
  editorId: string
}>()

const emit = defineEmits<{ select: [id: NamingRuleId]; 'update:query': [value: string] }>()

const { t } = useI18n()

function handleSelect(id: NamingRuleId) {
  emit('select', id)
}

function handleQuery(event: Event) {
  emit('update:query', (event.target as HTMLInputElement).value)
}
</script>

<template>
  <div class="flex min-w-0 flex-col border-border bg-muted/25 md:border-r">
    <div class="p-2.5">
      <label class="sr-only" for="file-naming-rule-filter">{{ t('settings.reader.fileNaming.filterRules') }}</label>
      <div
        class="flex items-center gap-2 rounded-md border border-input bg-background px-2 py-1.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/45"
      >
        <Search :size="13" class="shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          id="file-naming-rule-filter"
          type="search"
          :value="query"
          :placeholder="t('settings.reader.fileNaming.filterRules')"
          class="w-full min-w-0 border-0 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
          @input="handleQuery"
        />
      </div>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2.5">
      <template v-if="props.globals.length">
        <p class="flex items-center gap-1.5 px-2 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Globe :size="11" class="shrink-0" aria-hidden="true" />
          {{ t('settings.reader.fileNaming.globalDefaults') }}
        </p>
        <ul class="list-none space-y-px p-0">
          <li v-for="item in props.globals" :key="item.id">
            <button
              type="button"
              :aria-current="item.id === selectedId ? 'true' : undefined"
              :aria-controls="editorId"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-primary/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              :class="item.id === selectedId ? 'bg-primary/12 shadow-[inset_2px_0_0_var(--primary)]' : ''"
              @click="handleSelect(item.id)"
            >
              <span
                class="grid size-6 shrink-0 place-items-center rounded-[5px]"
                :class="item.id === selectedId ? 'bg-primary/20 text-primary' : 'bg-surface-3 text-muted-foreground'"
              >
                <AppIcon :icon="item.icon" fallback="File" :size="13" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px]" :class="item.id === selectedId ? 'font-semibold text-primary' : 'text-foreground'">{{
                  item.name
                }}</span>
                <span class="block truncate text-[11px] text-muted-foreground">{{ item.detail }}</span>
              </span>
              <span v-if="item.dirty" class="size-1.5 shrink-0 rounded-full bg-warning" :aria-label="t('settings.reader.fileNaming.unsavedMarker')" />
            </button>
          </li>
        </ul>
      </template>

      <template v-if="props.libraries.length">
        <p class="flex items-center gap-1.5 px-2 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          <Library :size="11" class="shrink-0" aria-hidden="true" />
          {{ t('settings.reader.fileNaming.librariesGroup') }}
          <span class="ml-auto tabular-nums">{{ t('settings.reader.fileNaming.customCount', { custom: customCount, total: librariesTotal }) }}</span>
        </p>
        <ul class="list-none space-y-px p-0">
          <li v-for="item in props.libraries" :key="item.id">
            <button
              type="button"
              :aria-current="item.id === selectedId ? 'true' : undefined"
              :aria-controls="editorId"
              class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-primary/8 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
              :class="item.id === selectedId ? 'bg-primary/12 shadow-[inset_2px_0_0_var(--primary)]' : ''"
              @click="handleSelect(item.id)"
            >
              <span
                class="grid size-6 shrink-0 place-items-center rounded-[5px]"
                :class="item.id === selectedId ? 'bg-primary/20 text-primary' : 'bg-surface-3 text-muted-foreground'"
              >
                <AppIcon :icon="item.icon" fallback="FolderOpen" :size="13" aria-hidden="true" />
              </span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[13px]" :class="item.id === selectedId ? 'font-semibold text-primary' : 'text-foreground'">{{
                  item.name
                }}</span>
                <span class="block truncate text-[11px] text-muted-foreground">{{ item.detail }}</span>
              </span>
              <span v-if="item.dirty" class="size-1.5 shrink-0 rounded-full bg-warning" :aria-label="t('settings.reader.fileNaming.unsavedMarker')" />
              <span
                v-else-if="item.custom"
                class="shrink-0 rounded bg-primary/15 px-1 py-px text-[9px] font-bold uppercase tracking-wide text-primary"
              >
                {{ t('settings.reader.fileNaming.badgeCustom') }}
              </span>
            </button>
          </li>
        </ul>
      </template>

      <p v-if="!props.globals.length && !props.libraries.length" class="px-2 py-8 text-center text-xs text-muted-foreground">
        {{ t('settings.reader.fileNaming.noRuleMatches', { query }) }}
      </p>
    </div>
  </div>
</template>
