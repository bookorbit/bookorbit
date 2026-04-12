<script setup lang="ts">
import { Loader2, TriangleAlert } from 'lucide-vue-next'

withDefaults(
  defineProps<{
    open: boolean
    title: string
    description: string
    confirmLabel?: string
    cancelLabel?: string
    loading?: boolean
    destructive?: boolean
  }>(),
  {
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel',
    loading: false,
    destructive: false,
  },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[70] flex items-center justify-center">
      <div class="absolute inset-0 bg-black/40 backdrop-blur-sm" @click="emit('cancel')" />
      <div class="relative z-10 mx-4 w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl">
        <div class="mb-5 flex items-start gap-4">
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" :class="destructive ? 'bg-destructive/10' : 'bg-primary/10'">
            <TriangleAlert :size="18" :class="destructive ? 'text-destructive' : 'text-primary'" />
          </div>
          <div>
            <h2 class="text-base font-semibold text-foreground">{{ title }}</h2>
            <p class="mt-1 text-sm text-muted-foreground">{{ description }}</p>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button
            class="h-9 rounded-md px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :disabled="loading"
            @click="emit('cancel')"
          >
            {{ cancelLabel }}
          </button>
          <button
            class="inline-flex h-9 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:opacity-50"
            :class="
              destructive
                ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                : 'bg-primary text-primary-foreground hover:bg-primary/90'
            "
            :disabled="loading"
            @click="emit('confirm')"
          >
            <Loader2 v-if="loading" :size="14" class="animate-spin" />
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
