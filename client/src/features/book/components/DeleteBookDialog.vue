<script setup lang="ts">
import { History, Loader2, Trash2 } from '@lucide/vue'
import { useI18n } from 'vue-i18n'

defineProps<{ open: boolean; deleting: boolean }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-scrim" @click="emit('cancel')" />
      <div class="relative z-10 w-full max-w-sm mx-4 bg-card border border-border rounded-lg shadow-2xl p-6">
        <div class="flex items-start gap-4 mb-5">
          <div class="shrink-0 h-10 w-10 rounded-full bg-destructive/10 flex items-center justify-center">
            <Trash2 class="text-destructive" :size="18" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-foreground">{{ t('book.deleteDialog.title') }}</h2>
            <p class="text-sm text-muted-foreground mt-1">
              {{ t('book.deleteDialog.description') }}
            </p>
            <p class="mt-3 flex gap-2 rounded-md border border-primary/25 bg-primary/10 px-2.5 py-2 text-[12.5px] leading-[17px] text-foreground">
              <History class="mt-px shrink-0 text-primary" :size="14" aria-hidden="true" />
              {{ t('book.deleteDialog.keepsHistory') }}
            </p>
          </div>
        </div>
        <div class="flex justify-end gap-2">
          <button
            class="h-9 px-4 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            :disabled="deleting"
            @click="emit('cancel')"
          >
            {{ t('common.cancel') }}
          </button>
          <button
            class="h-9 px-4 rounded-md text-sm font-medium bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors flex items-center gap-2 disabled:opacity-50"
            :disabled="deleting"
            @click="emit('confirm')"
          >
            <Loader2 v-if="deleting" class="animate-spin" :size="14" />
            {{ t('common.delete') }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
