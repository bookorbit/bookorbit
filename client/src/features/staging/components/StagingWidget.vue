<script setup lang="ts">
import { onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { PackageOpen, ArrowRight, Clock, CheckCircle, AlertCircle } from 'lucide-vue-next'
import { useStagingSummary } from '../composables/useStagingSummary'

const router = useRouter()
const { summary, fetchSummary } = useStagingSummary()

onMounted(() => {
  fetchSummary()
})
</script>

<template>
  <div
    v-if="summary.total > 0"
    class="rounded-xl border border-border bg-card/50 p-4 space-y-3 hover:border-primary/30 transition-colors cursor-pointer"
    @click="router.push({ name: 'staging' })"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <div class="flex items-center justify-center size-8 rounded-lg bg-primary/10">
          <PackageOpen class="size-4 text-primary" />
        </div>
        <div>
          <p class="text-sm font-semibold text-foreground">Staging</p>
          <p class="text-xs text-muted-foreground">{{ summary.total }} file{{ summary.total === 1 ? '' : 's' }} awaiting review</p>
        </div>
      </div>
      <ArrowRight class="size-4 text-muted-foreground" />
    </div>

    <div class="flex items-center gap-4 text-xs">
      <div v-if="summary.pending > 0" class="flex items-center gap-1 text-amber-600 dark:text-amber-400">
        <Clock class="size-3" />
        {{ summary.pending }} pending
      </div>
      <div v-if="summary.ready > 0" class="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
        <CheckCircle class="size-3" />
        {{ summary.ready }} ready
      </div>
      <div v-if="summary.error > 0" class="flex items-center gap-1 text-red-500">
        <AlertCircle class="size-3" />
        {{ summary.error }} error
      </div>
    </div>
  </div>
</template>
