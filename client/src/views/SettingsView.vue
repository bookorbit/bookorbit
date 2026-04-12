<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import SettingsHeader from '@/features/settings/SettingsHeader.vue'

const route = useRoute()
const maxWidth = computed(() => (route.meta.maxWidth as string | undefined) ?? 'max-w-3xl')
</script>

<template>
  <div class="flex flex-col mt-2 min-h-[calc(100%-0.5rem)] overflow-hidden rounded-xl border border-border/70 bg-card/40">
    <SettingsHeader />
    <main class="flex-1 overflow-y-auto overflow-x-hidden">
      <div class="md:px-6 px-4 py-6" :class="maxWidth">
        <router-view />
      </div>
    </main>
  </div>
</template>
