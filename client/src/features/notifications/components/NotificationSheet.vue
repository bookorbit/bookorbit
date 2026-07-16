<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bell, BellOff, CheckCheck, Trash2 } from '@lucide/vue'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useNotifications } from '../composables/useNotifications'
import NotificationItemVue from './NotificationItem.vue'

defineProps<{ iconRadiusClass: string }>()

const { t } = useI18n()

const { notifications, unreadCount, loading, hasMore, fetchNotifications, markAsRead, markAllAsRead, dismiss, clearAll } = useNotifications()

const sheetOpen = ref(false)

watch(sheetOpen, (open) => {
  if (open) {
    fetchNotifications(true)
  }
})

function handleMarkAsRead(id: number) {
  markAsRead(id)
}

function handleDismiss(id: number) {
  dismiss(id)
}

function handleMarkAllRead() {
  markAllAsRead()
}

function handleClearAll() {
  clearAll()
}

function handleLoadMore() {
  fetchNotifications()
}
</script>

<template>
  <Sheet v-model:open="sheetOpen">
    <SheetTrigger as-child>
      <Button
        variant="ghost"
        size="icon"
        class="relative h-8 w-8 border transition-colors border-primary/35 text-foreground/70 hover:border-primary/70 hover:text-foreground"
        :class="iconRadiusClass"
      >
        <Bell :size="15" />
        <span
          v-if="unreadCount > 0"
          class="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground tabular-nums leading-none"
        >
          {{ unreadCount > 99 ? '99+' : unreadCount }}
        </span>
      </Button>
    </SheetTrigger>

    <SheetContent side="right" class="w-[90vw] sm:max-w-md p-0 flex flex-col gap-0">
      <SheetHeader class="flex flex-row items-center justify-between border-b px-4 py-3 h-14 shrink-0 space-y-0">
        <SheetTitle class="text-sm font-semibold text-foreground">{{ t('notifications.title') }}</SheetTitle>
        <div class="flex items-center gap-1 pr-8">
          <Button v-if="unreadCount > 0" variant="ghost" size="sm" class="h-7 gap-1.5 text-xs text-muted-foreground" @click="handleMarkAllRead">
            <CheckCheck :size="14" />
            {{ t('notifications.markAllRead') }}
          </Button>
          <Button v-if="notifications.length > 0" variant="ghost" size="sm" class="h-7 gap-1.5 text-xs text-muted-foreground" @click="handleClearAll">
            <Trash2 :size="14" />
            {{ t('notifications.clear') }}
          </Button>
        </div>
      </SheetHeader>

      <div class="flex-1 overflow-y-auto min-h-0">
        <div v-if="notifications.length === 0 && !loading" class="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <BellOff :size="32" class="mb-4 opacity-20" />
          <p class="text-sm">{{ t('notifications.empty') }}</p>
        </div>

        <div v-else class="flex flex-col gap-1.5 px-2 py-2">
          <NotificationItemVue v-for="item in notifications" :key="item.id" :notification="item" @read="handleMarkAsRead" @dismiss="handleDismiss" />
        </div>

        <div v-if="loading" class="flex justify-center py-8">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>

        <div v-if="hasMore && !loading" class="p-4">
          <Button variant="ghost" size="sm" class="w-full text-xs text-muted-foreground border border-dashed" @click="handleLoadMore">
            {{ t('notifications.loadMore') }}
          </Button>
        </div>
      </div>
    </SheetContent>
  </Sheet>
</template>
