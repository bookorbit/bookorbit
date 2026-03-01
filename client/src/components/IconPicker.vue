<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import * as LucideIcons from 'lucide-vue-next'
import { ChevronDown, Search, X } from 'lucide-vue-next'
import { RecycleScroller } from 'vue-virtual-scroller'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

// ── Icon list ─────────────────────────────────────────────────────────────

const ALL_ICONS: string[] = Object.keys(LucideIcons)
  .filter((k) => /^[A-Z]/.test(k) && !k.endsWith('Icon') && !k.startsWith('Lucide'))
  .sort()

function getIconComponent(name: string) {
  return (LucideIcons as Record<string, unknown>)[name]
}

const selectedIconComponent = computed(() => (props.modelValue ? ((LucideIcons as Record<string, unknown>)[props.modelValue] ?? null) : null))

// ── Virtual grid ──────────────────────────────────────────────────────────

const COLS = 10
const ROW_HEIGHT = 44

const query = ref('')

const filteredIcons = computed(() => {
  const q = query.value.trim().toLowerCase()
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

// ── Picker state ──────────────────────────────────────────────────────────

const open = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const searchRef = ref<HTMLInputElement | null>(null)
const panelStyle = ref<Record<string, string>>({})

function positionPanel() {
  const rect = triggerRef.value?.getBoundingClientRect()
  if (!rect) return
  const width = Math.max(rect.width, 440)
  let left = rect.left
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8
  if (left < 8) left = 8
  let top = rect.bottom + 4
  // Flip upward if panel would overflow viewport bottom
  if (top + 400 > window.innerHeight - 8) top = rect.top - 400 - 4
  panelStyle.value = {
    position: 'fixed',
    top: `${top}px`,
    left: `${left}px`,
    width: `${width}px`,
    zIndex: '200',
  }
}

function toggle() {
  if (!open.value) positionPanel()
  open.value = !open.value
}

watch(open, (isOpen) => {
  if (!isOpen) {
    query.value = ''
  } else {
    nextTick(() => searchRef.value?.focus())
  }
})

function select(name: string) {
  emit('update:modelValue', name === props.modelValue ? '' : name)
  open.value = false
}

function clearValue() {
  emit('update:modelValue', '')
}

// ── Click outside ─────────────────────────────────────────────────────────

function handleOutsideClick(e: MouseEvent) {
  const target = e.target as Node
  if (triggerRef.value?.contains(target) || panelRef.value?.contains(target)) return
  open.value = false
}

watch(open, (isOpen) => {
  if (isOpen) nextTick(() => document.addEventListener('mousedown', handleOutsideClick))
  else document.removeEventListener('mousedown', handleOutsideClick)
})

onUnmounted(() => document.removeEventListener('mousedown', handleOutsideClick))
</script>

<template>
  <!-- Trigger button -->
  <button
    ref="triggerRef"
    type="button"
    @click="toggle"
    class="h-10 w-full flex items-center gap-2.5 rounded-lg border border-input bg-card text-sm px-3 hover:bg-muted transition-colors"
  >
    <component v-if="selectedIconComponent" :is="selectedIconComponent" :size="16" class="shrink-0 text-foreground" />
    <span v-else class="h-4 w-4 rounded bg-muted/60 shrink-0" />
    <span v-if="modelValue" class="flex-1 text-left text-foreground truncate">{{ modelValue }}</span>
    <span v-else class="flex-1 text-left text-muted-foreground/40 truncate">{{ placeholder ?? 'Choose an icon...' }}</span>
    <button
      v-if="modelValue"
      type="button"
      @click.stop="clearValue"
      class="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors shrink-0"
    >
      <X :size="12" />
    </button>
    <ChevronDown :size="14" class="text-muted-foreground shrink-0 transition-transform duration-200" :class="open ? 'rotate-180' : ''" />
  </button>

  <!-- Floating panel (teleported to avoid overflow clipping) -->
  <Teleport to="body">
    <Transition name="icon-picker-drop">
      <div v-if="open" ref="panelRef" :style="panelStyle" class="flex flex-col rounded-xl border border-border bg-card shadow-2xl overflow-hidden">
        <!-- Search bar -->
        <div class="flex items-center gap-2 px-3 py-2.5 border-b border-border shrink-0">
          <Search :size="13" class="text-muted-foreground shrink-0" />
          <input
            ref="searchRef"
            v-model="query"
            type="text"
            placeholder="Search icons..."
            class="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
          />
          <div class="flex items-center gap-2 shrink-0">
            <span class="text-[11px] text-muted-foreground/60">{{ filteredIcons.length.toLocaleString() }}</span>
            <button v-if="query" type="button" @click="query = ''" class="text-muted-foreground hover:text-foreground transition-colors">
              <X :size="13" />
            </button>
          </div>
        </div>

        <!-- No results -->
        <div v-if="filteredIcons.length === 0" class="flex items-center justify-center py-12 text-xs text-muted-foreground">
          No icons match "{{ query }}"
        </div>

        <!-- Virtual icon grid -->
        <RecycleScroller v-else class="overflow-y-auto px-2 py-1.5" style="height: 320px" :items="rows" :item-size="ROW_HEIGHT" key-field="id">
          <template #default="{ item }">
            <div class="flex gap-0.5">
              <Tooltip v-for="name in item.icons" :key="name">
                <TooltipTrigger as-child>
                  <button
                    type="button"
                    :style="{ width: `calc(100% / ${COLS})`, aspectRatio: '1' }"
                    class="flex items-center justify-center rounded-md transition-colors"
                    :class="modelValue === name ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
                    @click="select(name)"
                  >
                    <component :is="getIconComponent(name)" :size="16" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{{ name }}</TooltipContent>
              </Tooltip>
            </div>
          </template>
        </RecycleScroller>
      </div>
    </Transition>
  </Teleport>
</template>

<style>
@import 'vue-virtual-scroller/dist/vue-virtual-scroller.css';
</style>

<style scoped>
.icon-picker-drop-enter-active,
.icon-picker-drop-leave-active {
  transition:
    opacity 0.15s ease,
    transform 0.15s ease;
}
.icon-picker-drop-enter-from,
.icon-picker-drop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
