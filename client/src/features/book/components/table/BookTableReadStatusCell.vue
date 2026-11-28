<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ChevronDown } from '@lucide/vue'
import { STATUS_ICONS, STATUS_COLORS } from '@/features/book/composables/useBookStatus'
import { readStatusLabel } from '@/features/book/lib/read-status-label'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { READ_STATUSES, type ReadStatus, type UserBookStatus } from '@bookorbit/types'

const props = defineProps<{
  value: UserBookStatus | null
  isActive: boolean
  isReadOnly?: boolean
}>()

const emit = defineEmits<{
  activate: []
  save: [value: ReadStatus]
  cancel: []
  navigate: [direction: 'next' | 'prev']
}>()

const isOpen = ref(false)
const saving = ref(false)

const currentStatus = computed<ReadStatus>(() => props.value?.status ?? 'unread')
const CurrentIcon = computed(() => STATUS_ICONS[currentStatus.value] as unknown)
const currentColor = computed(() => STATUS_COLORS[currentStatus.value])
const currentLabel = computed(() => readStatusLabel(currentStatus.value) ?? readStatusLabel('unread'))

watch(
  () => props.isActive,
  (active) => {
    if (active && !isOpen.value) isOpen.value = true
    else if (!active && isOpen.value) isOpen.value = false
  },
)

function handleOpenChange(open: boolean) {
  isOpen.value = open
  if (open) {
    if (!props.isActive) emit('activate')
  } else {
    if (!saving.value && props.isActive) emit('cancel')
    saving.value = false
  }
}

function selectOption(status: ReadStatus) {
  saving.value = true
  isOpen.value = false
  emit('save', status)
}

function handleTab(e: KeyboardEvent) {
  isOpen.value = false
  emit('cancel')
  emit('navigate', e.shiftKey ? 'prev' : 'next')
}
</script>

<template>
  <div class="w-full min-w-0">
    <DropdownMenu :open="isOpen" @update:open="handleOpenChange">
      <DropdownMenuTrigger as-child :disabled="isReadOnly">
        <button
          type="button"
          class="flex w-full items-center gap-1.5 rounded-xs px-1 py-0.5 text-xs transition-colors"
          :class="[currentColor, isReadOnly ? 'cursor-default' : 'hover:bg-primary/5 cursor-pointer']"
        >
          <component :is="CurrentIcon" :size="12" />
          <span class="truncate">{{ currentLabel }}</span>
          <ChevronDown v-if="!isReadOnly" :size="10" class="ml-auto shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="min-w-[140px]" :trap-focus="false" @keydown.tab.prevent="handleTab">
        <DropdownMenuItem
          v-for="status in READ_STATUSES"
          :key="status"
          class="gap-2 text-xs"
          :class="status === currentStatus ? 'text-primary font-medium' : ''"
          @select="selectOption(status)"
        >
          <component :is="STATUS_ICONS[status]" :size="12" :class="STATUS_COLORS[status]" />
          {{ readStatusLabel(status) }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>
