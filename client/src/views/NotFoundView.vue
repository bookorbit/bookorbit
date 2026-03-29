<script setup lang="ts">
import { useRouter } from 'vue-router'
import { House } from 'lucide-vue-next'

const router = useRouter()

function goHome() {
  router.push('/')
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
    <p class="text-8xl font-serif font-semibold text-foreground/10 select-none leading-none">404</p>
    <div class="space-y-1">
      <h1 class="text-xl font-semibold text-foreground">Page not found</h1>
      <p class="text-sm text-muted-foreground">The page you're looking for doesn't exist.</p>
    </div>
    <button
      class="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors mt-2"
      @click="goHome"
    >
      <House :size="15" />
      Go home
    </button>
  </div>
</template>
