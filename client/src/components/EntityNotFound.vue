<script setup lang="ts">
import { useRouter } from 'vue-router'
import { SearchX } from 'lucide-vue-next'

defineProps<{ entity: string }>()

const router = useRouter()

function goBack() {
  if (window.history.length > 1) {
    router.back()
  } else {
    router.push('/')
  }
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center px-4">
    <div class="flex items-center justify-center w-16 h-16 rounded-full bg-muted text-muted-foreground">
      <SearchX :size="28" />
    </div>
    <div class="space-y-1">
      <h2 class="text-lg font-semibold text-foreground">{{ entity }} not found</h2>
      <p class="text-sm text-muted-foreground">This {{ entity.toLowerCase() }} doesn't exist or has been deleted.</p>
    </div>
    <button
      class="inline-flex items-center gap-2 px-4 py-2 rounded-md border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors mt-1"
      @click="goBack"
    >
      Go back
    </button>
  </div>
</template>
