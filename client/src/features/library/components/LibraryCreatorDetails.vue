<script setup lang="ts">
import { computed, ref } from 'vue'
import * as LucideIcons from 'lucide-vue-next'
import { Library, Search, X } from 'lucide-vue-next'
import { RecycleScroller } from 'vue-virtual-scroller'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  name: string
  icon: string | null
}>()

const emit = defineEmits<{
  'update:name': [value: string]
  'update:icon': [value: string | null]
}>()

// ── Icon grid ──────────────────────────────────────────────────────────────

const ALL_ICONS: string[] = Object.keys(LucideIcons)
  .filter((k) => /^[A-Z]/.test(k) && !k.endsWith('Icon') && !k.startsWith('Lucide'))
  .sort()

function getIconComponent(name: string) {
  return (LucideIcons as Record<string, unknown>)[name]
}

const COLS = 10
const ROW_HEIGHT = 44

const search = ref('')

const filteredIcons = computed(() => {
  const q = search.value.trim().toLowerCase()
  return q ? ALL_ICONS.filter((n) => n.toLowerCase().includes(q)) : ALL_ICONS
})

interface IconRow {
  id: number
  icons: string[]
}

const rows = computed<IconRow[]>(() => {
  const result: IconRow[] = []
  const list = filteredIcons.value
  for (let i = 0; i < list.length; i += COLS) {
    result.push({ id: i, icons: list.slice(i, i + COLS) })
  }
  return result
})

const selectedIconComponent = computed(() => (props.icon ? (LucideIcons as Record<string, unknown>)[props.icon] : null) ?? Library)
</script>

<template>
  <div class="px-6 py-6 flex flex-col gap-4 h-full min-h-0">
    <!-- Name row with inline icon preview -->
    <div>
      <label class="block text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Library name</label>
      <div class="flex items-center gap-3">
        <!-- Icon preview -->
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <component :is="selectedIconComponent" :size="18" class="text-primary" />
        </div>
        <!-- Name input -->
        <input
          type="text"
          :value="name"
          placeholder="My Library"
          maxlength="255"
          class="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring"
          @input="emit('update:name', ($event.target as HTMLInputElement).value)"
        />
      </div>
    </div>

    <!-- Icon picker (fills remaining height) -->
    <div class="flex-1 flex flex-col min-h-0">
      <div class="flex items-center justify-between mb-2">
        <label class="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Icon</label>
        <div class="flex items-center gap-3">
          <span v-if="icon" class="text-xs text-muted-foreground">
            <span class="font-medium text-foreground">{{ icon }}</span>
            <button class="ml-1.5 text-muted-foreground hover:text-foreground underline" @click="emit('update:icon', null)">clear</button>
          </span>
          <span class="text-xs text-muted-foreground">{{ filteredIcons.length.toLocaleString() }} icons</span>
        </div>
      </div>

      <div class="flex flex-col rounded-lg border border-border bg-card overflow-hidden flex-1 min-h-0">
        <!-- Search -->
        <div class="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
          <Search :size="13" class="text-muted-foreground shrink-0" />
          <input
            v-model="search"
            type="text"
            placeholder="Search icons…"
            class="flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
          />
          <button v-if="search" class="text-muted-foreground hover:text-foreground" @click="search = ''">
            <X :size="12" />
          </button>
        </div>

        <!-- Grid -->
        <RecycleScroller class="flex-1 overflow-y-auto px-2 py-1" :items="rows" :item-size="ROW_HEIGHT" key-field="id">
          <template #default="{ item }">
            <div class="flex gap-0.5">
              <Tooltip v-for="iconName in item.icons" :key="iconName">
                <TooltipTrigger as-child>
                  <button
                    class="flex items-center justify-center rounded-md transition-colors"
                    style="width: calc(100% / 10); aspect-ratio: 1"
                    :class="icon === iconName ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                    @click="emit('update:icon', icon === iconName ? null : iconName)"
                  >
                    <component :is="getIconComponent(iconName)" :size="16" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ iconName }}</TooltipContent>
              </Tooltip>
            </div>
          </template>
        </RecycleScroller>
      </div>
    </div>
  </div>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>
