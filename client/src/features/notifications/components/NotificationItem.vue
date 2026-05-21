<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import {
  X,
  FolderSync,
  BookOpen,
  PackageOpen,
  UserCheck,
  Mail,
  Tablet,
  ArrowRightLeft,
  FileDown,
  TriangleAlert,
  BookOpenCheck,
} from 'lucide-vue-next'
import type { NotificationItem } from '@bookorbit/types'
import { useNotifications } from '../composables/useNotifications'

const props = defineProps<{ notification: NotificationItem }>()
const emit = defineEmits<{ read: [id: number]; dismiss: [id: number] }>()

const router = useRouter()
const { formatRelativeTime } = useNotifications()

const FAILED_TYPES = new Set([
  'scan_failed',
  'metadata_fetch_failed',
  'author_enrichment_failed',
  'email_failed',
  'migration_failed',
  'file_write_back_failed',
  'file_rename_failed',
])

const WARNING_TYPES = new Set(['books_unavailable'])

const ICON_MAP: Record<string, typeof FolderSync> = {
  scan_completed: FolderSync,
  scan_failed: FolderSync,
  books_unavailable: TriangleAlert,
  books_restored: BookOpenCheck,
  metadata_fetch_completed: BookOpen,
  metadata_fetch_failed: BookOpen,
  book_dock_ready: PackageOpen,
  book_dock_finalized: PackageOpen,
  author_enrichment_completed: UserCheck,
  author_enrichment_failed: UserCheck,
  email_sent: Mail,
  email_failed: Mail,
  kobo_sync_completed: Tablet,
  migration_completed: ArrowRightLeft,
  migration_failed: ArrowRightLeft,
  file_write_back_completed: FileDown,
  file_write_back_failed: FileDown,
  file_rename_completed: FileDown,
  file_rename_failed: FileDown,
}

const icon = computed(() => ICON_MAP[props.notification.type] ?? FolderSync)
const isFailed = computed(() => FAILED_TYPES.has(props.notification.type))
const isWarning = computed(() => WARNING_TYPES.has(props.notification.type))
const relativeTime = computed(() => formatRelativeTime(props.notification.createdAt))

function handleClick() {
  if (!props.notification.read) {
    emit('read', props.notification.id)
  }
  if (props.notification.actionUrl) {
    if (props.notification.actionUrl.startsWith('/')) {
      router.push(props.notification.actionUrl)
    } else {
      window.open(props.notification.actionUrl, '_blank')
    }
  }
}

function handleDismiss(e: Event) {
  e.stopPropagation()
  emit('dismiss', props.notification.id)
}
</script>

<template>
  <div
    class="group relative flex w-full cursor-pointer items-start gap-3 rounded-lg border px-3 py-3 text-left transition-all hover:shadow-sm"
    :class="
      notification.read
        ? 'border-border/30 bg-muted/20 hover:border-border/50 hover:bg-muted/40'
        : 'border-border/60 bg-card shadow-sm hover:bg-muted/30'
    "
    role="button"
    tabindex="0"
    @click="handleClick"
    @keydown.enter="handleClick"
    @keydown.space.prevent="handleClick"
  >
    <div class="relative mt-0.5 shrink-0">
      <div
        class="flex items-center justify-center rounded-lg p-1.5"
        :class="isFailed ? 'bg-destructive/10' : isWarning ? 'bg-amber-500/10' : 'bg-green-500/10'"
      >
        <component :is="icon" :size="15" :class="isFailed ? 'text-destructive' : isWarning ? 'text-amber-500' : 'text-green-500'" />
      </div>
      <span v-if="!notification.read" class="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-start justify-between gap-2">
        <p class="truncate text-sm leading-tight" :class="notification.read ? 'text-foreground/80' : 'font-semibold text-foreground'">
          {{ notification.title }}
        </p>
        <span class="shrink-0 text-[11px] text-muted-foreground/60">{{ relativeTime }}</span>
      </div>
      <p v-if="notification.message" class="mt-1 text-xs text-muted-foreground truncate">
        {{ notification.message }}
      </p>
    </div>

    <button
      class="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
      @click="handleDismiss"
    >
      <X :size="14" />
    </button>
  </div>
</template>
